import type {
  ArrowOp,
  CircleOp,
  DiamondOp,
  DrawOp,
  Point,
  RectOp,
  TextOp,
  TriangleOp,
} from './types';

export function drawOperations(
  ctx: CanvasRenderingContext2D,
  ops: DrawOp[],
  selectedIndex: number | null,
) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  ops.forEach((op, index) => {
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.width;
    if ('style' in op && op.style === 'dashed') {
      ctx.setLineDash([8, 4]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const isSelected = selectedIndex != null && index === selectedIndex;
    if (isSelected) {
      ctx.shadowColor = 'rgba(59,130,246,0.9)';
      ctx.shadowBlur = 12;
    }

    if (op.kind === 'stroke') {
      const pts = op.points;
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    } else if (op.kind === 'rect') {
      const { start, end } = op as RectOp;
      const w = end.x - start.x;
      const h = end.y - start.y;
      ctx.strokeRect(start.x, start.y, w, h);
    } else if (op.kind === 'circle') {
      const { center, radius } = op as CircleOp;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (op.kind === 'triangle') {
      const { start, end } = op as TriangleOp;
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y);
      const p1 = { x: (minX + maxX) / 2, y: minY };
      const p2 = { x: minX, y: maxY };
      const p3 = { x: maxX, y: maxY };
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      ctx.stroke();
    } else if (op.kind === 'diamond') {
      const { start, end } = op as DiamondOp;
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      ctx.beginPath();
      ctx.moveTo(cx, minY);
      ctx.lineTo(maxX, cy);
      ctx.lineTo(cx, maxY);
      ctx.lineTo(minX, cy);
      ctx.closePath();
      ctx.stroke();
    } else if (op.kind === 'arrow') {
      const { start, end } = op as ArrowOp;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      // 箭头三角
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const headLen = 10 + op.width * 1.5;
      const a1 = angle - Math.PI / 8;
      const a2 = angle + Math.PI / 8;
      const p1 = {
        x: end.x - headLen * Math.cos(a1),
        y: end.y - headLen * Math.sin(a1),
      };
      const p2 = {
        x: end.x - headLen * Math.cos(a2),
        y: end.y - headLen * Math.sin(a2),
      };
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.closePath();
      ctx.fillStyle = op.color;
      ctx.fill();
    } else if (op.kind === 'text') {
      const t = op as TextOp;
      const fontSize = t.width || 16;
      ctx.save();
      ctx.font = `${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
      ctx.fillStyle = t.color;
      ctx.textBaseline = 'top';
      ctx.fillText(t.text, t.position.x, t.position.y);
      ctx.restore();
    }

    if (isSelected) {
      ctx.shadowBlur = 0;
    }
  });
}

export function translateOp(op: DrawOp, dx: number, dy: number): DrawOp {
  if (op.kind === 'rect') {
    const rect = op as RectOp;
    return {
      ...rect,
      start: { x: rect.start.x + dx, y: rect.start.y + dy },
      end: { x: rect.end.x + dx, y: rect.end.y + dy },
    };
  }
  if (op.kind === 'circle') {
    const circle = op as CircleOp;
    return {
      ...circle,
      center: { x: circle.center.x + dx, y: circle.center.y + dy },
    };
  }
  if (op.kind === 'triangle' || op.kind === 'diamond' || op.kind === 'arrow') {
    const shape = op as TriangleOp | DiamondOp | ArrowOp;
    return {
      ...shape,
      start: { x: shape.start.x + dx, y: shape.start.y + dy },
      end: { x: shape.end.x + dx, y: shape.end.y + dy },
    } as DrawOp;
  }
  if (op.kind === 'text') {
    const t = op as TextOp;
    return {
      ...t,
      position: { x: t.position.x + dx, y: t.position.y + dy },
    };
  }
  return {
    ...op,
    points:
      op.kind === 'stroke'
        ? op.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
        : (op as any).points,
  };
}

function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    const ddx = px - x1;
    const ddy = py - y1;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }
  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  const clampT = Math.max(0, Math.min(1, t));
  const cx = x1 + clampT * dx;
  const cy = y1 + clampT * dy;
  const ddx = px - cx;
  const ddy = py - cy;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

export function hitTest(ops: DrawOp[], p: Point, tolerance = 6): number | null {
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    if (op.kind === 'rect') {
      const rect = op as RectOp;
      const minX = Math.min(rect.start.x, rect.end.x) - tolerance;
      const maxX = Math.max(rect.start.x, rect.end.x) + tolerance;
      const minY = Math.min(rect.start.y, rect.end.y) - tolerance;
      const maxY = Math.max(rect.start.y, rect.end.y) + tolerance;
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) return i;
    } else if (op.kind === 'circle') {
      const circle = op as CircleOp;
      const dx = p.x - circle.center.x;
      const dy = p.y - circle.center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= circle.radius + tolerance) return i;
    } else if (op.kind === 'stroke') {
      const pts = op.points;
      if (pts.length < 2) continue;
      for (let j = 0; j < pts.length - 1; j++) {
        const a = pts[j];
        const b = pts[j + 1];
        const dist = pointToSegmentDistance(p.x, p.y, a.x, a.y, b.x, b.y);
        if (dist <= tolerance) return i;
      }
    } else if (op.kind === 'triangle' || op.kind === 'diamond') {
      const shape = op as TriangleOp | DiamondOp;
      const minX = Math.min(shape.start.x, shape.end.x) - tolerance;
      const maxX = Math.max(shape.start.x, shape.end.x) + tolerance;
      const minY = Math.min(shape.start.y, shape.end.y) - tolerance;
      const maxY = Math.max(shape.start.y, shape.end.y) + tolerance;
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) return i;
    } else if (op.kind === 'arrow') {
      const arr = op as ArrowOp;
      const dist = pointToSegmentDistance(
        p.x,
        p.y,
        arr.start.x,
        arr.start.y,
        arr.end.x,
        arr.end.y,
      );
      if (dist <= tolerance) return i;
    } else if (op.kind === 'text') {
      const t = op as TextOp;
      const fontSize = t.width || 16;
      const halfH = fontSize;
      const len = t.text.length || 1;
      const halfW = fontSize * len * 0.3;
      const minX = t.position.x - tolerance;
      const maxX = t.position.x + halfW * 2 + tolerance;
      const minY = t.position.y - tolerance;
      const maxY = t.position.y + halfH * 2 + tolerance;
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) return i;
    }
  }
  return null;
}



