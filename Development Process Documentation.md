## 开发版代码开发说明

本项目的开发版本主要由三部分组成：**前端源码 `client/`、后端源码 `server/`、部署版 `released_version/`**。下面只针对开发时最常看到的部分进行说明。

---

### 一、根目录

- `package.json`（手工整理）  
  - 基于最初的 Node 项目初始化（`npm init -y`）生成，然后手动修改了：项目名称、入口 `server/index.js`、`scripts.dev` 等。
  - 依赖（如 `express`、`ws`、`cors`）是通过 `npm install xxx` 自动写入 `dependencies` 的，不是直接手写版本号。

- `package-lock.json`（自动生成）  
  - 完全由 `npm install` 生成，用来锁定依赖版本，**没有手写修改**。

- `README.md`（手写 + 后续多次补充）  
  - 整体项目说明、目录结构、运行方式、前后端代码说明等都是我写的，并随开发版功能迭代过几次。

---

### 二、后端 `server/`

- `server/index.js`（手写）  
  - 使用 Node.js + `express` + `ws` 搭建：
    - HTTP 路由（`/health`、`/api/boards`）。
    - WebSocket 服务：维护 `boards` Map、处理 `init/op/reset` 消息、广播房间内所有客户端。
  - 没有用任何代码生成器或脚手架，逻辑是围绕白板协同需求从零写的。

---

### 三、前端 `client/` 结构 + 可复用包 `pkgs/`

#### 1. 模板/脚手架生成为主的文件

这些文件是通过 Vite 官方脚手架命令创建时带出来的，只做了很少或没有修改：

- `client/index.html`（脚手架模板，轻微调整了 `<title>`）  
- `client/README.md`（完全是 Vite 自带的英文说明，没有改业务内容）  
- `client/tsconfig.json`、`client/tsconfig.app.json`、`client/tsconfig.node.json`（在 Vite + React + TS 模板基础上微调，属于配置层面）  
- `client/vite.config.ts`（基于 `npm create vite@latest` 生成，只保留/略调了 React 插件配置）  
- `client/eslint.config.js`（由脚手架模板生成，根据需要略调规则）  
- `client/public/vite.svg`、`client/src/assets/react.svg`（脚手架自带图标）  

#### 2. 手写/大幅修改的前端业务代码

以下文件是为实现协同白板功能**专门手写或在模板基础上重写**的部分：

- `client/src/main.tsx`  
  - 入口非常简洁：创建 React Root，渲染 `<App />`，移除了 StrictMode 以避免开发时 WebSocket 重连问题。

- `client/src/App.tsx`  
  - 简单包装：只渲染 `WhiteboardPage`，方便未来接路由或多页。

- `client/src/WhiteboardPage.tsx`（手写）  
  - 负责：
    - 从 URL 读取/生成 `boardId`；
    - 更新地址栏（保证分享链接稳定）；
    - 显示顶部标题、分享链接输入框；
    - 渲染白板主体。

- `client/src/components/Whiteboard.tsx`（手写，改动最多）  
  - 核心 Canvas + WebSocket 协作逻辑全部手写，包括：
    - 工具栏：笔、矩形、圆形、三角形、菱形、箭头、文字、选择、橡皮擦；
    - 颜色、线宽、线型（实线/虚线）切换；
    - 选中高亮、拖拽移动、删除；
    - 橡皮擦整条删除、沿路删除多个元素；
    - Undo/Redo（对“新增操作”的撤销/重做）；
    - 全局快捷键（`Ctrl+1~7` 切换工具，`Ctrl+Z` 撤销，`Ctrl+Y/Ctrl+Shift+Z` 重做）；
    - WebSocket 连接管理 + `init/op/reset` 消息处理；
    - 根据开发/部署环境切换 `WS_URL`（开发用 `localhost:4000`，部署用 `location.host`）。

- `client/src/whiteboard/types.ts`（薄层 re-export）  
  - 不再直接定义类型，而是：`export * from '../../pkgs/whiteboard-core/src/types';`
  - 实际实现位于 `pkgs/whiteboard-core/src/types.ts`（见下文）。

- `client/src/whiteboard/drawUtils.ts`（薄层 re-export）  
  - 仅做转发：`export * from '../../pkgs/whiteboard-core/src/drawUtils';`
  - 实际绘制/几何逻辑放在 `pkgs/whiteboard-core/src/drawUtils.ts` 里，方便未来复用。

- `client/src/index.css`、`client/src/App.css`（样式为主，基本手写）  
  - 整体页面布局、主题颜色、阴影、工具栏按钮样式、画布背景（棋盘格）、响应式布局等。

#### 3. 可复用包 `pkgs/whiteboard-core`

- `pkgs/whiteboard-core/src/types.ts`（手写）  
  - 定义所有前端白板图形/工具相关的 TypeScript 类型，如 `Point`、`Tool`、`LineStyle`、`StrokeOp`、`RectOp`、`CircleOp`、`TriangleOp`、`DiamondOp`、`ArrowOp`、`TextOp`、`DrawOp` 等。

- `pkgs/whiteboard-core/src/drawUtils.ts`（手写）  
  - Canvas 绘制/几何工具：
    - `drawOperations`：根据 `DrawOp[]` 重绘所有图形（线条、矩形、圆、三角形、菱形、箭头、文字），支持选中高亮和虚线样式。
    - `translateOp`：对各种图形进行平移（拖拽用）。
    - `hitTest`：命中测试，支持线段距离计算（用于选择和橡皮擦）、矩形/菱形/三角形包围盒检测、圆形半径检测、箭头线段检测、文本区域检测等。

#### 4. 打包产物

- `client/dist/**`（自动生成）  
  - 运行 `cd client && npm run build` 后由 Vite + Rollup 自动生成：
    - `dist/index.html`：优化后的入口 HTML；
    - `dist/assets/index-*.js`：打包、压缩后的业务 JS（例如 `index-diU961qG.js`）；
    - `dist/assets/index-*.css`：打包后的样式。
  - 这些文件不会手动修改，若要改前端逻辑一律回到 `client/src` 下改源码后重新打包。

---

### 四、部署版 `released_version/`

- `released_version/server.js`（手写部署专用版）  
  - 使用 Express 提供静态文件服务（`dist/`），并用 `ws` 提供 WebSocket 协作功能，结构和 `server/index.js` 类似，但更偏“单机部署版”。

- `released_version/package.json`（手写 + `npm install` 自动补充依赖）  
  - 只保留最小运行依赖：`express`、`ws`；
  - `"scripts.start": "node server.js"`，用于一键启动部署版。

- `released_version/dist/**`（从 `client/dist` 复制而来）  
  - 完全由 `npm run build` 生成后复制过去，没有手改。

- `released_version/README.md`（手写）  
  - 面向“使用者”（而不是开发者），只讲：`npm install` → `npm start` → 打开 `http://localhost:4000/` 即可协同。

---

### 五、调试文档

- `debugfornotshare.md`（手写）  
  - 记录了之前遇到的“协同不生效”的排查过程，尤其是 React 18 `StrictMode` 导致 `useEffect` 执行两次、WebSocket 被过早关闭的问题，以及最终的解决方案。

---

### 六、各 README/说明文档的作用一览

- `README.md`（根目录）  
  - 面向“整体项目使用者 + 开发者”的总说明：项目介绍、目录结构、运行方式、前后端代码说明，以及 `client` 与 `pkgs/whiteboard-core` 之间的复用关系。

- `DEV_CODE_ORIGIN.md`  
  - 面向“想搞清楚代码来源和结构的人”：说明哪些文件是手写的、哪些来自模板或自动生成、哪些逻辑已抽到 `pkgs` 复用。

- `debugfornotshare.md`  
  - 面向“调试/回顾问题”的场景：记录协同问题的排查过程，便于以后出现类似问题时快速对照。

- `pkgs/README.md`  
  - 面向“希望把白板核心能力当库来用”的人：说明 `pkgs` 目录用途，当前已经有哪些包（`whiteboard-core`），以及里面暴露了什么能力。

- `released_version/README.md`  
  - 面向“只想本地跑部署版的人”：告诉用户下载 `released_version` 后，只需 `npm install && npm start`，然后访问 `http://localhost:4000/` 即可。

