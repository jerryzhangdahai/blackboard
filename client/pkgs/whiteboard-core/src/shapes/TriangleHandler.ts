import type { TriangleOp, Point, LineStyle } from '../types';
import type { ShapeHandler } from '../shapeHandler';

export class TriangleHandler implements ShapeHandler<TriangleOp> {
  readonly kind = 'triangle' as const;
  readonly tool = 'triangle' as const;
  readonly label = '三角形';
  readonly draggable = true;

  draw(ctx: CanvasRenderingContext2D, op: TriangleOp, selected: boolean): void {
    const minX = Math.min(op.start.x, op.end.x);
    const maxX = Math.max(op.start.x, op.end.x);
    const minY = Math.min(op.start.y, op.end.y);
    const maxY = Math.max(op.start.y, op.end.y);
    const p1 = { x: (minX + maxX) / 2, y: minY };
    const p2 = { x: minX, y: maxY };
    const p3 = { x: maxX, y: maxY };
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.stroke();
  }

  hitTest(op: TriangleOp, point: Point, tolerance = 6): boolean {
    const minX = Math.min(op.start.x, op.end.x) - tolerance;
    const maxX = Math.max(op.start.x, op.end.x) + tolerance;
    const minY = Math.min(op.start.y, op.end.y) - tolerance;
    const maxY = Math.max(op.start.y, op.end.y) + tolerance;
    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  }

  translate(op: TriangleOp, dx: number, dy: number): TriangleOp {
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
  }): TriangleOp {
    return {
      kind: 'triangle',
      tool: 'triangle',
      start,
      end,
      ...props,
    };
  }

  getDisplayName(_op: TriangleOp): string {
    return '三角形';
  }

  getBoundingBox(op: TriangleOp, padding = 0): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } {
    return {
      minX: Math.min(op.start.x, op.end.x) - padding,
      maxX: Math.max(op.start.x, op.end.x) + padding,
      minY: Math.min(op.start.y, op.end.y) - padding,
      maxY: Math.max(op.start.y, op.end.y) + padding,
    };
  }
}

