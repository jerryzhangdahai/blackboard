# 2025年12月12日变更记录

## 概述

本次变更主要修复了 Vite 模块解析问题和 WebSocket 连接状态检查问题，确保前端能够正常加载和运行。

---

## 主要修改

### 1. 修复 Vite 模块解析问题

**问题**：
- Vite 无法解析 `pkgs/whiteboard-core` 的导入路径
- 报错：`Failed to resolve import "../../pkgs/whiteboard-core/src/drawUtils.ts"`

**原因**：
- `pkgs` 目录原本位于项目根目录
- Vite 默认只在 `client/` 目录内解析模块，无法访问根目录下的 `pkgs`

**解决方案**：
- 将 `pkgs` 目录从根目录移动到 `client/pkgs/`
- 更新导入路径：
  - `client/src/whiteboard/types.ts`: `export type { ... } from '../../pkgs/whiteboard-core/src/types';`
  - `client/src/whiteboard/drawUtils.ts`: `export { drawOperations, translateOp, hitTest } from '../../pkgs/whiteboard-core/src/drawUtils';`
- 将 `export *` 改为显式导出，提高可靠性和可读性

**涉及文件**：
- `client/src/whiteboard/types.ts`
- `client/src/whiteboard/drawUtils.ts`
- `client/pkgs/whiteboard-core/src/types.ts`（移动）
- `client/pkgs/whiteboard-core/src/drawUtils.ts`（移动）
- `client/pkgs/README.md`（更新）

---

### 2. 修复 WebSocket 连接状态检查

**问题**：
- 浏览器控制台报错：`Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.`
- 画图时无法发送数据，导致协同功能失效

**原因**：
- `sendOp` 和 `broadcastReset` 函数在 WebSocket 连接未完全建立时就尝试发送数据
- WebSocket 连接是异步的，在 `CONNECTING` 状态（readyState = 0）时调用 `send()` 会抛出异常

**解决方案**：
- 在 `sendOp` 函数中添加 WebSocket 状态检查：
  ```typescript
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
- 在 `broadcastReset` 函数中添加相同的状态检查
- 添加 WebSocket 连接事件日志：
  ```typescript
  ws.onopen = () => {
    console.log('WebSocket connected');
  };
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
  ```

**涉及文件**：
- `client/src/components/Whiteboard.tsx`

---

### 3. 清理多余的开发服务器进程

**问题**：
- 同时有两个 Vite 开发服务器在运行（5173 和 5174 端口）
- 造成混乱，用户不确定应该使用哪个端口

**解决方案**：
- 停止 5174 端口的进程（PID: 18580）
- 保留 5173 端口作为唯一的开发服务器

**涉及操作**：
- 执行 `Stop-Process -Id 18580 -Force` 停止多余进程

---

## 文档更新

### 1. `README.md`
- 更新了 `client` 与 `pkgs` 关系的说明
- 明确 `pkgs` 现在位于 `client/pkgs/` 目录下
- 更新了导入路径示例，从 `export *` 改为显式导出

### 2. `client/pkgs/README.md`
- 更新了目录位置说明
- 添加了 Vite 模块解析的注意事项
- 更新了导入路径示例

### 3. `debug_log.md`
- 添加了"问题 6：Vite 无法解析 `pkgs` 目录的导入路径"的完整记录
- 添加了"问题 7：WebSocket 在连接建立前尝试发送数据导致错误"的完整记录

---

## 技术细节

### WebSocket 状态值
- `0` (CONNECTING): 连接正在建立
- `1` (OPEN): 连接已建立，可以发送数据
- `2` (CLOSING): 连接正在关闭
- `3` (CLOSED): 连接已关闭

### Vite 模块解析范围
- Vite 默认只在项目根目录（对于 `client/` 子项目，就是 `client/` 目录内）解析模块
- 如果需要跨目录引用，需要：
  1. 将代码移到 Vite 能解析的范围内（推荐）
  2. 或者配置 `vite.config.ts` 的 `resolve.alias`

### 显式导出 vs `export *`
- `export *` 会导出所有命名导出，但可能在某些构建工具中出现问题
- 显式导出更清晰、更可靠，也便于 Tree Shaking

---

## 测试建议

1. **验证模块解析**：
   - 启动开发服务器：`cd client && npm run dev`
   - 确认页面能正常加载，没有模块解析错误

2. **验证 WebSocket 连接**：
   - 打开浏览器控制台（F12）
   - 应该能看到 `WebSocket connected` 日志
   - 尝试画图，确认数据能正常发送和接收

3. **验证协同功能**：
   - 打开两个浏览器窗口，使用相同的 `boardId`
   - 在一个窗口画图，另一个窗口应该能实时看到变化

---

## 后续建议

1. **避免多个开发服务器**：
   - 启动前检查是否有其他 Vite 进程在运行
   - 或使用 `npm run dev -- --port 5173` 明确指定端口

2. **WebSocket 连接管理**：
   - 考虑添加重连机制，处理连接断开的情况
   - 可以考虑使用 WebSocket 库（如 `reconnecting-websocket`）来简化连接管理

3. **模块结构优化**：
   - 如果将来需要跨项目复用 `pkgs`，可以考虑：
     - 发布为独立的 npm 包
     - 或使用 monorepo 工具（如 pnpm workspaces）来管理多包项目

