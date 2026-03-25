import type { TextOp, Point } from '../types';
import type { ShapeHandler } from '../shapeHandler';

export class TextHandler implements ShapeHandler<TextOp> {
  readonly kind = 'text' as const;
  readonly tool = 'text' as const;
  readonly label = '文本';
  readonly draggable = true;

  draw(ctx: CanvasRenderingContext2D, op: TextOp, _selected: boolean): void {
    const fontSize = op.width || 16;
    ctx.save();
    ctx.font = `${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    ctx.fillStyle = op.color;
    ctx.textBaseline = 'top';
    ctx.fillText(op.text, op.position.x, op.position.y);
    ctx.restore();
  }

  hitTest(op: TextOp, point: Point, tolerance = 6): boolean {
    const fontSize = op.width || 16;
    const halfH = fontSize;
    const len = op.text.length || 1;
    const halfW = fontSize * len * 0.3;
    const minX = op.position.x - tolerance;
    const maxX = op.position.x + halfW * 2 + tolerance;
    const minY = op.position.y - tolerance;
    const maxY = op.position.y + halfH * 2 + tolerance;
    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  }

  translate(op: TextOp, dx: number, dy: number): TextOp {
    return {
      ...op,
      position: { x: op.position.x + dx, y: op.position.y + dy },
    };
  }

  create(_start: Point, _end: Point, _props: {
    color: string;
    width: number;
    style: any;
  }): TextOp | null {
    // 文本通过 createFromPoint 创建
    return null;
  }

  createFromPoint(point: Point, props: {
    color: string;
    width: number;
    style?: any;
  }): TextOp {
    const content = window.prompt('请输入文本内容：');
    if (!content || !content.trim()) {
      throw new Error('用户取消输入');
    }
    return {
      kind: 'text',
      tool: 'text',
      position: point,
      text: content.trim(),
      color: props.color,
      width: props.width * 4, // 文本的 width 用作字体大小
    };
  }

  getDisplayName(_op: TextOp): string {
    return '文本';
  }

  getBoundingBox(op: TextOp, padding = 0): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } {
    const fontSize = op.width || 16;
    const halfH = fontSize;
    const len = op.text.length || 1;
    const halfW = fontSize * len * 0.3;
    
    return {
      minX: op.position.x - padding,
      maxX: op.position.x + halfW * 2 + padding,
      minY: op.position.y - padding,
      maxY: op.position.y + halfH * 2 + padding,
    };
  }
}

