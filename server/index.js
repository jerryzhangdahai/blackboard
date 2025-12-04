const express = require('express');
const http = require('http');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 4000;

// 简单内存白板数据结构：{ [boardId]: { clients: Set<WebSocket>, ops: any[] } }
const boards = new Map();

app.use(cors());
app.use(express.json());

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// 创建新白板，返回 boardId（可以由前端生成，这里提供备用接口）
app.post('/api/boards', (_req, res) => {
  const boardId = createBoardIfNotExists();
  res.json({ boardId });
});

function createBoardIfNotExists(boardId) {
  const id = boardId || Math.random().toString(36).slice(2, 10);
  if (!boards.has(id)) {
    boards.set(id, { ops: [], clients: new Set() });
  }
  return id;
}

// WebSocket 连接：ws://host:4000/ws?boardId=xxx
wss.on('connection', (ws, req) => {
  console.log('WS connection incoming:', req.url);
  const params = new URLSearchParams(req.url.replace(/^.*\?/, ''));
  const boardId = params.get('boardId') || createBoardIfNotExists();
  const board = createBoardIfNotExists(boardId) && boards.get(boardId);

  board.clients.add(ws);

  // 初始发送历史操作，让新加入的客户端重放
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

    // 只处理简单的绘图操作与撤销/重做
    if (msg.type === 'op') {
      board.ops.push(msg.payload);
      broadcast(board, {
        type: 'op',
        payload: msg.payload,
      });
    } else if (msg.type === 'reset') {
      board.ops = msg.ops || [];
      broadcast(board, {
        type: 'reset',
        ops: board.ops,
      });
    }
  });

  ws.on('close', () => {
    board.clients.delete(ws);
    if (board.clients.size === 0 && board.ops.length === 0) {
      boards.delete(boardId);
    }
  });

  ws.on('error', (err) => {
    console.error('WS error on board', boardId, err);
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
  console.log(`Whiteboard server listening on http://localhost:${PORT}`);
});


