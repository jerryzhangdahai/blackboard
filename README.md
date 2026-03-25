## 协同白板项目

一个基于 **React + Canvas + WebSocket + Node.js** 的在线团队协作白板，支持多人实时绘图、URL 分享、选择/拖拽、橡皮擦、基本图形和快捷键等功能。

### 项目功能

- ✅ 绘制自由线条、矩形、圆形、三角形、菱形、箭头、文本
- ✅ 图形支持设置颜色、线条粗细、线条样式（实线/虚线），并在选中状态下实时调整而不会丢失选中
- ✅ 文本支持就地编辑：点击画布弹出输入框、双击已有文字编辑，提供独立“字体大小”滑块和右下角拖拽手柄缩放字号
- ✅ 线条/图形支持选中后拖拽整体移动，以及通过右下角拖拽手柄连续调整线条粗细
- ✅ 支持选中图形编辑属性、删除、拖拽移动
- ✅ 橡皮擦工具（支持路径擦除和整图删除）
- ✅ 可生成链接（URL）分享白板，打开链接即可看到同一个白板内容
- ✅ 多人实时协作编辑（A 绘画时 B 能实时看到）
- ✅ Undo / Redo（撤销/重做）
- ✅ 快捷键支持：
  - `Ctrl+Z`：撤销
  - `Ctrl+Y` 或 `Ctrl+Shift+Z`：重做
  - `Ctrl+1~9`：切换绘图工具
## 技术栈

- **前端**：React 19 + TypeScript + Vite
- **后端**：Node.js + Express + WebSocket (ws)
- **核心绘制**：HTML5 Canvas
- **实时通信**：WebSocket


## 项目架构

### 代码组织

- **`client/`**：完整的前端应用
  - 包含页面结构（`App`、`WhiteboardPage`）、交互逻辑（`Whiteboard`）、样式、Vite/TS 配置等
  
- **`client/pkgs/whiteboard-core`**：可复用的白板核心库
  - `types.ts`：白板类型定义（`Point`、`Tool`、`LineStyle`、`DrawOp` 等）
  - `drawUtils.ts`：Canvas 绘制核心算法（重绘、平移、命中测试）
  - `shapeRegistry.ts`：图形处理器注册表
  - `incrementalDraw.ts`：增量绘制优化
  - `spatialIndex.ts`：空间索引（用于加速命中测试）
  
- **`server/`**：Node.js 后端服务
  - WebSocket 服务器，维护白板房间状态
  - 支持内存管理和自动清理机制

## 项目结构

```
.
├── package.json          # 后端依赖和脚本
├── server/               # Node.js 后端服务
│   └── index.js          # WebSocket 服务器和 API
├── client/               # React 前端应用
│   ├── src/
│   │   ├── App.tsx       # 应用入口
│   │   ├── WhiteboardPage.tsx  # 白板页面容器
│   │   ├── components/
│   │   │   └── Whiteboard.tsx  # 核心白板组件
│   │   └── whiteboard/   # 类型和工具（复用 pkgs）
│   └── pkgs/
│       └── whiteboard-core/  # 可复用的白板核心库
└── README.md
```

### 后端（server/）

- **`index.js`**：WebSocket 服务器
  - 维护白板房间状态：`Map<boardId, { ops, clients, ... }>`
  - HTTP API：
    - `GET /health`：健康检查
    - `GET /api/stats`：内存统计
    - `GET /api/config`：配置查询
    - `POST /api/config`：配置修改
  - WebSocket 协议：
    - 连接：`ws://localhost:4000/ws?boardId=xxx`
    - 消息类型：
      - `init`：初始化，发送完整操作列表
      - `op`：单条绘图操作
      - `reset`：完整操作列表同步（用于撤销/重做等）

---

### 前端（client/）

- **`src/WhiteboardPage.tsx`**：白板页面容器
  - 从 URL 读取或生成 `boardId`
  - 渲染顶部标题栏和分享链接
  
- **`src/components/Whiteboard.tsx`**：核心白板组件
  - Canvas 绘制和交互逻辑
  - WebSocket 实时同步
  - 支持绘制、选择、拖拽、橡皮擦、撤销/重做等功能
  
- **`src/whiteboard/types.ts`** 和 **`src/whiteboard/drawUtils.ts`**
  - 通过 `export` 复用 `pkgs/whiteboard-core` 中的实现

---

## 快速开始

### 安装依赖

```bash
# 安装后端依赖
npm install

# 安装前端依赖
cd client
npm install
```

### 启动服务

**终端 1 - 启动后端：**
```bash
npm run dev
# 后端运行在 http://localhost:4000
```

**终端 2 - 启动前端：**
```bash
cd client
npm run dev
# 前端运行在 http://localhost:5173
```

### 使用

1. 浏览器打开 `http://localhost:5173/`
2. 地址栏会自动生成 `?boardId=xxxxxx`
3. 复制完整链接分享给其他人，即可在同一白板实时协作绘图

---

## 核心特性

### 性能优化

- **增量绘制**：新增图形时使用增量绘制，避免全量重绘
- **空间索引**：大规模图形时使用空间索引加速命中测试
- **路径抽稀**：橡皮擦路径自动抽稀，减少计算量

### 服务端特性

- **内存管理**：自动清理过期白板，防止内存泄漏
- **LRU 淘汰**：超过最大白板数时自动清理最旧的白板
- **操作限制**：单个白板最大操作数限制，防止无限增长

## 未来规划

- 图层管理和锁定功能
- 多用户光标位置显示
- 数据库持久化（支持历史版本和回放）
- 离线绘图和自动重连
- 冲突合并算法优化

