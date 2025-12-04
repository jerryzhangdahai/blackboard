const path = require('path');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 4000;

// ===== 白板数据（内存版）=====
// 结构：{ [boardId]: { ops: [], clients: Set<WebSocket> } }
const boards = new Map();

function createBoardIfNotExists(boardId) {
  const id = boardId || Math.random().toString(36).slice(2, 10);
  if (!boards.has(id)) {
    boards.set(id, { ops: [], clients: new Set() });
  }
  return id;
}

// ===== 静态资源（前端打包产物）=====
// 约定：本目录下存在 dist/（从 client/dist 复制过来）
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// 单页应用：所有未知路径都返回 index.html
app.use((_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// ===== WebSocket 实时协作 =====
// 连接地址：ws://localhost:4000/ws?boardId=xxx
wss.on('connection', (ws, req) => {
  const params = new URLSearchParams(req.url.replace(/^.*\?/, ''));
  const boardId = params.get('boardId') || createBoardIfNotExists();
  const board = boards.get(createBoardIfNotExists(boardId));

  board.clients.add(ws);

  // 新客户端初始化：把历史操作推过去做重放
  ws.send(
    JSON.stringify({
      type: 'init',
      boardId,
      ops: board.ops,
    })
  );

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type === 'op') {
      board.ops.push(msg.payload);
      broadcast(board, { type: 'op', payload: msg.payload });
    } else if (msg.type === 'reset') {
      board.ops = msg.ops || [];
      broadcast(board, { type: 'reset', ops: board.ops });
    }
  });

  ws.on('close', () => {
    board.clients.delete(ws);
    if (board.clients.size === 0 && board.ops.length === 0) {
      boards.delete(boardId);
    }
  });
});

function broadcast(board, msg) {
  const data = JSON.stringify(msg);
  board.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

server.listen(PORT, () => {
  console.log(`部署版协同白板已启动：http://localhost:${PORT}`);
});


