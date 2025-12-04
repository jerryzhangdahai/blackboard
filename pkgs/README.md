## pkgs 目录说明

这个目录用于存放可以在多个项目之间复用的**组件 / 包**。

目前已包含：

- `whiteboard-core/`
  - `src/types.ts`：白板通用类型定义（`Point`、`Tool`、`DrawOp` 等）。
  - `src/drawUtils.ts`：白板核心绘制 & 命中测试 & 平移逻辑。
  - 被 `client/src/whiteboard/types.ts` 和 `client/src/whiteboard/drawUtils.ts` 通过 `export * from ...` 方式复用。

后续如果需要，可以在这里继续抽离：

- 不依赖具体 UI 的 React 白板组件；
- 通用的协作协议层封装等。

