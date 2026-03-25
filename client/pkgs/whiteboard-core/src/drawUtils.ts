// 导入 shapes 确保所有处理器被注册
import './shapes';

import type { DrawOp, Point } from './types';
import { shapeRegistry } from './shapeRegistry';
import { SpatialIndex } from './spatialIndex';

/**
 * 绘制所有操作
 * 使用注册表查找对应的处理器来绘制
 */
export function drawOperations(
  ctx: CanvasRenderingContext2D,
  ops: DrawOp[],
  selectedIndex: number | null,
) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  ops.forEach((op, index) => {
    const handler = shapeRegistry.getHandler(op.kind);
    if (!handler) {
      console.warn(`No handler found for kind: ${op.kind}`);
      return;
    }

    // 设置通用样式
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.width;
    if ('style' in op && op.style === 'dashed') {
      ctx.setLineDash([8, 4]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    const isSelected = selectedIndex != null && index === selectedIndex;
    if (isSelected) {
      ctx.shadowColor = 'rgba(59,130,246,0.9)';
      ctx.shadowBlur = 12;
    }

    // 使用处理器绘制
    handler.draw(ctx, op as any, isSelected);

    if (isSelected) {
      ctx.shadowBlur = 0;
    }
  });
}

/**
 * 平移操作
 * 使用注册表查找对应的处理器来平移
 */
export function translateOp(op: DrawOp, dx: number, dy: number): DrawOp {
  const handler = shapeRegistry.getHandler(op.kind);
  if (!handler) {
    console.warn(`No handler found for kind: ${op.kind}`);
    return op;
  }
  return handler.translate(op as any, dx, dy) as DrawOp;
}

/**
 * 命中测试 - 基础版本（不使用空间索引）
 * 适用于元素数量较少（< 1000）的场景
 */
export function hitTestBasic(ops: DrawOp[], p: Point, tolerance = 6): number | null {
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    const handler = shapeRegistry.getHandler(op.kind);
    if (!handler) {
      continue;
    }
    if (handler.hitTest(op as any, p, tolerance)) {
      return i;
    }
  }
  return null;
}

/**
 * 命中测试 - 优化版本（使用空间索引和边界框预筛选）
 * 
 * 优化策略：
 * 1. 使用空间索引快速找到候选图形（边界框包含点的图形）
 * 2. 对候选图形进行精确的命中测试
 * 3. 从后往前遍历（z-order），确保选中最上层的图形
 * 
 * 性能：
 * - 小规模（< 1000 元素）：自动回退到基础版本
 * - 大规模（> 1000 元素）：使用空间索引，性能提升 10-1000 倍
 */
export function hitTest(
  ops: DrawOp[],
  p: Point,
  tolerance = 6,
  spatialIndex?: SpatialIndex | null
): number | null {
  // 小规模数据：使用基础版本（空间索引有初始化开销）
  if (ops.length < 1000) {
    return hitTestBasic(ops, p, tolerance);
  }

  // 大规模数据：使用空间索引
  if (spatialIndex) {
    // 获取候选图形（边界框预筛选）
    const candidates = spatialIndex.getCandidates(p, tolerance);

    // 对候选图形进行精确的命中测试（从后往前，z-order）
    for (const index of candidates) {
      const op = ops[index];
      if (!op) continue;

      const handler = shapeRegistry.getHandler(op.kind);
      if (!handler) {
        continue;
      }

      // 精确的命中测试
      if (handler.hitTest(op as any, p, tolerance)) {
        return index;
      }
    }

    return null;
  }

  // 如果没有提供空间索引，回退到基础版本
  return hitTestBasic(ops, p, tolerance);
}



