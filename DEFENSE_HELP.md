# 协同白板项目 · 答辩速查提纲（口语版）

> 目录下：`C:\Users\82597\Desktop\Sharedblackboard-changed\DEFENSE_HELP.md`  
> 用来答辩时快速过一遍整体思路，不是细讲代码。

---

## 1. 我这个项目整体在干什么？

一句话：**做了一个基于 Web 的多人协同白板**——类似在线画板，多人同时画图、编辑、擦除，所有人实时同步。

简单拆开就是三件事：

1. **前端画板 UI**：用户能在浏览器里选工具、在 Canvas 上画各种图形、选中/拖拽/擦除。
2. **后端房间管理**：服务端维护“每块白板”的当前内容，把一个人的操作同步给其他人。
3. **通信协议**：前后端通过 WebSocket 约好消息格式，谁画了什么、状态怎么同步，都走统一的协议。

---

## 2. 前端核心：画布 + 状态 + 图形体系

可以把前端想成三层：

### 2.1 Whiteboard 组件：一块白板的“当前状态”

`src/components/Whiteboard.tsx`

- 这是一个 React 组件，**一块白板就对应一个 Whiteboard 实例**。
- 它维护这一块白板此刻的状态：
  - `ops: DrawOp[]`：这块白板上所有图形，按时间顺序的列表。
  - `tool: Tool`：当前选中的工具（笔、矩形、圆形、箭头、文本、橡皮擦等）。
  - `color / lineWidth / lineStyle`：当前画笔样式。
  - `selectedIndex`：当前选中的第几个图形。
  - `redoStack`：撤销之后存放要重做的操作。
- 还有一组 `ref` 是辅助用的：
  - `previousOpsRef`：上一帧的 `ops`，用来做增量绘制。
  - `spatialIndexRef`：空间索引对象，加速命中测试。
  - `pendingOpsRef`：发给服务端、但还没确认回来的消息队列，用来做 WebSocket 回显去重。

可以这样理解：**Whiteboard 组件就是这一块白板的大脑，所有绘图、选中、擦除的状态都在这里集中管理。**

### 2.2 DrawOp 类型：统一的“图形语言”

`client/pkgs/whiteboard-core/src/types.ts`

- 我没有让每种图形随便长，而是先定义了一套**统一的数据结构**：
  - `Point`：点 `{ x, y }`
  - `Tool`：`'pen' | 'rect' | 'circle' | ...`
  - `LineStyle`：`'solid' | 'dashed'`
  - `DrawOp`：一条绘图操作，可以是：
    - `StrokeOp`：自由线条（点数组 + 样式）
    - `RectOp`：矩形（start/end 点 + 样式）
    - `CircleOp`：圆形（center + 半径 + 样式）
    - `ArrowOp`、`TriangleOp`、`DiamondOp`、`TextOp` 等

前端状态里的 `ops: DrawOp[]` 就是**一连串按这个规范描述的操作**，这样前端、后端、WebSocket 消息都能共用同一套结构。

### 2.3 图形处理器 + 注册表：怎么画、怎么选、怎么扩展

`client/pkgs/whiteboard-core/src/shapes/*.ts` + `shapeRegistry.ts`

为了让不同图形共用一套调用方式，同时又各自实现不同的算法，我抽象了一个“图形处理器”体系：

- 定义统一接口 `ShapeHandler`：
  - `draw(ctx, op)`：怎么画。
  - `hitTest(op, point)`：点击点在不在这个图形上。
  - `translate(op, dx, dy)`：拖拽时怎么平移。
  - `create(start, end, props)`：拖出一个矩形/圆形时生成什么 `DrawOp`。
  - `getBoundingBox(op)`：返回包围盒，给空间索引用。
- 每种图形对应一个处理器类：
  - `RectHandler` 只管矩形。
  - `CircleHandler` 只管圆形。
  - `StrokeHandler` 只管自由线条。
  - `TextHandler` 只管文本。
- 有一个 `shapeRegistry`（注册表）统一管理：
  - 启动时：`shapeRegistry.register(new RectHandler())` 之类，把所有处理器登记进去。
  - 运行时：根据 `op.kind` 找到处理器：
    ```ts
    const handler = shapeRegistry.getHandler(op.kind);
    handler.draw(ctx, op, isSelected);
    ```

**好处**：上层代码（比如绘制、命中测试）只需要写一遍，完全不关心图形细节。将来想加“圆角矩形”、“星形”等，只要补一个 `XXXOp` + `XXXHandler` + 注册一下，其他地方几乎不用动。

---

## 3. 后端核心：白板房间 + WebSocket 广播

后端只有一个文件：`server/index.js`，做三件事：

### 3.1 内存里的“白板房间”数据结构

用一个 `Map<boardId, board>` 管所有房间，每个房间大概长这样：

```js
{
  ops: DrawOp[],            // 当前这块白板的所有图形
  clients: Set<WebSocket>,  // 正连在这个白板上的客户端
  createdAt, lastActiveAt,  // 时间戳，配合清理策略
  lastClientDisconnectAt,
  opCount,                  // 操作数缓存
  priority, compressed      // 给内存管理用
}
```

可以理解为：**前端那边每个 Whiteboard，有一块对应的“服务端白板房间”在这张 Map 里。**

### 3.2 WebSocket 协议：怎么“说话”

前后端通过 `ws://localhost:4000/ws?boardId=xxx` 建立长连接，消息都用统一格式：

- 客户端 → 服务端：
  - `{ type: 'op', payload: DrawOp }`：新增一条绘图操作。
  - `{ type: 'reset', ops: DrawOp[] }`：整条操作列表（撤销/重做/擦除后）。
- 服务端 → 客户端：
  - `{ type: 'init', boardId, ops }`：新连进来时，把当前白板所有内容发过去。
  - `{ type: 'op', payload }`：有新操作，广播给其他人。
  - `{ type: 'reset', ops }`：有人做了大改动（撤销/重做/擦除等），广播完整列表。

配合前端的“去重队列”（`pendingOpsRef`），可以避免自己发的操作又被自己重复追加一次。

### 3.3 内存与清理策略

为了不让服务器内存无限涨，后端对白板房间做了一套生命周期管理：

- 限制白板数量：超过 `MAX_BOARDS` 会按 LRU（最久未使用）策略清理旧白板。
- TTL：一个白板在没人连的情况下超过一定时间会被自动删除。
- 操作数量限制：单块白板超过 `MAX_OPS_PER_BOARD` 只保留最近的部分。
- 压缩：`COMPRESSION_THRESHOLD` 之上会做一次“老操作裁剪”，减小内存占用。

这些都是服务端内部逻辑，对前端是透明的。

---

## 4. 前后端怎么协同起来？

可以用一条主线串起来说：

1. 用户打开前端页面，`WhiteboardPage` 会生成/读取一个 `boardId`，然后渲染 `<Whiteboard boardId={boardId} />`。
2. `Whiteboard` 组件挂载时，用 `boardId` 建立 WebSocket 连接：`ws://.../ws?boardId=xxx`。
3. 服务端看到有新连接：
   - 如果这个 `boardId` 的房间不存在，就创建一个空房间。
   - 然后把当前房间里的 `ops` 打包成 `{ type: 'init', ops }` 发给新客户端做初始化。
4. 之后每次用户有操作（画图、撤销、擦除）：
   - 前端先在本地更新 `ops`，用 Canvas（配合增量绘制和空间索引）渲染出来。
   - 再按约定好的消息格式，通过 WebSocket 发给服务端。
5. 服务端更新对应房间的 `ops`，然后广播给**所有连在这个房间的客户端**。
6. 其他客户端收到后，同样更新自己的 `ops`，触发重绘，于是大家看到的就是同一块白板。

一句话：**前端负责“怎么画”和“本地交互”，后端负责“房间状态 + 广播”；两边通过一套统一的 `DrawOp` 和 WebSocket 消息结构粘在一起。**

---

## 5. 可以重点讲的“亮点”

答辩时如果要挑重点，可以抓这几条说：

1. **统一的 DrawOp 数据模型**  
   - 把所有图形抽象成同一套类型（`StrokeOp / RectOp / CircleOp / ...`），前后端和协议都用这一套，避免格式乱飞。

2. **图形处理器 + 注册表的设计**  
   - 像 C++ 的抽象基类 + 多态：`ShapeHandler` 定义能力，每种图形一个 `XXXHandler` 实现，`shapeRegistry` 统一分发。
   - 新增图形只需增加一个 Handler，公共逻辑几乎不用改，扩展性好。

3. **空间索引 + 增量绘制的性能优化**  
   - 大量图形时，命中测试不是扫全表，而是通过 `SpatialIndex` 先筛一层候选。
   - 绘制时尽量只重绘变化部分，减轻 Canvas 压力。

4. **服务端白板房间管理和内存保护**  
   - 使用 `Map<boardId, board>` 管理房间，配合 TTL、LRU、操作压缩等策略，保证长时间运行不会无限吃内存。

5. **协议清晰、易扩展**  
   - 所有 WebSocket 消息都有明确的 `type` 字段和类型定义，后续要加例如“光标同步”、“聊天消息”都只需要在 union 里多加一条。

用这一份当提纲，从整体 → 前端 → 后端 → 协同 → 亮点，一路讲下来，基本就把项目讲清楚了。 

