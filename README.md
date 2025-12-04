## 写在项目说明之前


## 协同白板项目说明

一个基于 **React + Canvas + WebSocket + Node.js** 的在线团队协作白板，支持多人实时绘图、URL 分享、选择/拖拽、橡皮擦、基本图形和快捷键等功能。

> **关于 `client` 与 `pkgs` 的关系**  
> - `client/` 是**完整的前端应用**：包含页面结构（`App`、`WhiteboardPage`）、交互逻辑（`Whiteboard`）、样式、Vite/TS 配置等。  
> - `pkgs/whiteboard-core` 是从 `client` 中抽出来的**可复用底层库**：  
>   - `pkgs/whiteboard-core/src/types.ts`：集中定义白板的所有类型，包含 `Point`、`Tool`、`LineStyle`、以及各种 `DrawOp`（线条、矩形、圆形、三角形、菱形、箭头、文本等）。  
>   - `pkgs/whiteboard-core/src/drawUtils.ts`：封装 Canvas 层的核心算法，包括：按 `DrawOp[]` 重绘画布、图形平移、命中测试（点击/橡皮擦）。  
> - `client/src/whiteboard/types.ts` 和 `client/src/whiteboard/drawUtils.ts` 不再自己实现逻辑，而是通过  
>   `export * from '../../pkgs/whiteboard-core/src/...';` 的方式**直接复用** `whiteboard-core` 中的实现。  
> - 将来如果你在另一个项目中也想使用同一套白板数据结构和绘制逻辑，只需拷贝/引用 `pkgs/whiteboard-core`，`client` 可以视为这个仓库专属的“示例应用”。

### 项目结构总览

- **`package.json`**：后端（NodeJS）和根目录依赖配置，`npm run dev` 用于启动后端服务。
- **`server/`**：NodeJS 白板服务端代码。
- **`client/`**：React 前端白板应用（Vite + TypeScript）。
- **`node_modules/`**：根目录依赖（Express、ws 等），由 `npm install` 自动生成。

---

## 根目录

- **`package.json`**
  - `"name": "collab-whiteboard-server"`：项目名称。
  - `"main": "server/index.js"`：后端入口文件。
  - `"scripts.dev": "node server/index.js"`：运行后端开发环境的命令。
  - `"dependencies"`：后端依赖：
    - **`express`**：HTTP 服务框架，提供健康检查、REST 接口等。
    - **`ws`**：WebSocket 库，用来做实时通信。
    - **`cors`**：处理跨域，允许前端通过浏览器访问后端。

- **`server/`**
  - **`index.js`**：后端唯一入口，主要职责：
    - 创建 Express 应用和 HTTP 服务器。
    - 创建 WebSocket 服务器（`ws.Server`），监听 `ws://localhost:4000/ws`。
    - 维护内存中的白板房间数据结构：  
      `boards: Map<boardId, { ops: DrawOp[]; clients: Set<WebSocket> }>`。
    - HTTP 路由：
      - `GET /health`：健康检查。
      - `POST /api/boards`：按需创建新白板并返回 `boardId`（当前前端是本地生成 ID，这个接口可选）。
    - WebSocket 协议：
      - **连接参数**：`ws://localhost:4000/ws?boardId=xxx`，用 `boardId` 区分不同白板房间。
      - **消息类型**：
        - `init`：新客户端连接时发送，包含当前房间的所有绘图操作 `ops`，用于重放画面。
        - `op`：单条绘图操作（自由线条 / 矩形），服务端保存并广播给该房间所有连接。
        - `reset`：用于 Undo/Redo 后，把完整 `ops` 列表同步给所有客户端。

---

## 前端（`client/`）

前端由 **Vite + React + TypeScript** 组成，目录遵循 Vite 标准结构。

- **`client/package.json`**
  - `"scripts.dev": "vite"`：启动前端开发服务器（默认端口 `5173`）。
  - `"dependencies"`：React 相关依赖。
  - `"devDependencies"`：Vite、TypeScript、ESLint 等构建/开发工具。

- **`client/index.html`**
  - 前端单页应用入口 HTML。
  - 挂载点为 `<div id="root"></div>`，React 会将应用渲染到这个节点。

- **`client/vite.config.ts`**
  - Vite 项目配置，启用 React 插件（`@vitejs/plugin-react`），支持 JSX / HMR 等。

- **`client/src/main.tsx`**
  - 前端应用入口，使用 `ReactDOM.createRoot` 渲染 `<App />` 到 `#root`。
  - 引入全局样式 `index.css`。

- **`client/src/App.tsx`**
  - 顶层组件，当前非常简单：只渲染一个页面组件 `WhiteboardPage`。
  - 方便未来需要时在外层增加路由、布局等。

- **`client/src/index.css`**
  - 全局样式：
    - 统一字体（系统字体）。
    - 设置 `body`、`#root` 全屏铺满，用于白板占据整个窗口。
    - 设置 `box-sizing: border-box`，保证布局更直观。

- **`client/src/App.css`**
  - 白板页面的主要 UI 样式：
    - `.page`：整页布局（背景渐变、垂直布局）。
    - `.page-header`：顶部标题栏 + 分享链接区域。
    - `.page-main`：主内容区。
    - `.whiteboard-container`：白板外层容器（圆角 + 阴影）。
    - `.toolbar`、`.tool-button` 等：工具栏样式（笔/矩形/颜色/线宽/撤销重做）。
    - `.canvas-wrapper`、`.canvas`：画布区域样式（棋盘格背景 + 全屏画布）。

---

## 前端业务代码（开发版功能说明）

- **`client/src/WhiteboardPage.tsx`**
  - 职责：**白板页面容器**。
  - 功能：
    - 从 URL 中读取 `boardId` 查询参数，如果没有则生成一个随机 `boardId` 并更新 URL。
    - 计算当前页面的分享链接（直接使用 `window.location.href`）。
    - 渲染顶部标题栏（项目名称、副标题、分享链接输入框）。
    - 把 `boardId` 传给 `Whiteboard` 组件。

- **`client/src/whiteboard/types.ts`**
  - 定义前端白板内部使用的类型：
    - `Point`：坐标点 `{ x, y }`。
    - `Tool`：当前工具类型，包含：`pen | rect | circle | triangle | diamond | arrow | text | select | eraser`。
    - `LineStyle`：线型 `solid | dashed`。
    - `DrawOp`：统一的绘图操作联合类型，支持：
      - `StrokeOp`：自由线条。
      - `RectOp`：矩形。
      - `CircleOp`：圆形。
      - `TriangleOp`：等腰三角形（基于矩形包围盒计算顶点）。
      - `DiamondOp`：菱形（基于包围盒 + 中心点）。
      - `ArrowOp`：箭头（直线 + 终点箭头三角）。
      - `TextOp`：文本。

- **`client/src/whiteboard/drawUtils.ts`**
  - `drawOperations(ctx, ops, selectedIndex)`：根据 `ops` 顺序在 Canvas 上重绘所有元素，当前选中元素会有高亮阴影。
  - `translateOp(op, dx, dy)`：对矩形/圆形/三角形/菱形/箭头/文本做平移，用于拖拽。
  - `hitTest(ops, point)`：命中测试，从最后一个图形开始向前查找，支持矩形、圆形、线条、三角形、菱形、箭头、文本的点击选中/擦除。

- **`client/src/components/Whiteboard.tsx`**
  - 职责：**核心白板逻辑 & Canvas 绘制 & 实时同步**。
  - 主要状态：
    - `tool`: 当前工具。
    - `color`: 画笔/图形颜色。
    - `lineWidth`: 线宽。
    - `lineStyle`: 线型（实线/虚线）。
    - `ops`: 当前白板的所有绘图操作（从后端同步/本地操作都会写入）。
    - `redoStack`: 本地重做栈（当前只对“新增图形”生效）。
    - `selectedIndex`: 当前选中的图形索引（用于高亮、属性编辑、删除、拖拽）。
    - `wsRef`: 当前 WebSocket 连接。
  - 核心交互：
    - 绘制：支持铅笔、矩形、圆形、三角形、菱形、箭头。
    - 文本：点击画布弹出输入框，在点击位置绘制文本。
    - 选择：命中测试选中一个图形，可拖拽（矩形/圆形/三角形/菱形/箭头/文本）。
    - 橡皮擦：按住左键移动，经过的图形会被整条删除并通过 `reset` 广播同步。
    - 属性编辑：
      - 颜色：修改全局颜色，或对选中图形单独改色并同步。
      - 线宽：同上。
      - 线型：实线/虚线切换，对新图形生效，也可应用到选中图形。
    - 撤销/重做：
      - “撤销”按钮 / `Ctrl+Z`：删除 `ops` 的最后一个图形，推入 `redoStack`，通过 `reset` 同步。
      - “重做”按钮 / `Ctrl+Y`/`Ctrl+Shift+Z`：从 `redoStack` 取出最后一个图形重新追加。
    - 快捷键：
      - `Ctrl+1~7`：分别切换到 铅笔 / 矩形 / 圆形 / 三角形 / 菱形 / 箭头 / 文本。
      - `Ctrl+Z`：撤销新增操作。
      - `Ctrl+Y` 或 `Ctrl+Shift+Z`：重做。
  - 实时同步：
    - 开发环境：`WS_URL` 为 `ws://${window.location.hostname}:4000/ws`。
    - 部署版：`WS_URL` 为 `ws://${window.location.host}/ws`，与 `released_version/server.js` 对应。
    - 处理消息：
      - `init`：首次连接拉取完整 `ops`，做一次全量重放。
      - `op`：由本地或其他客户端新增的单条操作（绘制图形）。
      - `reset`：用于撤销/重做/属性修改/橡皮擦/拖拽后广播完整 `ops`。

---

## 运行方式简要说明

1. **安装依赖**
   - 根目录（后端）：
     ```bash
     npm install
     ```
   - 前端：
     ```bash
     cd client
     npm install
     ```

2. **启动后端（NodeJS 服务）**
   ```bash
   # 在项目根目录
   npm run dev
   # 输出：Whiteboard server listening on http://localhost:4000
   ```

3. **启动前端（React 白板）**
   ```bash
   cd client
   npm run dev
   # 默认访问：http://localhost:5173/
   ```

4. **体验协同绘图**
   - 浏览器打开 `http://localhost:5173/`（或 Vite 输出的实际端口），地址栏会自动带上 `?boardId=xxxxxx`。
   - 复制完整链接到另一个浏览器窗口/设备，即可在同一白板实时协作绘图。

---

## 可以继续拓展的方向

- 增加图层/锁定/对齐/吸附等高级编辑能力。
- 显示多用户光标位置、用户名标记。
- 把白板内容存入数据库（例如 MongoDB/PostgreSQL），支持历史版本与回放。
- 支持离线绘图、自动重连与冲突合并等更复杂的协同模型。


