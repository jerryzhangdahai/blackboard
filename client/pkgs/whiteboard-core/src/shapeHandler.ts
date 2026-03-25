import type { DrawOp, Point, LineStyle } from './types';

/**
 * 图形处理器接口
 * 每种图形类型需要实现这个接口，负责自己的绘制、命中测试、平移等逻辑
 */
export interface ShapeHandler<T extends DrawOp = DrawOp> {
  /** 图形类型标识（对应 DrawOp.kind） */
  readonly kind: T['kind'];
  
  /** 工具名称（对应 Tool 类型） */
  readonly tool: T['tool'];
  
  /** UI 显示名称 */
  readonly label: string;
  
  /** 是否支持拖拽（stroke 不支持） */
  readonly draggable: boolean;
  
  /** 绘制图形 */
  draw(ctx: CanvasRenderingContext2D, op: T, selected: boolean): void;
  
  /** 命中测试：判断点是否在图形内 */
  hitTest(op: T, point: Point, tolerance?: number): boolean;
  
  /** 平移图形 */
  translate(op: T, dx: number, dy: number): T;
  
  /** 创建图形操作（用于绘制时生成临时预览） */
  create(start: Point, end: Point, props: {
    color: string;
    width: number;
    style: LineStyle;
  }): T | null;
  
  /** 创建图形操作（用于特殊交互，如文本点击） */
  createFromPoint?(point: Point, props: {
    color: string;
    width: number;
    style?: LineStyle;
  }): T | null;
  
  /** 获取图形显示名称（用于选中时显示） */
  getDisplayName(op: T): string;
  
  /** 获取图形的边界框（用于增量绘制和区域清除） */
  getBoundingBox(op: T, padding?: number): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
}

