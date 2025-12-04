## 写在项目说明之前
我是来自北京邮电大学信息与通信工程学院2024级博士生张嘉睿，作为字节跳动前端训练营Data组的一员，全勤参加了全部四次培训，并做了相应的记录，对于课后作业目前正在进行重构与个人手撕尝试，预期近日会push到本github仓库进行提交。不过非常抱歉近期从11月28号开始得了甲流，目前刀片嗓实在没办法录制演示视频，对老师表示抱歉，近期恢复后会尽快补录，感谢老师！
关于我个人情况已经放在了自己开发的第一堂课后作业简历里，其中我认为我个人比较有闪光点的几点，也结合本次课程总结想要单独讲出来的是：
### 具备良好的代码学习和算法设计能力
从高中开始我变投入到NOIP信息学竞赛中，很快掌握了C++这门语言，并对背包问题、动态规划、二叉树，以及常见的dfs、bfs，并查集的使用等有了自己的理解，能够独立的完成一些算法题工作，后来才知道这些题目是大学毕业后在应聘时会考的基础题。同时，在本科大一便边上课边自学了python，在2018年便尝试了基础的机器学习，实现了鸢尾花等典型事例，后来通过个人学习也不断掌握了强化学习ddpg、深度学习LSTM等网络编程能力，并通过当时2021年比较火的开源YOLO模型训练通过自建数据集识别动态视频中的人物摔倒姿势识别与预警。对于前端编程这块儿，之前作为院里微信小程序版本后台更新成员，曾自学过三剑客，并在没有AI的时代能够实现微信小程序基本功能迭代更新，不过随着时代快速发展，自己也发觉与前端前沿技术脱节，因此报名了本次前端训练营，以练代学，重续曾经的前端开发能力。

### 扎实的数学功底与逻辑思维能力
目前已拿到初级通信工程师级别评定，大学基础数学例如数学分析课程等均分95分，工程计算等利用matlab实现工程计算方法的课程均分在98分，对于数值计算也有自己的理解和认识，并在全国大学生数学建模竞赛中获得全国二等奖，实现了一个基于数值微分简化与梯度下降的模拟退火温度计算程序。同时作为通信工程专业，个人对通信专业课掌握较好，目前担任校BY1BY业余电台台长，能够根据工科思维设计实验，在无线电领域已经拿到最高等级C证，具备较好的开发实验设计能力。因此本次课题出作业后，自己便结合曾经的开发经验有了一个可能得逻辑设计，但由于个人前端开发经验不足，难以直接形成实际开发结果，这也是为第三点留下了原因。

### 善于使用AI并借助AI等大模型学习
在AI时代，人们可以不用AI，但对于复杂工程来说，对于面相开发创新性较低重复性较高的工作，其效率就会有所降低；也不能滥用AI，即完全照搬AI生成的内容去做本该人类做的事情。AI在我看来是一项辅助工具，就本次课题作业而言，我借用cursorAI和trea两个AI编程软件辅助开发，其原因在近期恰好开课时间突然通知博士开题答辩与材料提交，本次ddl时间恰好在开题报告提前的前一天（也就是12.5提交开题材料），通过时间统筹和整合，对于从react学起，到基于VITE做打包压缩，再到对于websocket开发时所要考虑的前后端交互程序逻辑，最后以例如本课题作业使用的canvas作为开源图形库作为可视化，每一个环节对我而言都需要很仔细全面的在很多实践中得到学习和提升。很喜欢课堂上老师说过的一句话：前端或者各项开发，不是靠死记硬背某一个框架或者说明文档里的内容学会的，而是通过开发设计遇到一个模块需要实现某些功能时，通过说明文档查阅，或者询问AI辅助的方式，不断运用，积累内化成自己的经验。对此我认为，基础语法作为核心需要不断练习，对于高度复用的前端工作，很多组件化的内容的确需要不断拿来反复利用才能内化成自己的工作。因此本次课题作业，我通过AI辅助的方式，一步一步实现每一个功能，在实现功能时，我会让AI去总结好每一步debug存在的问题，并根据个人理解在代码中记录关键点，也包括遇到不明白的语法结构会让AI加以备注，而对于框架使用时，由于开发经验少，我主动让AI为我解释清楚在什么情况下需要添加哪一些组件，根据整体逻辑对应哪些文件里又应该做好相应的修改。这一过程让我内化学习到很多。同时，为了增强代码复用性，我让AI对于每个阶段开发时的关键模块做好提炼，通过本地迭代和整理，最终整合成pkgs包，实话讲里面有一些逻辑自己还在摸索，但基于目前开题即将完成，自己会投入更多时间愿意去学明白，相信自己很快就能弄清楚其中的逻辑与开发技巧，目前也让AI做了相应总结。

以上三点，也包括自己的一些开发历程，希望老师批评指正！本课题作业一定有完成的不足之处，最典型的一点就是自己没能从零自己手写出完整代码，以及对于其中一些逻辑架构开发不能做到百分百熟悉，一方面甲流影响另一方面开题原因，希望得到老师的谅解，也会通过近期状态和时间的保障来补好相应的内容。
再次感谢老师！

项目实现的功能：
  - 绘制自由线条、矩形、圆形、线条
  - 上述图形支持设置颜色、线条粗细、线条样式（实线/虚线）
  - 支持选中某个图形编辑颜色线条等属性、删除
  - 【挑战】支持橡皮擦工具
  - 【挑战】支持扩展更多的工具和图形，三角形、菱形、箭头
  - 可生成链接（URL）分享白板，打开链接即可看到同一个白板内容
  - A 绘画时 B 能实时看到展示（可以是绘制完成后同步，也可以流式同步）
  - 【挑战】支持多人实时协作编辑——该内容采用并通过了局域网测试，后续演示视频会着重演示该功能
  - Undo / Redo
  - 常见快捷键（支持：Undo/Redo、切换工具），ctrl+z ctrl+y ctrl+1/2/3/4/5


本课程时间相对很紧凑，从第一次开课到如今提交最终个人课题作业，仅有20天时间，作为一名信息与通信工程专业的博士生，我的确在紧凑的学习节奏中感受到了一定的压力，
## 各 README/说明文档的作用一览

- `README.md`（根目录）  
  - 面向“整体项目使用者 + 开发者”的总说明：项目介绍、目录结构、运行方式、前后端代码说明，以及 `client` 与 `pkgs/whiteboard-core` 之间的复用关系。

- `Development Process Documentation.md`  
  - 面向“想搞清楚代码来源和结构的人”：说明哪些文件是手写的、哪些来自模板或自动生成、哪些逻辑已抽到 `pkgs` 复用。

- `Debug_log.md`  
  - 面向“调试/回顾问题”的场景：记录协同问题的排查过程，便于以后出现类似问题时快速对照。

- `pkgs/README.md`  
  - 面向“希望把白板核心能力当库来用”的人：说明 `pkgs` 目录用途，当前已经有哪些包（`whiteboard-core`），以及里面暴露了什么能力。

- `released_version/README.md`  
  - 面向“只想本地跑部署版的人”：告诉用户下载 `released_version` 后，只需 `npm install && npm start`，然后访问 `http://localhost:4000/` 即可。

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


