import type { DrawOp } from './types';
import { shapeRegistry } from './shapeRegistry';

/**
 * 图形的边界框
 */
export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * 合并多个边界框
 */
export function mergeBoundingBoxes(boxes: BoundingBox[]): BoundingBox | null {
  if (boxes.length === 0) return null;
  
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  
  for (const box of boxes) {
    minX = Math.min(minX, box.minX);
    maxX = Math.max(maxX, box.maxX);
    minY = Math.min(minY, box.minY);
    maxY = Math.max(maxY, box.maxY);
  }
  
  return { minX, maxX, minY, maxY };
}

/**
 * 增量绘制：只绘制新增或修改的图形
 * 
 * @param ctx Canvas 上下文
 * @param oldOps 之前的操作列表
 * @param newOps 新的操作列表
 * @param selectedIndex 当前选中的索引
 * @param offscreenCanvas 可选的离屏 Canvas（用于缓存）
 */
export function drawIncremental(
  ctx: CanvasRenderingContext2D,
  oldOps: DrawOp[],
  newOps: DrawOp[],
  selectedIndex: number | null,
  offscreenCanvas?: HTMLCanvasElement
): void {
  // 如果操作数量变化很大，使用全量绘制（性能更好）
  const diff = Math.abs(newOps.length - oldOps.length);
  if (diff > newOps.length * 0.5 || oldOps.length === 0) {
    if (import.meta.env.DEV) {
      console.log('[增量绘制] 变化太大，使用全量绘制', { oldLen: oldOps.length, newLen: newOps.length, diff });
    }
    drawFull(ctx, newOps, selectedIndex);
    return;
  }
  
  if (import.meta.env.DEV) {
    console.log('[增量绘制] 开始增量绘制', { oldLen: oldOps.length, newLen: newOps.length });
  }

  // 找出新增、修改、删除的图形
  const { added, modified, removed } = diffOperations(oldOps, newOps);
  
  if (import.meta.env.DEV) {
    console.log('[增量绘制] 差异分析', { 
      added: added.length, 
      modified: modified.length, 
      removed: removed.length,
      addedIndices: added,
      modifiedIndices: modified,
      removedIndices: removed
    });
  }
  
  // 如果没有变化，直接返回
  if (added.length === 0 && modified.length === 0 && removed.length === 0) {
    if (import.meta.env.DEV) {
      console.log('[增量绘制] 没有变化，跳过绘制');
    }
    return;
  }
  
  // 需要清除的区域（被删除或修改的图形）
  const clearBoxes: BoundingBox[] = [];
  
  // 收集需要清除的区域（只收集被删除或修改的图形）
  for (const index of [...removed, ...modified]) {
    if (index < oldOps.length) {
      const op = oldOps[index];
      const handler = shapeRegistry.getHandler(op.kind);
      if (handler) {
        const bbox = handler.getBoundingBox(op as any, 2); // padding 2px 确保清除干净
        clearBoxes.push(bbox);
      }
    }
  }
  
  // 清除被删除或修改的图形区域
  if (clearBoxes.length > 0) {
    const mergedBox = mergeBoundingBoxes(clearBoxes);
    if (mergedBox) {
      // 如果有离屏 Canvas，从缓存中恢复
      if (offscreenCanvas) {
        restoreFromCache(ctx, offscreenCanvas, mergedBox);
      } else {
        // 否则清除区域并重绘重叠的图形
        clearRegion(ctx, mergedBox);
        // 排除新增和修改的图形，它们会在后面单独绘制
        const excludeIndices = new Set([...added, ...modified]);
        redrawOverlapping(ctx, newOps, mergedBox, selectedIndex, excludeIndices);
      }
    }
  } else if (added.length > 0) {
    // 如果只有新增图形，不需要清除区域，直接绘制即可
    if (import.meta.env.DEV) {
      console.log('[增量绘制] 只有新增图形，无需清除区域');
    }
  }
  
  // 绘制新增和修改的图形
  const drawCount = added.length + modified.length;
  if (import.meta.env.DEV && drawCount > 0) {
    console.log(`[增量绘制] 绘制 ${drawCount} 个图形（新增: ${added.length}, 修改: ${modified.length}）`);
  }
  
  if (drawCount === 0) {
    if (import.meta.env.DEV) {
      console.warn('[增量绘制] 没有需要绘制的图形，但进入了增量绘制逻辑');
    }
    return;
  }
  
  for (const index of [...added, ...modified]) {
    if (index < newOps.length) {
      const op = newOps[index];
      const handler = shapeRegistry.getHandler(op.kind);
      if (!handler) {
        if (import.meta.env.DEV) {
          console.warn(`[增量绘制] 找不到处理器: ${op.kind}`);
        }
        continue;
      }
      
      const isSelected = selectedIndex === index;
      
      if (import.meta.env.DEV) {
        console.log(`[增量绘制] 绘制图形 ${index}: ${op.kind}`, op);
      }
      
      // 设置样式
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width;
      if ('style' in op && op.style === 'dashed') {
        ctx.setLineDash([8, 4]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      if (isSelected) {
        ctx.shadowColor = 'rgba(59,130,246,0.9)';
        ctx.shadowBlur = 12;
      }
      
      // 绘制
      handler.draw(ctx, op as any, isSelected);
      
      if (isSelected) {
        ctx.shadowBlur = 0;
      }
    } else {
      if (import.meta.env.DEV) {
        console.warn(`[增量绘制] 索引 ${index} 超出范围，newOps.length = ${newOps.length}`);
      }
    }
  }
  
  if (import.meta.env.DEV) {
    console.log('[增量绘制] 绘制完成');
  }
  
  // 更新离屏 Canvas 缓存
  if (offscreenCanvas) {
    updateCache(offscreenCanvas, ctx, newOps, selectedIndex);
  }
}

/**
 * 全量绘制（回退方案）
 */
function drawFull(
  ctx: CanvasRenderingContext2D,
  ops: DrawOp[],
  selectedIndex: number | null
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  
  ops.forEach((op, index) => {
    const handler = shapeRegistry.getHandler(op.kind);
    if (!handler) return;
    
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.width;
    if ('style' in op && op.style === 'dashed') {
      ctx.setLineDash([8, 4]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    const isSelected = selectedIndex === index;
    if (isSelected) {
      ctx.shadowColor = 'rgba(59,130,246,0.9)';
      ctx.shadowBlur = 12;
    }
    
    handler.draw(ctx, op as any, isSelected);
    
    if (isSelected) {
      ctx.shadowBlur = 0;
    }
  });
}

/**
 * 比较两个操作列表，找出新增、修改、删除的索引
 */
function diffOperations(
  oldOps: DrawOp[],
  newOps: DrawOp[]
): {
  added: number[];
  modified: number[];
  removed: number[];
} {
  const added: number[] = [];
  const modified: number[] = [];
  const removed: number[] = [];
  
  // 找出新增的（在 newOps 中但不在 oldOps 中）
  for (let i = oldOps.length; i < newOps.length; i++) {
    added.push(i);
  }
  
  // 找出修改的（索引相同但内容不同）
  const minLen = Math.min(oldOps.length, newOps.length);
  for (let i = 0; i < minLen; i++) {
    if (!isOperationEqual(oldOps[i], newOps[i])) {
      modified.push(i);
    }
  }
  
  // 找出删除的（在 oldOps 中但不在 newOps 中）
  if (oldOps.length > newOps.length) {
    for (let i = newOps.length; i < oldOps.length; i++) {
      removed.push(i);
    }
  }
  
  return { added, modified, removed };
}

/**
 * 判断两个操作是否相等（简单比较，可以根据需要优化）
 */
function isOperationEqual(op1: DrawOp, op2: DrawOp): boolean {
  return JSON.stringify(op1) === JSON.stringify(op2);
}

/**
 * 清除指定区域
 */
function clearRegion(ctx: CanvasRenderingContext2D, bbox: BoundingBox): void {
  const padding = 2; // 额外 padding 确保清除干净
  ctx.clearRect(
    bbox.minX - padding,
    bbox.minY - padding,
    bbox.maxX - bbox.minX + padding * 2,
    bbox.maxY - bbox.minY + padding * 2
  );
}

/**
 * 重绘与指定区域重叠的图形
 * 排除新增和修改的图形（它们会在后面单独绘制）
 */
function redrawOverlapping(
  ctx: CanvasRenderingContext2D,
  ops: DrawOp[],
  region: BoundingBox,
  selectedIndex: number | null,
  excludeIndices: Set<number> = new Set()
): void {
  ops.forEach((op, index) => {
    // 跳过新增和修改的图形（它们会在后面单独绘制）
    if (excludeIndices.has(index)) {
      return;
    }
    
    const handler = shapeRegistry.getHandler(op.kind);
    if (!handler) return;
    
    const opBbox = handler.getBoundingBox(op as any);
    
    // 检查是否与区域重叠
    if (!isBoundingBoxOverlap(opBbox, region)) {
      return;
    }
    
    // 绘制重叠的图形
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.width;
    if ('style' in op && op.style === 'dashed') {
      ctx.setLineDash([8, 4]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    const isSelected = selectedIndex === index;
    if (isSelected) {
      ctx.shadowColor = 'rgba(59,130,246,0.9)';
      ctx.shadowBlur = 12;
    }
    
    handler.draw(ctx, op as any, isSelected);
    
    if (isSelected) {
      ctx.shadowBlur = 0;
    }
  });
}

/**
 * 判断两个边界框是否重叠
 */
function isBoundingBoxOverlap(bbox1: BoundingBox, bbox2: BoundingBox): boolean {
  return !(
    bbox1.maxX < bbox2.minX ||
    bbox1.minX > bbox2.maxX ||
    bbox1.maxY < bbox2.minY ||
    bbox1.minY > bbox2.maxY
  );
}

/**
 * 从离屏 Canvas 恢复区域（如果使用缓存）
 */
function restoreFromCache(
  ctx: CanvasRenderingContext2D,
  cacheCanvas: HTMLCanvasElement,
  bbox: BoundingBox
): void {
  const padding = 2;
  ctx.drawImage(
    cacheCanvas,
    bbox.minX - padding,
    bbox.minY - padding,
    bbox.maxX - bbox.minX + padding * 2,
    bbox.maxY - bbox.minY + padding * 2,
    bbox.minX - padding,
    bbox.minY - padding,
    bbox.maxX - bbox.minX + padding * 2,
    bbox.maxY - bbox.minY + padding * 2
  );
}

/**
 * 更新离屏 Canvas 缓存
 */
function updateCache(
  cacheCanvas: HTMLCanvasElement,
  sourceCtx: CanvasRenderingContext2D,
  ops: DrawOp[],
  selectedIndex: number | null
): void {
  const cacheCtx = cacheCanvas.getContext('2d');
  if (!cacheCtx) return;
  
  // 同步尺寸
  cacheCanvas.width = sourceCtx.canvas.width;
  cacheCanvas.height = sourceCtx.canvas.height;
  
  // 全量绘制到缓存
  cacheCtx.clearRect(0, 0, cacheCanvas.width, cacheCanvas.height);
  ops.forEach((op, index) => {
    const handler = shapeRegistry.getHandler(op.kind);
    if (!handler) return;
    
    cacheCtx.strokeStyle = op.color;
    cacheCtx.lineWidth = op.width;
    if ('style' in op && op.style === 'dashed') {
      cacheCtx.setLineDash([8, 4]);
    } else {
      cacheCtx.setLineDash([]);
    }
    cacheCtx.lineCap = 'round';
    cacheCtx.lineJoin = 'round';
    
    const isSelected = selectedIndex === index;
    if (isSelected) {
      cacheCtx.shadowColor = 'rgba(59,130,246,0.9)';
      cacheCtx.shadowBlur = 12;
    }
    
    handler.draw(cacheCtx, op as any, isSelected);
    
    if (isSelected) {
      cacheCtx.shadowBlur = 0;
    }
  });
}

