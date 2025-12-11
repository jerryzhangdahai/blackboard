## pkgs 目录说明

这个目录位于 `client/` 目录下，用于存放可以在多个项目之间复用的**组件 / 包**。

目前已包含：

- `whiteboard-core/`
  - `src/types.ts`：白板通用类型定义（`Point`、`Tool`、`LineStyle`、`DrawOp` 等）。
  - `src/drawUtils.ts`：白板核心绘制 & 命中测试 & 平移逻辑。
  - 被 `client/src/whiteboard/types.ts` 和 `client/src/whiteboard/drawUtils.ts` 通过显式导出方式复用：
    - `export type { ... } from '../../pkgs/whiteboard-core/src/types';`
    - `export { drawOperations, translateOp, hitTest } from '../../pkgs/whiteboard-core/src/drawUtils';`

> **注意**：`pkgs` 目录放在 `client/` 下是为了让 Vite 能够正确解析模块路径。如果放在项目根目录，Vite 默认只在 `client/` 目录内查找模块，会导致导入失败。

后续如果需要，可以在这里继续抽离：

- 不依赖具体 UI 的 React 白板组件；
- 通用的协作协议层封装等。

