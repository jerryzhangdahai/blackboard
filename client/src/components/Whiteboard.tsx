import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ArrowOp,
  CircleOp,
  DiamondOp,
  DrawOp,
  LineStyle,
  Point,
  RectOp,
  StrokeOp,
  TextOp,
  Tool,
  TriangleOp,
} from '../whiteboard/types';
import { drawOperations, hitTest, translateOp } from '../whiteboard/drawUtils';

type ServerMessage =
  | { type: 'init'; boardId: string; ops: DrawOp[] }
  | { type: 'op'; payload: DrawOp }
  | { type: 'reset'; ops: DrawOp[] };

interface WhiteboardProps {
  boardId: string;
}

// 开发环境：前端跑在 5173，后端在 4000；
// 构建后的部署版：前端和后端是同一端口，直接用 location.host。
const WS_URL =
  import.meta.env.DEV
    ? `ws://${window.location.hostname}:4000/ws`
    : `ws://${window.location.host}/ws`;

export function Whiteboard({ boardId }: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#1f2937');
  const [lineWidth, setLineWidth] = useState(3);
  const [lineStyle, setLineStyle] = useState<LineStyle>('solid');
  const [ops, setOps] = useState<DrawOp[]>([]);
  const [redoStack, setRedoStack] = useState<DrawOp[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

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
  const erasingRef = useRef(false);

  const clearSelectionDrag = () => {
    selectionDrag.current = {
      isDragging: false,
      index: null,
      startPoint: null,
      opSnapshot: null,
      lastPreview: null,
    };
  };

  // Undo / Redo（本地实现，同时通过 reset 与其他人同步）
  const broadcastReset = (next: DrawOp[], nextSelected: number | null = null) => {
    setSelectedIndex(nextSelected);
    setOps(next);
    redraw(next, nextSelected);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'reset', ops: next }));
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

  // 全局快捷键：工具切换 & 撤销/重做
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 避免在输入框内抢占快捷键
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

      if (e.ctrlKey && key === '1') {
        e.preventDefault();
        setTool('pen');
      } else if (e.ctrlKey && key === '2') {
        e.preventDefault();
        setTool('rect');
      } else if (e.ctrlKey && key === '3') {
        e.preventDefault();
        setTool('circle');
      } else if (e.ctrlKey && key === '4') {
        e.preventDefault();
        setTool('triangle');
      } else if (e.ctrlKey && key === '5') {
        e.preventDefault();
        setTool('diamond');
      } else if (e.ctrlKey && key === '6') {
        e.preventDefault();
        setTool('arrow');
      } else if (e.ctrlKey && key === '7') {
        e.preventDefault();
        setTool('text');
      } else if (e.ctrlKey && !e.shiftKey && key === 'z') {
        // Ctrl+Z 撤销
        e.preventDefault();
        handleUndo();
      } else if (
        (e.ctrlKey && e.shiftKey && key === 'z') ||
        (e.ctrlKey && key === 'y')
      ) {
        // Ctrl+Shift+Z 或 Ctrl+Y 重做
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);

  // 连接 WebSocket
  useEffect(() => {
    const ws = new WebSocket(`${WS_URL}?boardId=${boardId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data);
      if (msg.type === 'init') {
        setSelectedIndex(null);
        clearSelectionDrag();
        setOps(msg.ops);
        redraw(msg.ops, null);
      } else if (msg.type === 'op') {
        setSelectedIndex(null);
        clearSelectionDrag();
        setOps((prev) => {
          const next = [...prev, msg.payload];
          redraw(next, null);
          return next;
        });
      } else if (msg.type === 'reset') {
        setSelectedIndex(null);
        clearSelectionDrag();
        setOps(msg.ops);
        redraw(msg.ops, null);
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

  // 重绘画布（可选高亮选中的图形）
  const redraw = (operations: DrawOp[] = ops, selected: number | null = selectedIndex) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawOperations(ctx, operations, selected);
  };

  // 发送单个操作
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
    ws.send(JSON.stringify({ type: 'op', payload: op }));
  };

  const canvasToPoint = (e: React.MouseEvent<HTMLCanvasElement, MouseEvent>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  // 命中测试：从最后一个图形开始查找，优先选到“最上层”的

  const handleMouseDown: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    const point = canvasToPoint(e);
    if (tool === 'select') {
      const idx = hitTest(ops, point);
      setSelectedIndex(idx);
      redraw(ops, idx);
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
      // 全局监听 mouseup，保证无论鼠标在画布内外松开，都能结束拖拽
      const handleUp = () => {
        commitSelectionDrag();
        window.removeEventListener('mouseup', handleUp);
      };
      window.addEventListener('mouseup', handleUp);
      return;
    } else if (tool === 'eraser') {
      // 橡皮擦：按下时开始擦除，并删除当前命中的图形
      erasingRef.current = true;
      const idx = hitTest(ops, point);
      if (idx != null) {
        const nextOps = ops.filter((_, i) => i !== idx);
        setSelectedIndex(null);
        broadcastReset(nextOps, null);
      } else {
        setSelectedIndex(null);
        redraw(ops, null);
      }
      return;
    } else if (tool === 'text') {
      const content = window.prompt('请输入文本内容：');
      if (content && content.trim()) {
        const textOp: TextOp = {
          kind: 'text',
          tool: 'text',
          position: point,
          text: content.trim(),
          color,
          width: lineWidth * 4,
        };
        setRedoStack([]);
        setSelectedIndex(null);
        sendOp(textOp);
      }
      return;
    }
    drawingRef.current.isDrawing = true;
    drawingRef.current.currentPoints = [point];
    drawingRef.current.startPoint = point;
  };

  const handleMouseMove: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    if (tool === 'select') {
      const drag = selectionDrag.current;
      if (!drag.isDragging || drag.index == null || !drag.startPoint || !drag.opSnapshot) return;
      const point = canvasToPoint(e);
      const dx = point.x - drag.startPoint.x;
      const dy = point.y - drag.startPoint.y;
      // 仅支持矩形/圆形拖拽，笔画保持原样
      if (drag.opSnapshot.kind === 'stroke') return;
      const movedOp = translateOp(drag.opSnapshot, dx, dy);
      drag.lastPreview = movedOp;
      const previewOps = ops.map((op, idx) => (idx === drag.index ? movedOp : op));
      redraw(previewOps, drag.index);
      return;
    }
    if (tool === 'eraser') {
      if (!erasingRef.current) return;
      const point = canvasToPoint(e);
      const idx = hitTest(ops, point);
      if (idx != null) {
        const nextOps = ops.filter((_, i) => i !== idx);
        setSelectedIndex(null);
        broadcastReset(nextOps, null);
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
      redraw([...ops, tempOp]);
    } else if (tool === 'rect' && drawingRef.current.startPoint) {
      const tempOp: RectOp = {
        kind: 'rect',
        tool: 'rect',
        start: drawingRef.current.startPoint,
        end: point,
        color,
        width: lineWidth,
        style: lineStyle,
      };
      redraw([...ops, tempOp]);
    } else if (tool === 'circle' && drawingRef.current.startPoint) {
      const start = drawingRef.current.startPoint;
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      const tempOp: CircleOp = {
        kind: 'circle',
        tool: 'circle',
        center: start,
        radius,
        color,
        width: lineWidth,
        style: lineStyle,
      };
      redraw([...ops, tempOp]);
    } else if (tool === 'triangle' && drawingRef.current.startPoint) {
      const tempOp: TriangleOp = {
        kind: 'triangle',
        tool: 'triangle',
        start: drawingRef.current.startPoint,
        end: point,
        color,
        width: lineWidth,
        style: lineStyle,
      };
      redraw([...ops, tempOp]);
    } else if (tool === 'diamond' && drawingRef.current.startPoint) {
      const tempOp: DiamondOp = {
        kind: 'diamond',
        tool: 'diamond',
        start: drawingRef.current.startPoint,
        end: point,
        color,
        width: lineWidth,
        style: lineStyle,
      };
      redraw([...ops, tempOp]);
    } else if (tool === 'arrow' && drawingRef.current.startPoint) {
      const tempOp: ArrowOp = {
        kind: 'arrow',
        tool: 'arrow',
        start: drawingRef.current.startPoint,
        end: point,
        color,
        width: lineWidth,
        style: lineStyle,
      };
      redraw([...ops, tempOp]);
    }
  };

  const commitSelectionDrag = () => {
    const drag = selectionDrag.current;
    if (!drag.isDragging) return;
    if (drag.lastPreview && drag.index != null) {
      const idx = drag.index;
      const nextOps = ops.map((op, opIdx) => (opIdx === idx ? drag.lastPreview! : op));
      broadcastReset(nextOps, idx);
    } else if (drag.index != null) {
      redraw(ops, drag.index);
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
    } else if (tool === 'rect' && drawingRef.current.startPoint && endPoint) {
      op = {
        kind: 'rect',
        tool: 'rect',
        start: drawingRef.current.startPoint,
        end: endPoint,
        color,
        width: lineWidth,
        style: lineStyle,
      };
    } else if (tool === 'circle' && drawingRef.current.startPoint && endPoint) {
      const start = drawingRef.current.startPoint;
      const dx = endPoint.x - start.x;
      const dy = endPoint.y - start.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      op = {
        kind: 'circle',
        tool: 'circle',
        center: start,
        radius,
        color,
        width: lineWidth,
        style: lineStyle,
      };
    } else if (tool === 'triangle' && drawingRef.current.startPoint && endPoint) {
      op = {
        kind: 'triangle',
        tool: 'triangle',
        start: drawingRef.current.startPoint,
        end: endPoint,
        color,
        width: lineWidth,
        style: lineStyle,
      };
    } else if (tool === 'diamond' && drawingRef.current.startPoint && endPoint) {
      op = {
        kind: 'diamond',
        tool: 'diamond',
        start: drawingRef.current.startPoint,
        end: endPoint,
        color,
        width: lineWidth,
        style: lineStyle,
      };
    } else if (tool === 'arrow' && drawingRef.current.startPoint && endPoint) {
      op = {
        kind: 'arrow',
        tool: 'arrow',
        start: drawingRef.current.startPoint,
        end: endPoint,
        color,
        width: lineWidth,
        style: lineStyle,
      };
    }

    drawingRef.current.currentPoints = [];
    drawingRef.current.startPoint = null;

    if (!op) return;
    // 不在本地立即追加，由服务端 echo 回来的消息统一追加，避免同一图形出现两份
    setRedoStack([]);
    setSelectedIndex(null);
    sendOp(op);
  };

  const handleMouseUp: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    if (tool === 'eraser') {
      erasingRef.current = false;
      return;
    }
    const point = canvasToPoint(e);
    finishDrawing(point);
  };

  const handleMouseLeave: React.MouseEventHandler<HTMLCanvasElement> = () => {
    if (tool === 'eraser') {
      erasingRef.current = false;
      return;
    }
    finishDrawing();
  };

  // 初始化 Canvas 尺寸
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      redraw(ops);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops.length]);

  const selectedOp =
    selectedIndex != null && selectedIndex >= 0 && selectedIndex < ops.length
      ? ops[selectedIndex]
      : null;

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
          <button
            className={tool === 'pen' ? 'tool-button active' : 'tool-button'}
            onClick={() => setTool('pen')}
          >
            铅笔
          </button>
          <button
            className={tool === 'rect' ? 'tool-button active' : 'tool-button'}
            onClick={() => setTool('rect')}
          >
            矩形
          </button>
          <button
            className={tool === 'circle' ? 'tool-button active' : 'tool-button'}
            onClick={() => setTool('circle')}
          >
            圆形
          </button>
          <button
            className={tool === 'triangle' ? 'tool-button active' : 'tool-button'}
            onClick={() => setTool('triangle')}
          >
            三角形
          </button>
          <button
            className={tool === 'diamond' ? 'tool-button active' : 'tool-button'}
            onClick={() => setTool('diamond')}
          >
            菱形
          </button>
          <button
            className={tool === 'arrow' ? 'tool-button active' : 'tool-button'}
            onClick={() => setTool('arrow')}
          >
            箭头
          </button>
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
            value={selectedOp ? selectedOp.width : lineWidth}
            onChange={(e) => {
              const nextWidth = Number(e.target.value);
              setLineWidth(nextWidth);
              if (selectedOp && selectedIndex != null) {
                const nextOps = ops.map((op, idx) =>
                  idx === selectedIndex ? { ...op, width: nextWidth } : op
                );
                broadcastReset(nextOps, selectedIndex);
              }
            }}
          />
        </div>
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
      {selectedOp && (
        <div className="tool-group" style={{ padding: '0 8px 4px', fontSize: 12, color: '#6b7280' }}>
          <span>
            已选中图形：
            {selectedOp.kind === 'rect'
              ? '矩形'
              : selectedOp.kind === 'circle'
              ? '圆形'
              : selectedOp.kind === 'triangle'
              ? '三角形'
              : selectedOp.kind === 'diamond'
              ? '菱形'
              : selectedOp.kind === 'arrow'
              ? '箭头'
              : selectedOp.kind === 'text'
              ? '文本'
              : '线条'}
          </span>
          <button
            className="tool-button"
            style={{ marginLeft: 8 }}
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
      )}

      <div className="canvas-wrapper">
        <canvas
          ref={canvasRef}
          className="canvas"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />
      </div>
    </div>
  );
}


