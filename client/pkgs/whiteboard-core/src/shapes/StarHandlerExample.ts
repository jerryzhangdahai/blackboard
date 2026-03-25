/**
 * 星形处理器示例 - 使用继承方式实现
 * 
 * 这个文件展示了如何使用 BaseShapeHandler 基类来实现新的图形类型
 * 注意：这是一个示例文件，如果需要使用，请重命名为 StarHandler.ts 并注册
 */

import type { StarOp, Point, LineStyle } from '../types';
import { BaseShapeHandler } from '../BaseShapeHandler';

// 首先需要在 types.ts 中定义 StarOp 类型
// export type StarOp = {
//   kind: 'star';
//   tool: 'star';
//   center: Point;
//   radius: number;
//   points: number;
//   color: string;
//   width: number;
//   style: LineStyle;
// };

export class StarHandlerExample extends BaseShapeHandler<StarOp> {
  readonly kind = 'star' as const;
  readonly tool = 'star' as const;
  readonly label = '星形';
  readonly draggable = true;

  /**
   * 绘制星形
   * 使用基类的 setupContext() 方法设置样式
   */
  draw(ctx: CanvasRenderingContext2D, op: StarOp, _selected: boolean): void {
    // 使用基类提供的样式设置方法
    this.setupContext(ctx, op, selected);

    const { center, radius, points } = op;
    const angleStep = (Math.PI * 2) / points;

    ctx.beginPath();

    // 绘制星形的外圈和内圈点
    for (let i = 0; i < points * 2; i++) {
      const angle = (i * angleStep) / 2 - Math.PI / 2;
      const r = i % 2 === 0 ? radius : radius * 0.5; // 外圈和内圈交替
      const x = center.x + r * Math.cos(angle);
      const y = center.y + r * Math.sin(angle);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.closePath();
    ctx.stroke();
  }

  /**
   * 命中测试
   * 使用基类提供的工具方法
   */
  hitTest(op: StarOp, point: Point, tolerance = 6): boolean {
    // 使用基类的 distance() 方法
    const dist = this.distance(point, op.center);
    return dist <= op.radius + tolerance;
  }

  /**
   * 平移星形
   */
  translate(op: StarOp, dx: number, dy: number): StarOp {
    return {
      ...op,
      center: { x: op.center.x + dx, y: op.center.y + dy },
    };
  }

  /**
   * 创建星形操作
   */
  create(
    start: Point,
    end: Point,
    props: {
      color: string;
      width: number;
      style: LineStyle;
    }
  ): StarOp {
    // 使用基类的 distance() 方法计算半径
    const radius = this.distance(start, end);

    return {
      kind: 'star',
      tool: 'star',
      center: start,
      radius,
      points: 5, // 默认5角星
      ...props,
    };
  }

  /**
   * 重写显示名称（可选）
   * 如果不重写，会使用基类的默认实现（返回 this.label）
   */
  getDisplayName(op: StarOp): string {
    return `${op.points}角星`;
  }
}

