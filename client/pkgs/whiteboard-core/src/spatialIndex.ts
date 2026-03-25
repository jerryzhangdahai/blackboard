import type { DrawOp, Point } from './types';
import type { BoundingBox } from './incrementalDraw';
import { shapeRegistry } from './shapeRegistry';

/**
 * 空间索引 - 使用网格索引加速命中测试
 * 
 * 网格索引将画布划分为网格，每个网格存储包含在该区域的图形索引。
 * 当进行命中测试时，只需要检查点击位置所在网格中的图形，而不是所有图形。
 * 
 * 性能优化：
 * - 时间复杂度：从 O(n) 降到 O(k)，其中 k 是单个网格中的图形数量（通常 k << n）
 * - 对于 10 万个元素，如果平均每个网格包含 10 个元素，性能提升约 10000 倍
 */
export class SpatialIndex {
  private grid: Map<string, Set<number>> = new Map();
  private cellSize: number;
  public bounds: BoundingBox; // 改为 public，允许外部访问
  private ops: DrawOp[] = [];
  private boundingBoxCache: Map<number, BoundingBox> = new Map();

  /**
   * @param cellSize 网格大小（像素）。较小的值提供更精确的索引，但需要更多内存。
   *                 推荐值：50-200 像素，取决于画布大小和元素密度
   * @param bounds 画布边界，用于确定网格范围
   */
  constructor(cellSize = 100, bounds: BoundingBox = { minX: 0, maxX: 8000, minY: 0, maxY: 6000 }) {
    this.cellSize = cellSize;
    this.bounds = bounds;
  }

  /**
   * 将坐标转换为网格键
   */
  private getCellKey(x: number, y: number): string {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    return `${cellX},${cellY}`;
  }

  /**
   * 获取边界框覆盖的所有网格键
   */
  private getCellKeysForBox(box: BoundingBox): string[] {
    const minCellX = Math.floor(Math.max(box.minX, this.bounds.minX) / this.cellSize);
    const maxCellX = Math.floor(Math.min(box.maxX, this.bounds.maxX) / this.cellSize);
    const minCellY = Math.floor(Math.max(box.minY, this.bounds.minY) / this.cellSize);
    const maxCellY = Math.floor(Math.min(box.maxY, this.bounds.maxY) / this.cellSize);

    const keys: string[] = [];
    for (let x = minCellX; x <= maxCellX; x++) {
      for (let y = minCellY; y <= maxCellY; y++) {
        keys.push(`${x},${y}`);
      }
    }
    return keys;
  }

  /**
   * 获取或计算边界框（带缓存）
   */
  private getBoundingBox(opIndex: number, op: DrawOp, tolerance: number): BoundingBox {
    // 检查缓存
    const cacheKey = opIndex;
    if (this.boundingBoxCache.has(cacheKey)) {
      return this.boundingBoxCache.get(cacheKey)!;
    }

    // 计算边界框
    const handler = shapeRegistry.getHandler(op.kind);
    if (!handler) {
      const emptyBox: BoundingBox = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
      this.boundingBoxCache.set(cacheKey, emptyBox);
      return emptyBox;
    }

    const box = handler.getBoundingBox(op as any, tolerance);
    this.boundingBoxCache.set(cacheKey, box);
    return box;
  }

  /**
   * 重建索引
   * 当图形列表发生变化时调用
   */
  rebuild(ops: DrawOp[], tolerance = 6): void {
    this.ops = ops;
    this.grid.clear();
    this.boundingBoxCache.clear();

    // 为每个图形建立索引
    ops.forEach((op, index) => {
      const box = this.getBoundingBox(index, op, tolerance);
      const cellKeys = this.getCellKeysForBox(box);

      // 将图形索引添加到所有覆盖的网格中
      cellKeys.forEach(key => {
        if (!this.grid.has(key)) {
          this.grid.set(key, new Set());
        }
        this.grid.get(key)!.add(index);
      });
    });
  }

  /**
   * 更新单个图形的索引
   * 当图形被修改时调用（比重建整个索引更高效）
   */
  update(opIndex: number, op: DrawOp, tolerance = 6): void {
    if (opIndex < 0 || opIndex >= this.ops.length) return;

    // 清除旧索引
    this.remove(opIndex);

    // 更新 ops 数组
    this.ops[opIndex] = op;

    // 清除缓存
    this.boundingBoxCache.delete(opIndex);

    // 添加新索引
    const box = this.getBoundingBox(opIndex, op, tolerance);
    const cellKeys = this.getCellKeysForBox(box);

    cellKeys.forEach(key => {
      if (!this.grid.has(key)) {
        this.grid.set(key, new Set());
      }
      this.grid.get(key)!.add(opIndex);
    });
  }

  /**
   * 从索引中移除图形
   */
  remove(opIndex: number): void {
    // 从所有网格中移除
    this.grid.forEach((indices, key) => {
      indices.delete(opIndex);
      // 如果网格为空，删除它
      if (indices.size === 0) {
        this.grid.delete(key);
      }
    });

    // 清除缓存
    this.boundingBoxCache.delete(opIndex);
    this.boundingBoxCache.delete(this.ops.length - 1); // 清除最后一个（如果有）
  }

  /**
   * 在索引末尾添加新图形
   * 当图形被添加时调用（比重建整个索引更高效）
   */
  add(op: DrawOp, tolerance = 6): void {
    const opIndex = this.ops.length;
    this.ops.push(op);

    const box = this.getBoundingBox(opIndex, op, tolerance);
    const cellKeys = this.getCellKeysForBox(box);

    cellKeys.forEach(key => {
      if (!this.grid.has(key)) {
        this.grid.set(key, new Set());
      }
      this.grid.get(key)!.add(opIndex);
    });
  }

  /**
   * 获取可能包含指定点的图形索引列表（按 z-order 从后往前）
   * 这是命中测试的第一步：边界框预筛选
   */
  getCandidates(point: Point, tolerance = 6): number[] {
    // 获取点所在网格
    const cellKey = this.getCellKey(point.x, point.y);
    const candidates = this.grid.get(cellKey);

    if (!candidates || candidates.size === 0) {
      return [];
    }

    // 转换为数组并排序（从后往前，z-order）
    const indices = Array.from(candidates).sort((a, b) => b - a);

    // 进一步筛选：检查边界框是否真的包含点（更精确的预筛选）
    const filtered: number[] = [];
    for (const index of indices) {
      const op = this.ops[index];
      if (!op) continue;

      const box = this.getBoundingBox(index, op, tolerance);
      
      // 快速边界框检查
      if (
        point.x >= box.minX &&
        point.x <= box.maxX &&
        point.y >= box.minY &&
        point.y <= box.maxY
      ) {
        filtered.push(index);
      }
    }

    return filtered;
  }

  /**
   * 清空索引
   */
  clear(): void {
    this.grid.clear();
    this.ops = [];
    this.boundingBoxCache.clear();
  }

  /**
   * 获取当前索引的操作数量
   */
  getOpsCount(): number {
    return this.ops.length;
  }

  /**
   * 获取索引统计信息（用于调试和性能分析）
   */
  getStats(): {
    totalOps: number;
    totalCells: number;
    avgOpsPerCell: number;
    maxOpsPerCell: number;
    cacheSize: number;
  } {
    let totalOpsInCells = 0;
    let maxOpsPerCell = 0;

    this.grid.forEach(indices => {
      totalOpsInCells += indices.size;
      maxOpsPerCell = Math.max(maxOpsPerCell, indices.size);
    });

    return {
      totalOps: this.ops.length,
      totalCells: this.grid.size,
      avgOpsPerCell: this.grid.size > 0 ? totalOpsInCells / this.grid.size : 0,
      maxOpsPerCell,
      cacheSize: this.boundingBoxCache.size,
    };
  }
}

