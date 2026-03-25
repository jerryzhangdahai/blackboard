import type { RectOp, Point, LineStyle } from '../types';
import type { ShapeHandler } from '../shapeHandler';

export class RectHandler implements ShapeHandler<RectOp> {
  readonly kind = 'rect' as const;
  readonly tool = 'rect' as const;
  readonly label = '矩形';
  readonly draggable = true;

  draw(ctx: CanvasRenderingContext2D, op: RectOp, _selected: boolean): void {
    const w = op.end.x - op.start.x;
    const h = op.end.y - op.start.y;
    ctx.strokeRect(op.start.x, op.start.y, w, h);
  }

  hitTest(op: RectOp, point: Point, tolerance = 6): boolean {
    const minX = Math.min(op.start.x, op.end.x) - tolerance;
    const maxX = Math.max(op.start.x, op.end.x) + tolerance;
    const minY = Math.min(op.start.y, op.end.y) - tolerance;
    const maxY = Math.max(op.start.y, op.end.y) + tolerance;
    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  }

  translate(op: RectOp, dx: number, dy: number): RectOp {
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
  }): RectOp {
    return {
      kind: 'rect',
      tool: 'rect',
      start,
      end,
      ...props,
    };
  }

  getDisplayName(_op: RectOp): string {
    return '矩形';
  }

  getBoundingBox(op: RectOp, padding = 0): {
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

