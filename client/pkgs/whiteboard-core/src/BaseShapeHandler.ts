import type { DrawOp, Point, LineStyle } from './types';
import type { ShapeHandler } from './shapeHandler';

/**
 * 图形处理器基类
 * 提供通用方法的默认实现，子类可以继承并重写特定方法
 * 
 * 使用方式：
 * 1. 新图形可以直接继承此类，获得通用逻辑
 * 2. 现有图形保持接口实现不变，完全兼容
 * 3. 可以逐步迁移现有图形到继承方式
 */
export abstract class BaseShapeHandler<T extends DrawOp> implements ShapeHandler<T> {
  // 子类必须实现的抽象属性
  abstract readonly kind: T['kind'];
  abstract readonly tool: T['tool'];
  abstract readonly label: string;
  abstract readonly draggable: boolean;

  /**
   * 设置 Canvas 上下文样式（通用逻辑）
   * 子类可以在 draw() 方法中调用此方法
   */
  protected setupContext(
    ctx: CanvasRenderingContext2D,
    op: T,
    selected: boolean
  ): void {
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.width;
    
    // 设置线型
    if ('style' in op && op.style === 'dashed') {
      ctx.setLineDash([8, 4]);
    } else {
      ctx.setLineDash([]);
    }
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // 选中高亮
    if (selected) {
      ctx.shadowColor = 'rgba(59,130,246,0.9)';
      ctx.shadowBlur = 12;
    } else {
      ctx.shadowBlur = 0;
    }
  }

  /**
   * 绘制图形（抽象方法，子类必须实现）
   */
  abstract draw(ctx: CanvasRenderingContext2D, op: T, selected: boolean): void;

  /**
   * 命中测试（抽象方法，子类必须实现）
   */
  abstract hitTest(op: T, point: Point, tolerance?: number): boolean;

  /**
   * 平移图形（抽象方法，子类必须实现）
   */
  abstract translate(op: T, dx: number, dy: number): T;

  /**
   * 创建图形操作（抽象方法，子类必须实现）
   */
  abstract create(
    start: Point,
    end: Point,
    props: {
      color: string;
      width: number;
      style: LineStyle;
    }
  ): T | null;

  /**
   * 创建图形操作（可选，用于特殊交互）
   * 默认返回 null，子类可以重写
   */
  createFromPoint?(
    point: Point,
    props: {
      color: string;
      width: number;
      style?: LineStyle;
    }
  ): T | null {
    return null;
  }

  /**
   * 获取显示名称
   * 默认返回 label，子类可以重写
   */
  getDisplayName(_op: T): string {
    return this.label;
  }

  /**
   * 计算两点之间的距离（工具方法）
   */
  protected distance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 点到线段的距离（工具方法，用于命中测试）
   */
  protected pointToSegmentDistance(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
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

  /**
   * 获取矩形的边界框（工具方法，已重命名为 getBoundingBoxFromPoints）
   * @deprecated 使用 getBoundingBoxFromPoints 代替
   */
  protected getBoundingBox(
    start: Point,
    end: Point,
    tolerance = 0
  ): { minX: number; maxX: number; minY: number; maxY: number } {
    return this.getBoundingBoxFromPoints(start, end, tolerance);
  }

  /**
   * 判断点是否在矩形边界框内（工具方法）
   */
  protected isPointInBoundingBox(
    point: Point,
    start: Point,
    end: Point,
    tolerance = 0
  ): boolean {
    const bbox = this.getBoundingBoxFromPoints(start, end, tolerance);
    return (
      point.x >= bbox.minX &&
      point.x <= bbox.maxX &&
      point.y >= bbox.minY &&
      point.y <= bbox.maxY
    );
  }

  /**
   * 从两个点获取边界框（工具方法）
   */
  protected getBoundingBoxFromPoints(
    start: Point,
    end: Point,
    padding = 0
  ): { minX: number; maxX: number; minY: number; maxY: number } {
    return {
      minX: Math.min(start.x, end.x) - padding,
      maxX: Math.max(start.x, end.x) + padding,
      minY: Math.min(start.y, end.y) - padding,
      maxY: Math.max(start.y, end.y) + padding,
    };
  }

  /**
   * 获取图形的边界框（抽象方法，子类必须实现）
   */
  abstract getBoundingBox(
    op: T,
    padding?: number
  ): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
}

