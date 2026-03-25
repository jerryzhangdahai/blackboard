import type { DrawOp, Tool } from './types';
import type { ShapeHandler } from './shapeHandler';

/**
 * 图形处理器注册表
 * 统一管理所有图形类型的处理器
 */
class ShapeRegistry {
  private handlers = new Map<string, ShapeHandler>();

  /**
   * 注册图形处理器
   */
  register(handler: ShapeHandler): void {
    this.handlers.set(handler.kind, handler);
  }

  /**
   * 根据 kind 获取处理器
   */
  getHandler(kind: DrawOp['kind']): ShapeHandler | undefined {
    return this.handlers.get(kind);
  }

  /**
   * 根据 tool 获取处理器
   */
  getHandlerByTool(tool: Tool): ShapeHandler | undefined {
    for (const handler of this.handlers.values()) {
      if (handler.tool === tool) {
        return handler;
      }
    }
    return undefined;
  }

  /**
   * 获取所有绘图工具（排除 select 和 eraser）
   */
  getDrawingTools(): ShapeHandler[] {
    // 这里注册表里只会注册“可绘制的图形处理器”，select/eraser 属于交互工具，不属于 shape handler
    return Array.from(this.handlers.values());
  }

  /**
   * 获取所有已注册的处理器
   */
  getAllHandlers(): ShapeHandler[] {
    return Array.from(this.handlers.values());
  }
}

// 导出单例
export const shapeRegistry = new ShapeRegistry();

