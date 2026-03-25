import { shapeRegistry } from '../shapeRegistry';
import { StrokeHandler } from './StrokeHandler';
import { RectHandler } from './RectHandler';
import { CircleHandler } from './CircleHandler';
import { TriangleHandler } from './TriangleHandler';
import { DiamondHandler } from './DiamondHandler';
import { ArrowHandler } from './ArrowHandler';
import { TextHandler } from './TextHandler';

// 注册所有图形处理器
shapeRegistry.register(new StrokeHandler());
shapeRegistry.register(new RectHandler());
shapeRegistry.register(new CircleHandler());
shapeRegistry.register(new TriangleHandler());
shapeRegistry.register(new DiamondHandler());
shapeRegistry.register(new ArrowHandler());
shapeRegistry.register(new TextHandler());

// 导出所有处理器类（方便外部扩展）
export {
  StrokeHandler,
  RectHandler,
  CircleHandler,
  TriangleHandler,
  DiamondHandler,
  ArrowHandler,
  TextHandler,
};

