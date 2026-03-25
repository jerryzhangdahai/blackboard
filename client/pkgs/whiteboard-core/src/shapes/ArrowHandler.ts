import type { ArrowOp, Point, LineStyle } from '../types';
import type { ShapeHandler } from '../shapeHandler';

export class ArrowHandler implements ShapeHandler<ArrowOp> {
  readonly kind = 'arrow' as const;
  readonly tool = 'arrow' as const;
  readonly label = '箭头';
  readonly draggable = true;

  draw(ctx: CanvasRenderingContext2D, op: ArrowOp, selected: boolean): void {
    // 绘制直线
    ctx.beginPath();
    ctx.moveTo(op.start.x, op.start.y);
    ctx.lineTo(op.end.x, op.end.y);
    ctx.stroke();
    
    // 绘制箭头三角
    const angle = Math.atan2(op.end.y - op.start.y, op.end.x - op.start.x);
    const headLen = 10 + op.width * 1.5;
    const a1 = angle - Math.PI / 8;
    const a2 = angle + Math.PI / 8;
    const p1 = {
      x: op.end.x - headLen * Math.cos(a1),
      y: op.end.y - headLen * Math.sin(a1),
    };
    const p2 = {
      x: op.end.x - headLen * Math.cos(a2),
      y: op.end.y - headLen * Math.sin(a2),
    };
    ctx.beginPath();
    ctx.moveTo(op.end.x, op.end.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.closePath();
    ctx.fillStyle = op.color;
    ctx.fill();
  }

  hitTest(op: ArrowOp, point: Point, tolerance = 6): boolean {
    const dist = this.pointToSegmentDistance(
      point.x,
      point.y,
      op.start.x,
      op.start.y,
      op.end.x,
      op.end.y,
    );
    return dist <= tolerance;
  }

  translate(op: ArrowOp, dx: number, dy: number): ArrowOp {
    return {
      ...op,
      start: { x: op.start.x + dx, y: op.start.y + dy },
      end: { x: op.end.x + dx, y: op.end.y + dy },
    };
  }

  create(start: Point, end: Point, props: {
    color: string;
    width: number;
    style: LineStyle;
  }): ArrowOp {
    return {
      kind: 'arrow',
      tool: 'arrow',
      start,
      end,
      ...props,
    };
  }

  getDisplayName(_op: ArrowOp): string {
    return '箭头';
  }

  getBoundingBox(op: ArrowOp, padding = 0): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } {
    // 箭头包括线条和箭头头部，需要计算完整的边界框
    const headLen = 10 + op.width * 1.5;
    const angle = Math.atan2(op.end.y - op.start.y, op.end.x - op.start.x);
    const a1 = angle - Math.PI / 8;
    const a2 = angle + Math.PI / 8;
    const p1 = {
      x: op.end.x - headLen * Math.cos(a1),
      y: op.end.y - headLen * Math.sin(a1),
    };
    const p2 = {
      x: op.end.x - headLen * Math.cos(a2),
      y: op.end.y - headLen * Math.sin(a2),
    };
    
    const xs = [op.start.x, op.end.x, p1.x, p2.x];
    const ys = [op.start.y, op.end.y, p1.y, p2.y];
    
    return {
      minX: Math.min(...xs) - padding,
      maxX: Math.max(...xs) + padding,
      minY: Math.min(...ys) - padding,
      maxY: Math.max(...ys) + padding,
    };
  }

  private pointToSegmentDistance(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): number {
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
}

