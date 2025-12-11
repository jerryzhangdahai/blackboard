## 调试日志（debug_log）

记录本协同白板项目从开发到稳定过程中遇到的关键问题，以及对应的排查思路和解决方案，便于以后回顾或在新项目中复用经验。

---

### 问题 1：协同完全不生效（WebSocket 连接立刻被关闭）

- **现象**
  - 在源码开发版（`client` + `server/index.js`）中，打开两个窗口使用同一个 `?boardId=xxx` 链接。
  - 一个窗口画图，另一个窗口始终没有任何变化。
  - 控制台持续报错：  
    `WebSocket connection to 'ws://localhost:4000/ws?...' failed: WebSocket is closed before the connection is established.`

- **排查过程**
  1. 用 `http://localhost:4000/health` 检查后端，返回 `{"ok": true}`，说明 Node 服务和 4000 端口正常。
  2. 用 Node 脚本直接连 WS：
     ```bash
     node -e "const WebSocket=require('ws');const ws=new WebSocket('ws://localhost:4000/ws?test=1');ws.on('open',()=>{console.log('ws open');ws.close();});ws.on('error',e=>{console.error('ws error',e.message);});"
     ```
     输出 `ws open`，证明服务端 WebSocket 没问题。
  3. 在 `server/index.js` 中给 `wss.on('connection')` 加日志，确认浏览器访问页面时，后端确实收到连接请求。
  4. 查看前端入口 `main.tsx`，发现使用了 React 18 的 `StrictMode` 包裹 `<App />`。
  5. 结合 React 18 行为，怀疑 StrictMode 让 `Whiteboard` 的 `useEffect`（创建 WebSocket）执行两次：第一次创建连接，cleanup 立刻 `ws.close()`，第二次再创建，浏览器就报“尚未建立就被关闭”。

- **解决方案**
  - 去掉入口的 StrictMode：
    ```tsx
    import { createRoot } from 'react-dom/client';
    import './index.css';
    import App from './App.tsx';

    createRoot(document.getElementById('root')!).render(<App />);
    ```
  - 重启 Vite 开发服后，再次用同一个 `boardId` 测试，协同恢复正常。

> 经验：React 18 开发模式下，带副作用的 `useEffect`（网络连接、订阅）要么写成幂等，要么在开发阶段关闭 StrictMode。

---

### 问题 2：撤销快捷键（Ctrl+Z / Ctrl+Y）不生效

- **现象**
  - 工具栏按钮“撤销/重做”正常。
  - 但按 `Ctrl+Z` / `Ctrl+Y` 没任何效果，也没报错。

- **排查过程**
  1. 检查按钮的 `onClick={handleUndo}`，行为正确。
  2. 查看全局快捷键代码：在 `useEffect` 中监听 `keydown`，直接调用 `handleUndo()/handleRedo()`，但这两个函数在组件体内稍后用 `const` 声明。
  3. 发现监听函数捕获的是**初次渲染时的 `ops` 和 `redoStack` 值**，之后状态变化，但闭包里的引用没变，导致每次看到的 `ops.length` 始终是 0。

- **解决方案**
  - 使用 `useCallback` 包裹 `handleUndo` / `handleRedo`，并把 `ops`、`redoStack` 作为依赖：
    ```ts
    const handleUndo = useCallback(() => {
      if (ops.length === 0) return;
      const next = ops.slice(0, -1);
      const last = ops[ops.length - 1];
      setRedoStack((prev) => [...prev, last]);
      broadcastReset(next, null);
    }, [ops]);
    ```
  - 将快捷键的 `useEffect` 依赖改为 `[handleUndo, handleRedo]`，保证每次绑定到最新逻辑。

> 经验：全局快捷键/事件监听里调用的 handler，要么用 `useCallback` 固定签名、依赖最新状态，要么通过 `ref` 保存最新函数，避免闭包读到旧状态。

---

### 问题 3：加完快捷键后白屏（Cannot access 'handleUndo' before initialization）

- **现象**
  - 修改快捷键逻辑后，页面刷新即白屏。
  - 控制台报错：`Cannot access 'handleUndo' before initialization`，指向绑定快捷键的 `useEffect`。

- **排查过程**
  - 在同一组件函数体里，`useEffect` 写在上面，而 `const handleUndo = ...` 写在下面。
  - 由于 `const` 存在“暂时性死区”，在初始化之前就被闭包访问，引发运行时错误。

- **解决方案**
  - 将 `broadcastReset`、`handleUndo`、`handleRedo` 这几个函数整体上移到快捷键 `useEffect` 之上定义，保证在 `useEffect` 执行前已经完成初始化。

> 经验：组件内部尽量保持“函数声明在前、使用在后”；对依赖关系复杂的逻辑，可适当拆小函数或单独文件，减少这种顺序陷阱。

---

### 问题 4：第一次拖拽图形时出现“复制品”（原地留一个、拖走一个）

- **现象**
  - 第一次拖拽某个图形时，画布上会留下一个原地不动的“影子”，拖走的是它的复制品。

- **排查过程**
  1. 检查拖拽逻辑：只是修改 `ops[idx]`，没新建元素，看起来没问题。
  2. 打印拖拽前后的 `ops.length`，发现比预期多 1。
  3. 追踪 `ops` 的写入路径：  
     - 本地 `finishDrawing` 时执行了 `setOps([...ops, op])`；  
     - 同时通过 `sendOp(op)` 发给后端；  
     - 后端收到 `op` 后 `board.ops.push(payload)` 并广播；  
     - 前端 `ws.onmessage` 处理 `op` 时又 `setOps(prev => [...prev, payload])`；  
     → 同一条操作被追加了两次。

- **解决方案**
  - 修改 `finishDrawing`，绘制完成后只负责发送，不再本地立即追加：
    ```ts
    if (!op) return;
    setRedoStack([]);
    setSelectedIndex(null);
    sendOp(op); // 由服务端广播回来时统一 append
    ```
  - 统一由 WebSocket 消息（`init/op/reset`）驱动 `ops` 的最终状态，避免“双写”。

> 经验：在协同应用中，最好约定“状态最终以服务端广播为准”，前端本地只做“发命令”，否则很容易出现重复或顺序问题。

---

### 问题 5：局域网 IP 访问时协同失效（本机正常）

- **现象**
  - 同一台电脑上，用 `http://localhost:517x` 打开两个窗口协同正常。
  - 但在其他设备上用 `http://10.xxx.xxx.xxx:517x` 访问时，要么协同失效，要么只单向生效。

- **排查过程**
  - 检查前端 WebSocket 地址：之前写死为 `ws://localhost:4000/ws`。
  - 当外部机器通过 `10.xxx.xxx.xxx` 访问前端时，它会尝试连自己本机的 `localhost:4000`，而不是开发机的 4000 端口。

- **解决方案**
  - 改为根据当前页面的主机名动态拼接：
    ```ts
    const WS_URL =
      import.meta.env.DEV
        ? `ws://${window.location.hostname}:4000/ws`
        : `ws://${window.location.host}/ws`;
    ```
  - 开发环境下会用当前页面的 `hostname`（`localhost` 或 `10.x.x.x`），部署版则直接沿用 HTTP 的 `host`。

> 经验：前端里不要在 WebSocket 地址中写死 `localhost`，用 `window.location.hostname/host` 更稳妥。

---

### 总结：后续调试类似项目时的建议

1. **先区分“后端挂了”还是“前端自杀”**：  
   - 用 `/health` 和简单的 Node WebSocket 脚本先确认服务是否正常，再看前端的 `useEffect` / cleanup。

2. **对带副作用的 `useEffect` 保持敏感**：  
   - 在 React 18 开发模式下，StrictMode 会让这些副作用执行两遍；  
   - 对网络连接/订阅类逻辑，要么写成幂等，要么在开发阶段关闭 StrictMode。

3. **键盘事件 / 全局监听尽量用 `useCallback` + 依赖**：  
   - 避免闭包捕获旧状态，确保快捷键行为和按钮点击一致。

4. **协同状态统一从服务端广播驱动**：  
   - 本地不要和服务端同时写同一份状态，否则很容易出现重复、顺序错乱等问题。

5. **多环境访问时，优先使用 `hostname/host` 构造地址**：  
   - 支持从 `localhost` 切到 `10.x.x.x` 甚至域名，而不用到处改硬编码地址。

按这几条思路排查，大部分“协同失效”或“前端连不上 WebSocket”的问题都能比较快地定位到原因。

---

### 附：几个比较基础但经常遇到的编码问题

> 这些问题本身不复杂，但在频繁改代码时很容易反复踩到，顺手记一下。

#### 基础问题 A：TypeScript 报 “Property 'style' is missing...” 之类的错误

- **背景**：给线条/矩形等图形新增了 `style: LineStyle` 字段。
- **报错示例**：
  - `Property 'style' is missing in type '{ kind: "rect"; ... }' but required in type 'RectOp'.`
- **原因**：
  - 在 `types.ts` 中把 `style` 定义为必填字段，但在某些地方创建 `RectOp` / `CircleOp` / `TriangleOp` 时忘记带上 `style`。
- **解决方式**：
  - 先从报错行跳到对应的对象字面量，在那里补上 `style: lineStyle` 之类的字段；
  - 再全局搜索 `kind: 'rect'` / `kind: 'circle'` 等，确认所有创建点都已经补齐。

#### 基础问题 B：移动代码到 `pkgs` 后，导入路径写错

- **现象**：
  - 报错 `Cannot find module '../../pkgs/whiteboard-core/src/types'` 或类似。
- **原因**：
  - 文件从 `client/src/whiteboard/` 挪到 `pkgs/whiteboard-core/src/` 后，旧的相对路径不再成立。
- **解决方式**：
  - 统一规范：  
    - 在 `client/src/whiteboard/types.ts` 中只写  
      `export * from '../../pkgs/whiteboard-core/src/types';`  
    - 在 `client/src/whiteboard/drawUtils.ts` 中只写  
      `export * from '../../pkgs/whiteboard-core/src/drawUtils';`
  - 其他前端代码一律只从 `client/src/whiteboard/*` 导入，而不要直接去引用 `pkgs` 的内部路径。

#### 基础问题 C：修改服务端代码后，前端行为没变化

- **现象**：
  - 改了 `server/index.js` 或 `released_version/server.js` 里的逻辑，但前端表现依旧。
- **原因**：
  - Node 服务器没有重启，旧进程仍在跑旧代码。
- **解决方式**：
  - 开发阶段：习惯性在改完服务端后执行一次 `Get-Process node | Stop-Process`，再 `node server/index.js` 重新启动；
  - 或者使用 nodemon 等工具自动重启（当前项目为了简洁没有引入，可以按需添加）。

---

### 问题 6：Vite 无法解析 `pkgs` 目录的导入路径

- **现象**：
  - 将 `pkgs/whiteboard-core` 从项目根目录移到 `client/pkgs/whiteboard-core` 后，Vite 报错：
    `Failed to resolve import "../../pkgs/whiteboard-core/src/drawUtils.ts" from "src/whiteboard/drawUtils.ts"`
  - 即使路径看起来正确，Vite 仍然无法找到模块。

- **排查过程**：
  1. 确认文件确实存在于 `client/pkgs/whiteboard-core/src/drawUtils.ts`。
  2. 检查相对路径：从 `client/src/whiteboard/drawUtils.ts` 到 `client/pkgs/whiteboard-core/src/drawUtils.ts`，应该是 `../../pkgs/...`。
  3. 发现 Vite 默认只在 `client/` 目录内解析模块，`pkgs` 放在根目录时超出了 Vite 的解析范围。

- **解决方案**：
  - 将 `pkgs` 目录移到 `client/` 目录下，路径改为 `../pkgs/...`（从 `client/src/whiteboard/` 向上两级到 `client/`，再进入 `pkgs/`）。
  - 将 `export * from ...` 改为显式导出，提高可靠性：
    ```ts
    // types.ts
    export type { Tool, Point, LineStyle, DrawOp, ... } from '../../pkgs/whiteboard-core/src/types';
    
    // drawUtils.ts
    export { drawOperations, translateOp, hitTest } from '../../pkgs/whiteboard-core/src/drawUtils';
    ```

> 经验：Vite 的模块解析范围默认限制在项目根目录（对于 `client/` 子项目，就是 `client/` 目录内）。如果需要跨目录引用，要么把代码移到 Vite 能解析的范围内，要么配置 `vite.config.ts` 的 `resolve.alias`。

---

### 问题 7：WebSocket 在连接建立前尝试发送数据导致错误

- **现象**：
  - 浏览器控制台报错：`Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.`
  - 画图时无法发送数据，导致协同失效。

- **排查过程**：
  1. 检查 `sendOp` 函数，发现使用了 `wsRef.current?.send(...)`，但没有检查 WebSocket 状态。
  2. WebSocket 连接是异步的，在 `CONNECTING` 状态时调用 `send()` 会抛出异常。

- **解决方案**：
  - 在 `sendOp` 和 `broadcastReset` 函数中添加状态检查：
    ```ts
    const sendOp = (op: DrawOp) => {
      const ws = wsRef.current;
      if (!ws) {
        console.warn('WebSocket not initialized');
        return;
      }
      if (ws.readyState !== WebSocket.OPEN) {
        console.warn(`WebSocket not ready, state: ${ws.readyState}`);
        return;
      }
      ws.send(JSON.stringify({ type: 'op', payload: op }));
    };
  ```
  - 添加 WebSocket 连接日志，便于调试：
    ```ts
    ws.onopen = () => {
      console.log('WebSocket connected');
    };
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    ```

> 经验：使用 WebSocket 时，一定要检查 `readyState` 是否为 `WebSocket.OPEN`（值为 1）再发送数据。状态值：0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED。
