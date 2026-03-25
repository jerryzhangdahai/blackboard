import type { StrokeOp, Point, LineStyle } from '../types';
import type { ShapeHandler } from '../shapeHandler';

export class StrokeHandler implements ShapeHandler<StrokeOp> {
  readonly kind = 'stroke' as const;
  readonly tool = 'pen' as const;
  readonly label = '铅笔';
  readonly draggable = false;

  draw(ctx: CanvasRenderingContext2D, op: StrokeOp, _selected: boolean): void {
    const pts = op.points;
    if (pts.length < 2) return;
    
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
  }

  hitTest(op: StrokeOp, point: Point, tolerance = 6): boolean {
    const pts = op.points;
    if (pts.length < 2) return false;
    
    for (let j = 0; j < pts.length - 1; j++) {
      const a = pts[j];
      const b = pts[j + 1];
      const dist = this.pointToSegmentDistance(point.x, point.y, a.x, a.y, b.x, b.y);
      if (dist <= tolerance) return true;
    }
    return false;
  }

  translate(op: StrokeOp, dx: number, dy: number): StrokeOp {
    return {
      ...op,
      points: op.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    };
  }

  create(_start: Point, _end: Point, _props: {
    color: string;
    width: number;
    style: LineStyle;
  }): StrokeOp | null {
    // stroke 需要多个点，这里返回 null，由调用方处理
    return null;
  }

  createFromPoints(points: Point[], props: {
    color: string;
    width: number;
    style: LineStyle;
  }): StrokeOp {
    return {
      kind: 'stroke',
      tool: 'pen',
      points,
      ...props,
    };
  }

  getDisplayName(_op: StrokeOp): string {
    return '线条';
  }

  getBoundingBox(op: StrokeOp, padding = 0): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } {
    if (op.points.length === 0) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
    
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    
    for (const pt of op.points) {
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
    }
    
    // 考虑线宽
    const linePadding = op.width / 2 + padding;
    
    return {
      minX: minX - linePadding,
      maxX: maxX + linePadding,
      minY: minY - linePadding,
      maxY: maxY + linePadding,
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

