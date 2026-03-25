// 复用 pkgs/whiteboard-core 中的实现
export {
  drawOperations,
  translateOp,
  hitTest,
  hitTestBasic,
} from '../../pkgs/whiteboard-core/src/drawUtils';

// 导出空间索引类型
export { SpatialIndex } from '../../pkgs/whiteboard-core/src/spatialIndex';