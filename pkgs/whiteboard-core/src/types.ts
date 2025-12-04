export type Tool = 'pen' | 'rect' | 'circle' | 'triangle' | 'diamond' | 'arrow' | 'text' | 'select' | 'eraser';

export type Point = { x: number; y: number };

export type LineStyle = 'solid' | 'dashed';

export type StrokeOp = {
  kind: 'stroke';
  tool: 'pen';
  points: Point[];
  color: string;
  width: number;
  style: LineStyle;
};

export type RectOp = {
  kind: 'rect';
  tool: 'rect';
  start: Point;
  end: Point;
  color: string;
  width: number;
  style: LineStyle;
};

export type CircleOp = {
  kind: 'circle';
  tool: 'circle';
  center: Point;
  radius: number;
  color: string;
  width: number;
  style: LineStyle;
};

export type TriangleOp = {
  kind: 'triangle';
  tool: 'triangle';
  start: Point; // 与 rect 一样，表示对角点
  end: Point;
  color: string;
  width: number;
  style: LineStyle;
};

export type DiamondOp = {
  kind: 'diamond';
  tool: 'diamond';
  start: Point;
  end: Point;
  color: string;
  width: number;
  style: LineStyle;
};

export type ArrowOp = {
  kind: 'arrow';
  tool: 'arrow';
  start: Point;
  end: Point;
  color: string;
  width: number;
  style: LineStyle;
};

export type TextOp = {
  kind: 'text';
  tool: 'text';
  position: Point;
  text: string;
  color: string;
  width: number; // 用作字体大小
};

export type DrawOp =
  | StrokeOp
  | RectOp
  | CircleOp
  | TriangleOp
  | DiamondOp
  | ArrowOp
  | TextOp;



