import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  DrawOp,
  LineStyle,
  Point,
  StrokeOp,
  Tool,
} from '../whiteboard/types';
import { drawOperations, hitTest, translateOp, SpatialIndex } from '../whiteboard/drawUtils';
import { drawIncremental } from '../../pkgs/whiteboard-core/src/incrementalDraw';
import { shapeRegistry } from '../../pkgs/whiteboard-core/src/shapeRegistry';
import '../../pkgs/whiteboard-core/src/shapes';

type ServerMessage =
  | { type: 'init'; boardId: string; ops: DrawOp[] }
  | { type: 'op'; payload: DrawOp }
  | { type: 'reset'; ops: DrawOp[] };

interface WhiteboardProps {
  boardId: string;
}

const WS_URL =
  import.meta.env.DEV
    ? `ws://${window.location.hostname}:4000/ws`
    : `ws://${window.location.host}/ws`;

export function Whiteboard({ boardId }: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#1f2937');
  const [lineWidth, setLineWidth] = useState(3);
  const [textFontSize, setTextFontSize] = useState(24);
  const [lineStyle, setLineStyle] = useState<LineStyle>('solid');
  const [ops, setOps] = useState<DrawOp[]>([]);
  const [redoStack, setRedoStack] = useState<DrawOp[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const previousOpsRef = useRef<DrawOp[]>([]);
  const spatialIndexRef = useRef<SpatialIndex | null>(null);
  const pendingOpsRef = useRef<string[]>([]);
  const pendingResetsRef = useRef<string[]>([]);
  const opsRef = useRef<DrawOp[]>([]);
  const [textInputState, setTextInputState] = useState<{
    x: number;
    y: number;
    value: string;
    color: string;
    fontSize: number;
    targetIndex?: number;
  } | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const textCommitRef = useRef(false);
  const textFocusedOnceRef = useRef(false);

  const clampNumber = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

  const clientToPoint = (clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };
  useEffect(() => {
    opsRef.current = ops;
  }, [ops]);

  useLayoutEffect(() => {
    if (!textInputState) {
      // 关闭输入框时，下次再打开才重新聚焦
      textFocusedOnceRef.current = false;
      return;
    }
    textCommitRef.current = false;
    // 只在本次打开输入框时聚焦一次，避免每次输入都 select 全部文字
    if (textFocusedOnceRef.current) return;
    textFocusedOnceRef.current = true;
    requestAnimationFrame(() => {
      const el = textInputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      // 打新文本时不强制全选，直接从光标位置继续输入更自然
      if (!textInputState.targetIndex) {
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }, [textInputState]);
  
  useEffect(() => {
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      (window as any).__whiteboardSpatialIndex = spatialIndexRef;
      (window as any).__whiteboardOps = () => opsRef.current;
      (window as any).__whiteboardBatchAddOps = (newOps: DrawOp[]) => {
        if (!Array.isArray(newOps) || newOps.length === 0) {
          console.warn('批量添加：无效的操作数组');
          return;
        }
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          newOps.forEach(op => {
            const serialized = JSON.stringify(op);
            pendingOpsRef.current.push(serialized);
            if (pendingOpsRef.current.length > 1000) {
              pendingOpsRef.current.shift();
            }
            ws.send(JSON.stringify({ type: 'op', payload: op }));
          });
        }
        setOps((prev) => {
          const next = [...prev, ...newOps];
          setTimeout(() => {
            redraw(next, selectedIndex, false, true);
          }, 0);
          return next;
        });
      };
      (window as any).__whiteboardClearCanvas = () => {
        setSelectedIndex(null);
        clearSelectionDrag();
        const emptyOps: DrawOp[] = [];
        broadcastReset(emptyOps, null);
      };
    }
  }, [selectedIndex]);
  useEffect(() => {
    if (import.meta.env.DEV && typeof window !== 'undefined' && wsRef.current) {
      (window as any).__whiteboardWS = wsRef.current;
    }
  }, [wsRef.current]);

  const drawingRef = useRef<{
    isDrawing: boolean;
    currentPoints: Point[];
    startPoint: Point | null;
  }>({ isDrawing: false, currentPoints: [], startPoint: null });
  const selectionDrag = useRef<{
    isDragging: boolean;
    index: number | null;
    startPoint: Point | null;
    opSnapshot: DrawOp | null;
    lastPreview: DrawOp | null;
  }>({
    isDragging: false,
    index: null,
    startPoint: null,
    opSnapshot: null,
    lastPreview: null,
  });
  const erasingRef = useRef<{
    isErasing: boolean;
    eraserPath: Point[];
    initialOps: DrawOp[]; // 记录开始擦除时的 ops 快照
  }>({
    isErasing: false,
    eraserPath: [],
    initialOps: [],
  });

  const textResizeRef = useRef<{
    isResizing: boolean;
    index: number | null;
    startPoint: Point | null;
    startFontSize: number;
    lastFontSize: number;
  }>({
    isResizing: false,
    index: null,
    startPoint: null,
    startFontSize: 24,
    lastFontSize: 24,
  });

  const lineWidthResizeRef = useRef<{
    isResizing: boolean;
    index: number | null;
    startPoint: Point | null;
    startWidth: number;
    lastWidth: number;
  }>({
    isResizing: false,
    index: null,
    startPoint: null,
    startWidth: 3,
    lastWidth: 3,
  });

  const commitTextInput = (cancel = false) => {
    if (!textInputState) return;
    if (textCommitRef.current) return;
    textCommitRef.current = true;
    const value = textInputState.value.trim();
    const { x, y, color: textColor, fontSize, targetIndex } = textInputState;
    setTextInputState(null);
    if (cancel || !value) return;

    // 编辑已有文本
    if (typeof targetIndex === 'number') {
      setRedoStack([]);
      setOps((prev) => {
        if (targetIndex < 0 || targetIndex >= prev.length) return prev;
        const next = prev.map((op, idx) =>
          idx === targetIndex && op.kind === 'text'
            ? {
                ...op,
                text: value,
                color: textColor,
                width: fontSize,
              }
            : op,
        );
        broadcastReset(next, targetIndex);
        return next;
      });
      return;
    }

    // 新建文本
    const op: DrawOp = {
      kind: 'text',
      tool: 'text',
      position: { x, y },
      text: value,
      color: textColor,
      width: fontSize,
    };

    setRedoStack([]);
    setSelectedIndex(null);
    setOps((prev) => {
      const next = [...prev, op];
      redraw(next, null, false, true);
      return next;
    });
    sendOp(op);
  };

  const clearSelectionDrag = () => {
    selectionDrag.current = {
      isDragging: false,
      index: null,
      startPoint: null,
      opSnapshot: null,
      lastPreview: null,
    };
  };

  const broadcastReset = (next: DrawOp[], nextSelected: number | null = null) => {
    setSelectedIndex(nextSelected);
    setOps(next);
    opsRef.current = next;
    redraw(next, nextSelected, true);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg = { type: 'reset', ops: next };
      const serialized = JSON.stringify(msg);
      pendingResetsRef.current.push(serialized);
      if (pendingResetsRef.current.length > 1000) {
        pendingResetsRef.current.shift();
      }
      ws.send(serialized);
    }
  };

  const handleUndo = useCallback(() => {
    if (ops.length === 0) return;
    const next = ops.slice(0, -1);
    const last = ops[ops.length - 1];
    setRedoStack((prev) => [...prev, last]);
    broadcastReset(next, null);
  }, [ops]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const last = redoStack[redoStack.length - 1];
    const nextRedo = redoStack.slice(0, -1);
    const nextOps = [...ops, last];
    setRedoStack(nextRedo);
    broadcastReset(nextOps, null);
  }, [ops, redoStack]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const key = e.key.toLowerCase();

      if (e.ctrlKey && /^[1-9]$/.test(key)) {
        const tools = shapeRegistry.getDrawingTools();
        const index = parseInt(key) - 1;
        if (index < tools.length) {
          e.preventDefault();
          setTool(tools[index].tool);
        }
      } else if (e.ctrlKey && !e.shiftKey && key === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (
        (e.ctrlKey && e.shiftKey && key === 'z') ||
        (e.ctrlKey && key === 'y')
      ) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    const ws = new WebSocket(`${WS_URL}?boardId=${boardId}`);
    wsRef.current = ws;

    ws.onopen = () => {};

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data);
      if (msg.type === 'init') {
        setSelectedIndex(null);
        clearSelectionDrag();
        setOps(msg.ops);
        redraw(msg.ops, null, true);
      } else if (msg.type === 'op') {
        const payloadStr = JSON.stringify(msg.payload);
        const queue = pendingOpsRef.current;
        const idxInQueue = queue.indexOf(payloadStr);
        if (idxInQueue !== -1) {
          queue.splice(idxInQueue, 1);
          return;
        }
        setSelectedIndex(null);
        clearSelectionDrag();
        setOps((prev) => {
          const next = [...prev, msg.payload];
          redraw(next, null, false);
          return next;
        });
      } else if (msg.type === 'reset') {
        const payloadStr = JSON.stringify(msg);
        const queue = pendingResetsRef.current;
        const idxInQueue = queue.indexOf(payloadStr);
        if (idxInQueue !== -1) {
          queue.splice(idxInQueue, 1);
          return;
        }
        setSelectedIndex(null);
        clearSelectionDrag();
        setOps(msg.ops);
        redraw(msg.ops, null, true);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    return () => {
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  const redraw = (operations: DrawOp[] = ops, selected: number | null = selectedIndex, forceFull = false, updatePrevious = true) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const previousOps = previousOpsRef.current;
    
    if (forceFull || previousOps.length === 0 || operations.length === 0) {
      drawOperations(ctx, operations, selected);
      if (updatePrevious) {
        previousOpsRef.current = [...operations];
      }
      return;
    }

    try {
      drawIncremental(ctx, previousOps, operations, selected);
      if (updatePrevious) {
        previousOpsRef.current = [...operations];
      }
    } catch (error) {
      console.warn('[Whiteboard] 增量绘制失败，回退到全量绘制:', error);
      drawOperations(ctx, operations, selected);
      if (updatePrevious) {
        previousOpsRef.current = [...operations];
      }
    }
  };

  const sendOp = (op: DrawOp) => {
    const ws = wsRef.current;
    if (!ws) {
      console.warn('WebSocket not initialized');
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) {
      console.warn(`WebSocket not ready, state: ${ws.readyState} (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)`);
      return;
    }
    const msg = { type: 'op', payload: op };
    const serialized = JSON.stringify(op);
    pendingOpsRef.current.push(serialized);
    if (pendingOpsRef.current.length > 1000) {
      pendingOpsRef.current.shift();
    }
    ws.send(JSON.stringify(msg));
  };

  const canvasToPoint = (e: React.MouseEvent<HTMLCanvasElement, MouseEvent>): Point => {
    return clientToPoint(e.clientX, e.clientY);
  };

  const eraseWithPath = (eraserPath: Point[], radius: number, operations: DrawOp[]): { nextOps: DrawOp[]; changed: boolean } => {
    const nextOps: DrawOp[] = [];
    let changed = false;

    if (eraserPath.length === 0) {
      return { nextOps: operations.slice(), changed: false };
    }

    let eraserMinX = Infinity;
    let eraserMaxX = -Infinity;
    let eraserMinY = Infinity;
    let eraserMaxY = -Infinity;
    for (const p of eraserPath) {
      if (p.x < eraserMinX) eraserMinX = p.x;
      if (p.x > eraserMaxX) eraserMaxX = p.x;
      if (p.y < eraserMinY) eraserMinY = p.y;
      if (p.y > eraserMaxY)       eraserMaxY = p.y;
    }
    eraserMinX -= radius;
    eraserMaxX += radius;
    eraserMinY -= radius;
    eraserMaxY += radius;

    const eraserBox = { minX: eraserMinX, maxX: eraserMaxX, minY: eraserMinY, maxY: eraserMaxY };

    const isBoxOverlap = (a: { minX: number; maxX: number; minY: number; maxY: number }, b: { minX: number; maxX: number; minY: number; maxY: number }) => {
      return !(
        a.maxX < b.minX ||
        a.minX > b.maxX ||
        a.maxY < b.minY ||
        a.minY > b.maxY
      );
    };

    const pointToSegmentDistanceSq = (
      px: number, py: number,
      x1: number, y1: number,
      x2: number, y2: number
    ): number => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      if (dx === 0 && dy === 0) {
        const ddx = px - x1;
        const ddy = py - y1;
        return ddx * ddx + ddy * ddy;
      }
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
      const cx = x1 + t * dx;
      const cy = y1 + t * dy;
      const ddx = px - cx;
      const ddy = py - cy;
      return ddx * ddx + ddy * ddy;
    };

    const isPointErased = (p: Point): boolean => {
      const radiusSq = radius * radius;
      if (p.x < eraserMinX - radius || p.x > eraserMaxX + radius || p.y < eraserMinY - radius || p.y > eraserMaxY + radius) {
        return false;
      }
      for (let i = 0; i < eraserPath.length - 1; i++) {
        const distSq = pointToSegmentDistanceSq(
          p.x, p.y,
          eraserPath[i].x, eraserPath[i].y,
          eraserPath[i + 1].x, eraserPath[i + 1].y
        );
        if (distSq <= radiusSq) {
          return true;
        }
      }
      return false;
    };

    const approximateShapeAsPolyline = (op: DrawOp): Point[] | null => {
      switch (op.kind) {
        case 'rect': {
          const rect = op as any as { start: Point; end: Point };
          const minX = Math.min(rect.start.x, rect.end.x);
          const maxX = Math.max(rect.start.x, rect.end.x);
          const minY = Math.min(rect.start.y, rect.end.y);
          const maxY = Math.max(rect.start.y, rect.end.y);
          const p1 = { x: minX, y: minY };
          const p2 = { x: maxX, y: minY };
          const p3 = { x: maxX, y: maxY };
          const p4 = { x: minX, y: maxY };
          return [p1, p2, p3, p4, p1];
        }
        case 'circle': {
          const circle = op as any as { center: Point; radius: number };
          const { center, radius } = circle;
          const segments = Math.max(16, Math.min(72, Math.round((Math.PI * 2 * radius) / 16)));
          const pts: Point[] = [];
          for (let i = 0; i <= segments; i++) {
            const t = (i / segments) * Math.PI * 2;
            pts.push({
              x: center.x + Math.cos(t) * radius,
              y: center.y + Math.sin(t) * radius,
            });
          }
          return pts;
        }
        case 'triangle': {
          const tri = op as any as { start: Point; end: Point };
          const minX = Math.min(tri.start.x, tri.end.x);
          const maxX = Math.max(tri.start.x, tri.end.x);
          const minY = Math.min(tri.start.y, tri.end.y);
          const maxY = Math.max(tri.start.y, tri.end.y);
          const p1 = { x: (minX + maxX) / 2, y: minY };
          const p2 = { x: minX, y: maxY };
          const p3 = { x: maxX, y: maxY };
          return [p1, p2, p3, p1];
        }
        case 'diamond': {
          const d = op as any as { start: Point; end: Point };
          const minX = Math.min(d.start.x, d.end.x);
          const maxX = Math.max(d.start.x, d.end.x);
          const minY = Math.min(d.start.y, d.end.y);
          const maxY = Math.max(d.start.y, d.end.y);
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          const pTop = { x: cx, y: minY };
          const pRight = { x: maxX, y: cy };
          const pBottom = { x: cx, y: maxY };
          const pLeft = { x: minX, y: cy };
          return [pTop, pRight, pBottom, pLeft, pTop];
        }
        case 'arrow': {
          const arr = op as any as { start: Point; end: Point };
          return [arr.start, arr.end];
        }
        default:
          return null;
      }
    };

    for (const op of operations) {
      const handler = shapeRegistry.getHandler(op.kind);
      if (!handler) {
        nextOps.push(op);
        continue;
      }

      const opBox = handler.getBoundingBox(op as any, radius);
      if (!isBoxOverlap(opBox, eraserBox)) {
        nextOps.push(op);
        continue;
      }

      if (op.kind === 'stroke') {
        const stroke = op as StrokeOp;
        const pts = stroke.points;
        
        if (pts.length < 2) {
          if (pts.length === 1 && isPointErased(pts[0])) {
            changed = true;
            continue;
          }
          nextOps.push(op);
          continue;
        }

        const erasedFlags: boolean[] = pts.map(p => isPointErased(p));
        const hasErased = erasedFlags.some(flag => flag);
        if (!hasErased) {
          nextOps.push(op);
          continue;
        }

        const segments: Point[][] = [];
        let currentSegment: Point[] = [];
        let lastKept = false;

        for (let i = 0; i < pts.length; i++) {
          const keep = !erasedFlags[i];

          if (keep) {
            if (!lastKept && currentSegment.length > 0) {
              if (currentSegment.length >= 2) {
                segments.push([...currentSegment]);
              }
              currentSegment = [];
            }
            currentSegment.push(pts[i]);
          } else {
            if (lastKept && currentSegment.length > 0) {
              if (currentSegment.length >= 2) {
                segments.push([...currentSegment]);
              }
              currentSegment = [];
            }
          }

          lastKept = keep;
        }

        if (currentSegment.length >= 2) {
          segments.push(currentSegment);
        }

        if (segments.length === 0) {
          changed = true;
          continue;
        }

        changed = true;
        for (const seg of segments) {
          const newStroke: StrokeOp = {
            kind: 'stroke',
            tool: 'pen',
            points: seg,
            color: stroke.color,
            width: stroke.width,
            style: stroke.style,
          };
          nextOps.push(newStroke);
        }
      } else {
        const polyline = approximateShapeAsPolyline(op);
        if (!polyline || polyline.length < 2) {
          nextOps.push(op);
          continue;
        }

        const densePolyline: Point[] = [];
        const sampleStep = Math.max(4, radius * 0.6);
        for (let i = 0; i < polyline.length - 1; i++) {
          const a = polyline[i];
          const b = polyline[i + 1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const segLen = Math.hypot(dx, dy);
          const steps = Math.max(1, Math.ceil(segLen / sampleStep));
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            densePolyline.push({
              x: a.x + dx * t,
              y: a.y + dy * t,
            });
          }
        }

        const erasedFlags: boolean[] = densePolyline.map(p => isPointErased(p));
        const hasErased = erasedFlags.some(Boolean);

        if (!hasErased) {
          nextOps.push(op);
          continue;
        }

        const segments: Point[][] = [];
        let currentSegment: Point[] = [];
        let lastKept = false;

        for (let i = 0; i < densePolyline.length; i++) {
          const keep = !erasedFlags[i];

          if (keep) {
            if (!lastKept && currentSegment.length > 0) {
              if (currentSegment.length >= 2) {
                segments.push([...currentSegment]);
              }
              currentSegment = [];
            }
            currentSegment.push(densePolyline[i]);
          } else {
            if (lastKept && currentSegment.length > 0) {
              if (currentSegment.length >= 2) {
                segments.push([...currentSegment]);
              }
              currentSegment = [];
            }
          }

          lastKept = keep;
        }

        if (currentSegment.length >= 2) {
          segments.push(currentSegment);
        }

        if (segments.length === 0) {
          changed = true;
          continue;
        }

        changed = true;
        for (const seg of segments) {
          const newStroke: StrokeOp = {
            kind: 'stroke',
            tool: 'pen',
            points: seg,
            color: (op as any).color ?? color,
            width: (op as any).width ?? lineWidth,
            style: (op as any).style ?? lineStyle,
          };
          nextOps.push(newStroke);
        }
      }
    }

    return { nextOps, changed };
  };

  const handleMouseDown: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    const point = canvasToPoint(e);
    if (tool === 'select') {
      const idx = hitTest(ops, point, 6, spatialIndexRef.current);
      setSelectedIndex(idx);
      redraw(ops, idx, true, true);
      if (idx != null) {
        selectionDrag.current = {
          isDragging: true,
          index: idx,
          startPoint: point,
          opSnapshot: ops[idx],
          lastPreview: null,
        };
      } else {
        clearSelectionDrag();
      }
      const handleUp = () => {
        commitSelectionDrag();
        window.removeEventListener('mouseup', handleUp);
      };
      window.addEventListener('mouseup', handleUp);
      return;
    } else if (tool === 'eraser') {
      erasingRef.current.isErasing = true;
      erasingRef.current.eraserPath = [point];
      erasingRef.current.initialOps = [...opsRef.current]; // 保存开始擦除时的 ops 快照
      setSelectedIndex(null);
      return;
    } else if (tool === 'text') {
      // 先取消当前正在编辑的文本（如果有）
      if (textInputState) {
        commitTextInput(true);
      }
      const fontSize = textFontSize;
      setTextInputState({
        x: point.x,
        y: point.y,
        value: '',
        color,
        fontSize,
      });
      return;
    }
    drawingRef.current.isDrawing = true;
    drawingRef.current.currentPoints = [point];
    drawingRef.current.startPoint = point;
  };

  const handleDoubleClick: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    const point = canvasToPoint(e);
    const idx = hitTest(ops, point, 6, spatialIndexRef.current);
    if (idx == null) return;
    const op = ops[idx];
    if (op.kind !== 'text') return;

    const fontSize = op.width || 16;
    setTextFontSize(fontSize);

    // 进入就地编辑模式
    setSelectedIndex(idx);
    setTextInputState({
      x: op.position.x,
      y: op.position.y,
      value: op.text,
      color: op.color,
      fontSize,
      targetIndex: idx,
    });
  };

  const startResizeSelectedText = (clientX: number, clientY: number) => {
    if (selectedIndex == null) return;
    const op = ops[selectedIndex];
    if (!op || op.kind !== 'text') return;

    const startPoint = clientToPoint(clientX, clientY);
    const startFontSize = op.width || 16;

    textResizeRef.current = {
      isResizing: true,
      index: selectedIndex,
      startPoint,
      startFontSize,
      lastFontSize: startFontSize,
    };

    const handleMove = (ev: MouseEvent) => {
      const state = textResizeRef.current;
      if (!state.isResizing || state.index == null || !state.startPoint) return;
      const p = clientToPoint(ev.clientX, ev.clientY);
      const dx = p.x - state.startPoint.x;
      const dy = p.y - state.startPoint.y;
      const delta = Math.max(dx, dy);
      const nextFontSize = clampNumber(Math.round(state.startFontSize + delta / 2), 8, 200);
      if (nextFontSize === state.lastFontSize) return;
      state.lastFontSize = nextFontSize;
      setTextFontSize(nextFontSize);

      setOps((prev) => {
        if (state.index == null || state.index < 0 || state.index >= prev.length) return prev;
        const next = prev.map((op, idx) =>
          idx === state.index && op.kind === 'text' ? { ...op, width: nextFontSize } : op,
        );
        opsRef.current = next;
        redraw(next, state.index, true, true);
        return next;
      });
    };

    const handleUp = () => {
      const state = textResizeRef.current;
      if (state.isResizing && state.index != null) {
        textResizeRef.current.isResizing = false;
        broadcastReset(opsRef.current, state.index);
      }
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  const startResizeSelectedLine = (clientX: number, clientY: number) => {
    if (selectedIndex == null) return;
    const op = ops[selectedIndex];
    if (!op || op.kind === 'text' || !('width' in op)) return;

    const startPoint = clientToPoint(clientX, clientY);
    const startWidth = (op as any).width ?? lineWidth;

    lineWidthResizeRef.current = {
      isResizing: true,
      index: selectedIndex,
      startPoint,
      startWidth,
      lastWidth: startWidth,
    };

    const handleMove = (ev: MouseEvent) => {
      const state = lineWidthResizeRef.current;
      if (!state.isResizing || state.index == null || !state.startPoint) return;
      const p = clientToPoint(ev.clientX, ev.clientY);
      const dy = p.y - state.startPoint.y;
      const nextWidth = clampNumber(Math.round(state.startWidth + dy / 4), 1, 40);
      if (nextWidth === state.lastWidth) return;
      state.lastWidth = nextWidth;
      setLineWidth(nextWidth);

      setOps((prev) => {
        if (state.index == null || state.index < 0 || state.index >= prev.length) return prev;
        const next = prev.map((op, idx) =>
          idx === state.index && op.kind !== 'text' && 'width' in op ? { ...(op as any), width: nextWidth } : op,
        );
        opsRef.current = next;
        redraw(next, state.index, true, true);
        return next;
      });
    };

    const handleUp = () => {
      const state = lineWidthResizeRef.current;
      if (state.isResizing && state.index != null) {
        lineWidthResizeRef.current.isResizing = false;
        broadcastReset(opsRef.current, state.index);
      }
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  const handleMouseMove: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    if (tool === 'select') {
      const drag = selectionDrag.current;
      if (!drag.isDragging || drag.index == null || !drag.startPoint || !drag.opSnapshot) return;
      const point = canvasToPoint(e);
      const dx = point.x - drag.startPoint.x;
      const dy = point.y - drag.startPoint.y;
      const handler = shapeRegistry.getHandler(drag.opSnapshot.kind);
      if (!handler || !handler.draggable) return;

      const movedOp = translateOp(drag.opSnapshot, dx, dy);
      drag.lastPreview = movedOp;
      const previewOps = ops.map((op, idx) => (idx === drag.index ? movedOp : op));
      setOps(previewOps);
      redraw(previewOps, drag.index, true, true);
      return;
    }
    if (tool === 'eraser') {
      if (!erasingRef.current.isErasing) return;
      const point = canvasToPoint(e);
      const path = erasingRef.current.eraserPath;
      const last = path[path.length - 1];
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      const distSq = dx * dx + dy * dy;
      const minStep = Math.max(4, lineWidth * 1.5);
      if (distSq >= minStep * minStep) {
        path.push(point);
      } else {
        return;
      }
      // 拖动过程中只做预览，基于初始 ops 快照计算
      const eraserRadius = lineWidth * 2;
      const initialOps = erasingRef.current.initialOps;
      const { nextOps, changed } = eraseWithPath(path, eraserRadius, initialOps);
      if (changed) {
        // 只更新显示，不更新 opsRef.current（避免影响最终计算）
        setOps(nextOps);
        redraw(nextOps, null, true, false); // 预览时不更新 previousOpsRef
      }
      return;
    }
    if (!drawingRef.current.isDrawing) return;
    const point = canvasToPoint(e);
    
    if (tool === 'pen') {
      drawingRef.current.currentPoints.push(point);
      const tempOp: StrokeOp = {
        kind: 'stroke',
        tool: 'pen',
        points: drawingRef.current.currentPoints,
        color,
        width: lineWidth,
        style: lineStyle,
      };
      redraw([...ops, tempOp], null, true, false);
    } else if (drawingRef.current.startPoint) {
      const handler = shapeRegistry.getHandlerByTool(tool);
      if (handler) {
        const tempOp = handler.create(drawingRef.current.startPoint, point, {
          color,
          width: lineWidth,
          style: lineStyle,
        });
        if (tempOp) {
          redraw([...ops, tempOp], null, true, false);
        }
      }
    }
  };

  const commitSelectionDrag = () => {
    const drag = selectionDrag.current;
    if (!drag.isDragging) return;
    if (drag.lastPreview && drag.index != null) {
      const idx = drag.index;
      broadcastReset(ops, idx);
    } else if (drag.index != null) {
      redraw(ops, drag.index, true, true);
      setSelectedIndex(drag.index);
    }
    clearSelectionDrag();
  };

  const finishDrawing = (point?: Point) => {
    if (tool === 'select') {
      commitSelectionDrag();
      return;
    }
    if (!drawingRef.current.isDrawing) return;
    drawingRef.current.isDrawing = false;
    const endPoint = point ?? drawingRef.current.currentPoints.at(-1);
    let op: DrawOp | null = null;

    if (tool === 'pen') {
      if (drawingRef.current.currentPoints.length < 2) return;
      op = {
        kind: 'stroke',
        tool: 'pen',
        points: drawingRef.current.currentPoints,
        color,
        width: lineWidth,
        style: lineStyle,
      };
    } else if (drawingRef.current.startPoint && endPoint) {
      const handler = shapeRegistry.getHandlerByTool(tool);
      if (handler) {
        op = handler.create(drawingRef.current.startPoint, endPoint, {
          color,
          width: lineWidth,
          style: lineStyle,
        });
      }
    }

    drawingRef.current.currentPoints = [];
    drawingRef.current.startPoint = null;

    if (!op) return;
    
    setRedoStack([]);
    setSelectedIndex(null);
    setOps((prev) => {
      const next = [...prev, op];
      redraw(next, null, false, true);
      return next;
    });
    sendOp(op);
  };

  const handleMouseUp: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    if (tool === 'eraser') {
      if ( erasingRef.current.isErasing && erasingRef.current.eraserPath.length > 0) {
        const path = erasingRef.current.eraserPath;
        const initialOps = erasingRef.current.initialOps; // 使用开始擦除时的 ops 快照

        // 情况 1：橡皮擦「点击」一次（路径几乎没有移动） => 作为整图删除使用
        if (path.length === 1) {
          const point = path[0];
          const eraseRadius = lineWidth * 2;
          const idx = hitTest(initialOps, point, eraseRadius, spatialIndexRef.current);
          if (idx != null) {
            const nextOps = initialOps.filter((_, i) => i !== idx);
            setSelectedIndex(null);
            broadcastReset(nextOps, null);
          } else {
            // 未命中任何图形，恢复初始状态
            setOps(initialOps);
            redraw(initialOps, null, true);
          }
        } else {
          // 情况 2：橡皮擦「按住拖动」 => 使用路径对笔画做局部擦除
          const eraserRadius = lineWidth * 2;
          const { nextOps, changed } = eraseWithPath(
            path,
            eraserRadius,
            initialOps
          );
          
          if (changed) {
            // 通过 WebSocket 同步擦除结果（包含笔画被分割后的新状态）
            setSelectedIndex(null);
            broadcastReset(nextOps, null);
          } else {
            // 如果没有改变，恢复初始状态
            setOps(initialOps);
            redraw(initialOps, null, true);
          }
        }
      }
      erasingRef.current.isErasing = false;
      erasingRef.current.eraserPath = [];
      erasingRef.current.initialOps = [];
      return;
    }
    const point = canvasToPoint(e);
    finishDrawing(point);
  };

  const handleMouseLeave: React.MouseEventHandler<HTMLCanvasElement> = () => {
    if (tool === 'eraser') {
      if (erasingRef.current.isErasing && erasingRef.current.eraserPath.length > 0) {
        // 提交擦除操作
        const eraserRadius = lineWidth * 2;
        const initialOps = erasingRef.current.initialOps; // 使用开始擦除时的 ops 快照
        const { nextOps, changed } = eraseWithPath(
          erasingRef.current.eraserPath,
          eraserRadius,
          initialOps
        );
        
        if (changed) {
          broadcastReset(nextOps, null);
        } else {
          // 如果没有改变，恢复初始状态
          setOps(initialOps);
          redraw(initialOps, null, true);
        }
      }
      erasingRef.current.isErasing = false;
      erasingRef.current.eraserPath = [];
      erasingRef.current.initialOps = [];
      return;
    }
    finishDrawing();
  };

  // 初始化 Canvas 尺寸和空间索引
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      
      const bounds = {
        minX: 0,
        maxX: canvas.width,
        minY: 0,
        maxY: canvas.height,
      };
      
      if (!spatialIndexRef.current || 
          spatialIndexRef.current.bounds.maxX !== bounds.maxX ||
          spatialIndexRef.current.bounds.maxY !== bounds.maxY) {
        const cellSize = Math.max(50, Math.min(200, Math.max(canvas.width, canvas.height) / 15));
        spatialIndexRef.current = new SpatialIndex(cellSize, bounds);
        if (ops.length > 0) {
          spatialIndexRef.current.rebuild(ops);
        }
      }
      
      redraw(ops, selectedIndex, true);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops.length]);

  useEffect(() => {
    const index = spatialIndexRef.current;
    if (!index) return;
    
    const indexOpsLength = index.getOpsCount();
    
    if (ops.length < 1000) {
      if (indexOpsLength !== ops.length) {
        // 清空索引以节省内存
        if (ops.length === 0) {
          index.clear();
        } else {
          index.rebuild(ops);
        }
      }
      return;
    }

    if (indexOpsLength !== ops.length) {
      const diff = Math.abs(indexOpsLength - ops.length);
      const ratio = indexOpsLength > 0 ? diff / indexOpsLength : 1;
      
      if (diff > 100 || ratio > 0.1 || ops.length === 0) {
        index.rebuild(ops);
      }
    }
  }, [ops.length]);

  const selectedOp =
    selectedIndex != null && selectedIndex >= 0 && selectedIndex < ops.length
      ? ops[selectedIndex]
      : null;

  const isTextSelected = selectedOp?.kind === 'text';
  const selectedTextBox = (() => {
    if (!isTextSelected) return null;
    const handler = shapeRegistry.getHandler('text');
    if (!handler) return null;
    return handler.getBoundingBox(selectedOp as any, 6);
  })();

  const selectedStrokeBox = (() => {
    if (!selectedOp || selectedOp.kind === 'text') return null;
    const handler = shapeRegistry.getHandler(selectedOp.kind);
    if (!handler) return null;
    return handler.getBoundingBox(selectedOp as any, 6);
  })();

  return (
    <div className="whiteboard-container">
      <div className="toolbar">
        <div className="tool-group">
          <button
            className={tool === 'select' ? 'tool-button active' : 'tool-button'}
            onClick={() => setTool('select')}
          >
            选择
          </button>
          {/* 动态生成绘图工具按钮 */}
          {shapeRegistry.getDrawingTools().map((handler) => (
            <button
              key={handler.tool}
              className={tool === handler.tool ? 'tool-button active' : 'tool-button'}
              onClick={() => setTool(handler.tool)}
            >
              {handler.label}
            </button>
          ))}
          <button
            className={tool === 'eraser' ? 'tool-button active' : 'tool-button'}
            onClick={() => setTool('eraser')}
          >
            橡皮擦
          </button>
        </div>
        <div className="tool-group">
          <label className="label">颜色</label>
          <input
            type="color"
            value={selectedOp ? selectedOp.color : color}
            onChange={(e) => {
              const nextColor = e.target.value;
              setColor(nextColor);
              if (selectedOp && selectedIndex != null) {
                const nextOps = ops.map((op, idx) =>
                  idx === selectedIndex ? { ...op, color: nextColor } : op
                );
                broadcastReset(nextOps, selectedIndex);
              }
            }}
          />
        </div>
        <div className="tool-group">
          <label className="label">线宽</label>
          <input
            type="range"
            min={1}
            max={10}
            value={isTextSelected ? lineWidth : selectedOp ? selectedOp.width : lineWidth}
            onChange={(e) => {
              const nextWidth = Number(e.target.value);
              setLineWidth(nextWidth);
              if (selectedOp && selectedIndex != null && selectedOp.kind !== 'text') {
                const nextOps = ops.map((op, idx) =>
                  idx === selectedIndex ? { ...op, width: nextWidth } : op
                );
                broadcastReset(nextOps, selectedIndex);
              }
            }}
          />
        </div>
        {(tool === 'text' || isTextSelected || !!textInputState) && (
          <div className="tool-group">
            <label className="label">字体大小</label>
            <input
              type="range"
              min={8}
              max={200}
              value={
                isTextSelected
                  ? (selectedOp?.width ?? textFontSize)
                  : textInputState
                  ? textInputState.fontSize
                  : textFontSize
              }
              onChange={(e) => {
                const nextSize = clampNumber(Number(e.target.value), 8, 200);
                setTextFontSize(nextSize);
                if (textInputState) {
                  setTextInputState((prev) =>
                    prev ? { ...prev, fontSize: nextSize } : prev,
                  );
                  return;
                }
                if (isTextSelected && selectedIndex != null) {
                  const nextOps = ops.map((op, idx) =>
                    idx === selectedIndex && op.kind === 'text' ? { ...op, width: nextSize } : op,
                  );
                  broadcastReset(nextOps, selectedIndex);
                }
              }}
            />
          </div>
        )}
        <div className="tool-group">
          <label className="label">线型</label>
          <button
            className={
              selectedOp && 'style' in selectedOp
                ? selectedOp.style === 'solid'
                  ? 'tool-button active'
                  : 'tool-button'
                : lineStyle === 'solid'
                ? 'tool-button active'
                : 'tool-button'
            }
            onClick={() => {
              const nextStyle: LineStyle = 'solid';
              setLineStyle(nextStyle);
              if (selectedOp && selectedIndex != null && 'style' in selectedOp) {
                const nextOps = ops.map((op, idx) =>
                  idx === selectedIndex && 'style' in op ? { ...op, style: nextStyle } : op,
                );
                broadcastReset(nextOps, selectedIndex);
              }
            }}
          >
            实线
          </button>
          <button
            className={
              selectedOp && 'style' in selectedOp
                ? selectedOp.style === 'dashed'
                  ? 'tool-button active'
                  : 'tool-button'
                : lineStyle === 'dashed'
                ? 'tool-button active'
                : 'tool-button'
            }
            onClick={() => {
              const nextStyle: LineStyle = 'dashed';
              setLineStyle(nextStyle);
              if (selectedOp && selectedIndex != null && 'style' in selectedOp) {
                const nextOps = ops.map((op, idx) =>
                  idx === selectedIndex && 'style' in op ? { ...op, style: nextStyle } : op,
                );
                broadcastReset(nextOps, selectedIndex);
              }
            }}
          >
            虚线
          </button>
        </div>
        <div className="tool-group">
          <button className="tool-button" onClick={handleUndo}>
            撤销
          </button>
          <button className="tool-button" onClick={handleRedo}>
            重做
          </button>
        </div>
      </div>
      {selectedOp && (() => {
        const handler = shapeRegistry.getHandler(selectedOp.kind);
        const displayName = handler ? handler.getDisplayName(selectedOp as any) : '未知图形';
        return (
          <div className="selection-bar">
            <span className="selection-text">已选中图形：{displayName}</span>
            <button
              className="tool-button selection-delete-button"
              onClick={() => {
                if (selectedIndex == null) return;
                const nextOps = ops.filter((_, idx) => idx !== selectedIndex);
                setSelectedIndex(null);
                broadcastReset(nextOps, null);
              }}
            >
              删除
            </button>
          </div>
        );
      })()}

      <div className="canvas-wrapper">
        <canvas
          ref={canvasRef}
          className="canvas"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onDoubleClick={handleDoubleClick}
        />
        {selectedStrokeBox && tool === 'select' && !textInputState && (
          <div
            className="text-resize-handle"
            style={{
              left: selectedStrokeBox.maxX,
              top: selectedStrokeBox.maxY,
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startResizeSelectedLine(e.clientX, e.clientY);
            }}
            title="拖动调整线条粗细"
          />
        )}
        {selectedTextBox && tool === 'select' && !textInputState && (
          <div
            className="text-resize-handle"
            style={{
              left: selectedTextBox.maxX,
              top: selectedTextBox.maxY,
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startResizeSelectedText(e.clientX, e.clientY);
            }}
            title="拖动缩放文字大小"
          />
        )}
        {textInputState && (
          <input
            ref={textInputRef}
            className="text-input-overlay"
            autoFocus
            type="text"
            style={{
              left: textInputState.x,
              top: textInputState.y,
              fontSize: textInputState.fontSize,
              color: textInputState.color,
              width: `${Math.max(6, (textInputState.value || '').length + 4)}ch`,
              maxWidth: 'calc(100% - 16px)',
            }}
            size={Math.max(6, (textInputState.value || '').length + 4)}
            value={textInputState.value}
            onMouseDown={(e) => {
              // 避免点到输入框本身时又触发 canvas 的选择/绘制逻辑
              e.stopPropagation();
            }}
            onChange={(e) =>
              setTextInputState((prev) =>
                prev ? { ...prev, value: e.target.value } : prev,
              )
            }
            onBlur={() => {
              // 延迟提交：避免因为挂载/聚焦时序导致的“立刻 blur -> 提交 -> 输入框消失”
              setTimeout(() => {
                if (document.activeElement === textInputRef.current) return;
                commitTextInput();
              }, 0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitTextInput();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                commitTextInput(true);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}


