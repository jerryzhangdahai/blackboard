import type { CircleOp, Point, LineStyle } from '../types';
import type { ShapeHandler } from '../shapeHandler';

export class CircleHandler implements ShapeHandler<CircleOp> {
  readonly kind = 'circle' as const;
  readonly tool = 'circle' as const;
  readonly label = '圆形';
  readonly draggable = true;

  draw(ctx: CanvasRenderingContext2D, op: CircleOp, selected: boolean): void {
    ctx.beginPath();
    ctx.arc(op.center.x, op.center.y, op.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  hitTest(op: CircleOp, point: Point, tolerance = 6): boolean {
    const dx = point.x - op.center.x;
    const dy = point.y - op.center.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist <= op.radius + tolerance;
  }

  translate(op: CircleOp, dx: number, dy: number): CircleOp {
    return {
      ...op,
      center: { x: op.center.x + dx, y: op.center.y + dy },
    };
  }

  create(start: Point, end: Point, props: {
    color: string;
    width: number;
    style: LineStyle;
  }): CircleOp {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const radius = Math.sqrt(dx * dx + dy * dy);
    return {
      kind: 'circle',
      tool: 'circle',
      center: start,
      radius,
      ...props,
    };
  }

  getDisplayName(_op: CircleOp): string {
    return '圆形';
  }

  getBoundingBox(op: CircleOp, padding = 0): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } {
    return {
      minX: op.center.x - op.radius - padding,
      maxX: op.center.x + op.radius + padding,
      minY: op.center.y - op.radius - padding,
      maxY: op.center.y + op.radius + padding,
    };
  }
}

