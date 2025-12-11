// 为了复用，实际类型定义放在 pkgs/whiteboard-core 中，这里做一层 re-export
export type {
  Tool,
  Point,
  LineStyle,
  StrokeOp,
  RectOp,
  CircleOp,
  TriangleOp,
  DiamondOp,
  ArrowOp,
  TextOp,
  DrawOp,
} from '../../pkgs/whiteboard-core/src/types';
