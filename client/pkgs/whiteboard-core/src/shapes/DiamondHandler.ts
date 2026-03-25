import type { DiamondOp, Point, LineStyle } from '../types';
import type { ShapeHandler } from '../shapeHandler';

export class DiamondHandler implements ShapeHandler<DiamondOp> {
  readonly kind = 'diamond' as const;
  readonly tool = 'diamond' as const;
  readonly label = '菱形';
  readonly draggable = true;

  draw(ctx: CanvasRenderingContext2D, op: DiamondOp, _selected: boolean): void {
    const minX = Math.min(op.start.x, op.end.x);
    const maxX = Math.max(op.start.x, op.end.x);
    const minY = Math.min(op.start.y, op.end.y);
    const maxY = Math.max(op.start.y, op.end.y);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    ctx.beginPath();
    ctx.moveTo(cx, minY);
    ctx.lineTo(maxX, cy);
    ctx.lineTo(cx, maxY);
    ctx.lineTo(minX, cy);
    ctx.closePath();
    ctx.stroke();
  }

  hitTest(op: DiamondOp, point: Point, tolerance = 6): boolean {
    const minX = Math.min(op.start.x, op.end.x) - tolerance;
    const maxX = Math.max(op.start.x, op.end.x) + tolerance;
    const minY = Math.min(op.start.y, op.end.y) - tolerance;
    const maxY = Math.max(op.start.y, op.end.y) + tolerance;
    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  }

  translate(op: DiamondOp, dx: number, dy: number): DiamondOp {
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
  }): DiamondOp {
    return {
      kind: 'diamond',
      tool: 'diamond',
      start,
      end,
      ...props,
    };
  }

  getDisplayName(_op: DiamondOp): string {
    return '菱形';
  }

  getBoundingBox(op: DiamondOp, padding = 0): {
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

