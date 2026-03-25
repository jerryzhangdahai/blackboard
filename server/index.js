const express = require('express');
const http = require('http');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 4000;

const CONFIG = {
  MAX_BOARDS: parseInt(process.env.MAX_BOARDS) || 100,
  TTL: parseInt(process.env.TTL) || 24 * 60 * 60 * 1000,
  BASE_CLEANUP_INTERVAL: parseInt(process.env.CLEANUP_INTERVAL) || 5 * 60 * 1000,
  MIN_CLEANUP_INTERVAL: 1 * 60 * 1000,
  MAX_CLEANUP_INTERVAL: 30 * 60 * 1000,
  MAX_OPS_PER_BOARD: parseInt(process.env.MAX_OPS_PER_BOARD) || 50000,
  COMPRESSION_THRESHOLD: parseInt(process.env.COMPRESSION_THRESHOLD) || 40000,
  MAX_CLEANUP_PER_BATCH: parseInt(process.env.MAX_CLEANUP_PER_BATCH) || 10,
  WARN_THRESHOLD: parseFloat(process.env.WARN_THRESHOLD) || 0.8,
};

const boards = new Map();
const cleanupLog = [];
const MAX_LOG_SIZE = 1000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  const memUsage = process.memoryUsage();
  const heapUsed = memUsage.heapUsed;
  const heapTotal = memUsage.heapTotal;
  const usageRatio = heapUsed / heapTotal;
  
  res.json({
    ok: true,
    memory: {
      heapUsed: Math.round(heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(heapTotal / 1024 / 1024), // MB
      usageRatio: Math.round(usageRatio * 100) / 100,
      status: usageRatio > CONFIG.WARN_THRESHOLD ? 'warning' : 'ok',
    },
    boards: {
      count: boards.size,
      active: Array.from(boards.values()).filter(b => b.clients.size > 0).length,
    },
  });
});

app.get('/api/stats', (_req, res) => {
  const memUsage = process.memoryUsage();
  const totalOps = Array.from(boards.values())
    .reduce((sum, board) => sum + board.opCount, 0);
  
  const activeBoards = Array.from(boards.values())
    .filter(b => b.clients.size > 0);
  
  const estimatedMemory = Array.from(boards.values())
    .reduce((sum, board) => sum + estimateBoardMemory(board), 0);
  
  res.json({
    boards: {
      total: boards.size,
      active: activeBoards.length,
      inactive: boards.size - activeBoards.length,
    },
    operations: {
      total: totalOps,
      avgPerBoard: boards.size > 0 ? Math.round(totalOps / boards.size) : 0,
    },
    memory: {
      process: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024), // MB
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
      },
      estimated: {
        boards: Math.round(estimatedMemory / 1024 / 1024), // MB
      },
      usageRatio: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100) / 100,
    },
    config: {
      maxBoards: CONFIG.MAX_BOARDS,
      ttl: CONFIG.TTL,
      maxOpsPerBoard: CONFIG.MAX_OPS_PER_BOARD,
      nextCleanupInterval: cleanupTimer ? getCleanupInterval() : null,
    },
    cleanup: {
      logCount: cleanupLog.length,
      recentCleanups: cleanupLog.slice(-10),
    },
  });
});

app.get('/api/cleanup-logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json({
    logs: cleanupLog.slice(-limit),
    total: cleanupLog.length,
  });
});

app.post('/api/boards', (_req, res) => {
  const boardId = createBoardIfNotExists();
  res.json({ boardId });
});

const originalConfig = { ...CONFIG };
let configModified = false;

app.post('/api/config', (req, res) => {
  const { maxBoards, ttl, cleanupInterval } = req.body;
  
  if (maxBoards !== undefined) {
    CONFIG.MAX_BOARDS = parseInt(maxBoards);
    configModified = true;
  }
  if (ttl !== undefined) {
    CONFIG.TTL = parseInt(ttl);
    configModified = true;
    // TTL 更新后需要重新调度清理任务，确保使用新的 TTL
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
    }
    scheduleCleanup();
  }
  if (cleanupInterval !== undefined) {
    CONFIG.BASE_CLEANUP_INTERVAL = parseInt(cleanupInterval);
    configModified = true;
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
    }
    scheduleCleanup();
  }
  
  res.json({
    success: true,
    config: {
      MAX_BOARDS: CONFIG.MAX_BOARDS,
      TTL: CONFIG.TTL,
      BASE_CLEANUP_INTERVAL: CONFIG.BASE_CLEANUP_INTERVAL,
    },
    message: '配置已更新',
  });
});

app.post('/api/config/reset', (_req, res) => {
    if (configModified) {
      CONFIG.MAX_BOARDS = originalConfig.MAX_BOARDS;
      CONFIG.TTL = originalConfig.TTL;
      CONFIG.BASE_CLEANUP_INTERVAL = originalConfig.BASE_CLEANUP_INTERVAL;
      if (cleanupTimer) {
        clearTimeout(cleanupTimer);
      }
      scheduleCleanup();
    
    configModified = false;
    res.json({
      success: true,
      message: '配置已恢复为原始值',
      originalConfig: {
        MAX_BOARDS: originalConfig.MAX_BOARDS,
        TTL: originalConfig.TTL,
        BASE_CLEANUP_INTERVAL: originalConfig.BASE_CLEANUP_INTERVAL,
      },
    });
  } else {
    res.json({
      success: true,
      message: '配置未被修改，无需恢复',
    });
  }
});

// 获取当前配置
app.get('/api/config', (_req, res) => {
  res.json({
    current: {
      MAX_BOARDS: CONFIG.MAX_BOARDS,
      TTL: CONFIG.TTL,
      BASE_CLEANUP_INTERVAL: CONFIG.BASE_CLEANUP_INTERVAL,
    },
    original: {
      MAX_BOARDS: originalConfig.MAX_BOARDS,
      TTL: originalConfig.TTL,
      BASE_CLEANUP_INTERVAL: originalConfig.BASE_CLEANUP_INTERVAL,
    },
    modified: configModified,
  });
});

function touchBoard(boardId) {
  const board = boards.get(boardId);
  if (!board) return;
  
  board.lastActiveAt = new Date();
  boards.delete(boardId);
  boards.set(boardId, board);
}

function updateActivity(boardId) {
  const board = boards.get(boardId);
  if (!board) return;
  
  board.lastActiveAt = new Date();
  touchBoard(boardId);
}

function estimateBoardMemory(board) {
  const opsMemory = board.ops.length * 500;
  const clientsMemory = board.clients.size * 1024;
  const metadataMemory = 200;
  
  return opsMemory + clientsMemory + metadataMemory;
}

function getCleanupPriority(board) {
  let priority = 0;
  if (board.clients.size > 0) {
    return Infinity;
  }
  const inactiveTime = Date.now() - board.lastActiveAt.getTime();
  priority -= Math.floor(inactiveTime / (60 * 1000));
  priority += Math.min(board.opCount / 100, 100);
  
  return priority;
}

function shouldCleanup(board) {
  if (board.clients.size > 0) {
    return false;
  }
  const now = Date.now();
  
  // 如果有最后断开连接时间，使用它来判断
  if (board.lastClientDisconnectAt) {
    const disconnectedTime = now - board.lastClientDisconnectAt.getTime();
    if (process.env.NODE_ENV !== 'production' && disconnectedTime > CONFIG.TTL * 0.9) {
      // 接近TTL时输出调试信息
      console.log(`[清理检查] 白板断开时间: ${(disconnectedTime / 1000).toFixed(1)}秒, TTL: ${(CONFIG.TTL / 1000).toFixed(1)}秒, lastClientDisconnectAt: ${board.lastClientDisconnectAt.toISOString()}`);
    }
    if (disconnectedTime > CONFIG.TTL) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[清理检查] ✅ 白板应被清理: 断开时间 ${(disconnectedTime / 1000).toFixed(1)}秒 > TTL ${(CONFIG.TTL / 1000).toFixed(1)}秒`);
      }
      return true;
    }
  } else {
    // 如果没有断开连接时间，使用最后活动时间来判断（适用于从未有客户端连接或连接异常的情况）
    const inactiveTime = now - board.lastActiveAt.getTime();
    if (process.env.NODE_ENV !== 'production' && inactiveTime > CONFIG.TTL * 0.9) {
      // 接近TTL时输出调试信息
      console.log(`[清理检查] 白板非活动时间: ${(inactiveTime / 1000).toFixed(1)}秒, TTL: ${(CONFIG.TTL / 1000).toFixed(1)}秒, lastActiveAt: ${board.lastActiveAt.toISOString()}, lastClientDisconnectAt: ${board.lastClientDisconnectAt ? board.lastClientDisconnectAt.toISOString() : 'null'}`);
    }
    if (inactiveTime > CONFIG.TTL) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[清理检查] ✅ 白板应被清理: 非活动时间 ${(inactiveTime / 1000).toFixed(1)}秒 > TTL ${(CONFIG.TTL / 1000).toFixed(1)}秒`);
      }
      return true;
    }
  }
  
  return false;
}

function logCleanup(boardId, reason, stats) {
  const logEntry = {
    timestamp: new Date(),
    boardId,
    reason,
    stats: {
      opsCount: stats.opsCount,
      clientsCount: stats.clientsCount,
      memoryFreed: stats.memoryFreed,
    },
  };
  
  cleanupLog.push(logEntry);
  if (cleanupLog.length > MAX_LOG_SIZE) {
    cleanupLog.shift();
  }
  
  console.log(`[清理] ${reason} - 白板: ${boardId}, 操作数: ${stats.opsCount}, 释放内存: ${(stats.memoryFreed / 1024).toFixed(2)} KB`);
}

function cleanup() {
  const now = Date.now();
  let cleaned = 0;
  const candidates = [];
  
  // 调试信息：记录清理检查
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[清理检查] 开始检查 ${boards.size} 个白板，当前TTL: ${(CONFIG.TTL / 1000).toFixed(1)}秒，清理间隔: ${(getCleanupInterval() / 1000).toFixed(1)}秒`);
  }
  
  for (const [boardId, board] of boards) {
    if (shouldCleanup(board)) {
      candidates.push({
        boardId,
        board,
        priority: getCleanupPriority(board),
      });
    }
  }
  
  if (process.env.NODE_ENV !== 'production' && candidates.length > 0) {
    console.log(`[清理检查] 找到 ${candidates.length} 个需要清理的白板`);
  }
  
  candidates.sort((a, b) => a.priority - b.priority);
  
  for (let i = 0; i < Math.min(CONFIG.MAX_CLEANUP_PER_BATCH, candidates.length); i++) {
    const { boardId, board } = candidates[i];
    const memoryFreed = estimateBoardMemory(board);
    logCleanup(boardId, 'ttl_expired', {
      opsCount: board.opCount,
      clientsCount: board.clients.size,
      memoryFreed,
    });
    
    boards.delete(boardId);
    cleaned++;
  }
  
  while (boards.size > CONFIG.MAX_BOARDS) {
    const oldestId = boards.keys().next().value;
    const oldest = boards.get(oldestId);
    if (oldest.clients.size === 0) {
      const memoryFreed = estimateBoardMemory(oldest);
      logCleanup(oldestId, 'lru_eviction', {
        opsCount: oldest.opCount,
        clientsCount: oldest.clients.size,
        memoryFreed,
      });
      
      boards.delete(oldestId);
      cleaned++;
    } else {
      break;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[清理完成] 本次清理 ${cleaned} 个白板，剩余 ${boards.size} 个`);
  }
  
  if (candidates.length > CONFIG.MAX_CLEANUP_PER_BATCH) {
    setImmediate(() => cleanup());
  }
}

function getCleanupInterval() {
  const memUsage = process.memoryUsage();
  const heapUsed = memUsage.heapUsed;
  const heapTotal = memUsage.heapTotal;
  const usageRatio = heapUsed / heapTotal;
  
  let interval;
  if (usageRatio > 0.9) {
    interval = CONFIG.MIN_CLEANUP_INTERVAL;
  } else if (usageRatio > 0.75) {
    interval = CONFIG.BASE_CLEANUP_INTERVAL / 2;
  } else if (usageRatio > 0.5) {
    interval = CONFIG.BASE_CLEANUP_INTERVAL;
  } else {
    interval = CONFIG.MAX_CLEANUP_INTERVAL;
  }
  
  // 确保清理间隔不会超过 TTL，以便及时清理过期白板
  // 清理间隔应该 <= TTL，否则过期白板可能不会及时被清理
  // 这是硬性要求：清理机制必须至少每 TTL 时间运行一次
  return Math.min(interval, CONFIG.TTL);
}

let cleanupTimer = null;
function scheduleCleanup() {
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
  }
  
  cleanup();
  
  const interval = getCleanupInterval();
  cleanupTimer = setTimeout(scheduleCleanup, interval);
  
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[清理调度] 下次清理将在 ${(interval / 1000).toFixed(0)} 秒后执行`);
  }
}

function addOp(boardId, op) {
  const board = boards.get(boardId);
  if (!board) return;
  
  board.ops.push(op);
  board.opCount = board.ops.length;
  updateActivity(boardId);
  
  if (board.ops.length > CONFIG.COMPRESSION_THRESHOLD) {
    compressBoardOps(board);
  }
  
  if (board.ops.length > CONFIG.MAX_OPS_PER_BOARD) {
    const removed = board.ops.length - CONFIG.MAX_OPS_PER_BOARD;
    board.ops = board.ops.slice(-CONFIG.MAX_OPS_PER_BOARD);
    board.opCount = board.ops.length;
    console.log(`[白板大小限制] 白板 ${boardId} 超过上限，删除最旧的 ${removed} 个操作`);
  }
}

function compressBoardOps(board) {
  const recentOps = board.ops.slice(-10000);
  const removed = board.ops.length - recentOps.length;
  
  board.ops = recentOps;
  board.opCount = board.ops.length;
  board.compressed = true;
  
  console.log(`[操作压缩] 白板操作已压缩，删除 ${removed} 个旧操作`);
}

function createBoardIfNotExists(boardId) {
  const id = boardId || Math.random().toString(36).slice(2, 10);
  
  if (!boards.has(id)) {
    const now = new Date();
    boards.set(id, {
      ops: [],
      clients: new Set(),
      createdAt: now,
      lastActiveAt: now,
      lastClientDisconnectAt: null,
      opCount: 0,
      priority: 2,
      compressed: false,
    });
    
    if (boards.size > CONFIG.MAX_BOARDS) {
      setImmediate(() => cleanup());
    }
  }
  
  return id;
}

wss.on('connection', (ws, req) => {
  console.log('WS connection incoming:', req.url);
  const params = new URLSearchParams(req.url.replace(/^.*\?/, ''));
  let boardId = params.get('boardId');
  
  if (!boardId) {
    boardId = createBoardIfNotExists();
  } else {
    boardId = createBoardIfNotExists(boardId);
  }
  
  const board = boards.get(boardId);
  if (!board) {
    ws.send(JSON.stringify({
      type: 'board_not_found',
      boardId,
      message: '白板创建失败',
      suggestion: '请重试或使用其他白板 ID',
    }));
    ws.close();
    return;
  }

  updateActivity(boardId);
  
  // 当有新的客户端连接时，如果之前所有客户端都断开了，清空 lastClientDisconnectAt
  // 因为白板又活跃了
  if (board.clients.size === 0 && board.lastClientDisconnectAt) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[连接] 白板 ${boardId} 有新客户端连接，清空 lastClientDisconnectAt`);
    }
    board.lastClientDisconnectAt = null;
  }
  
  board.clients.add(ws);

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

    updateActivity(boardId);

    if (msg.type === 'op') {
      addOp(boardId, msg.payload);
      broadcast(board, {
        type: 'op',
        payload: msg.payload,
      });
    } else if (msg.type === 'reset') {
      board.ops = msg.ops || [];
      board.opCount = board.ops.length;
      updateActivity(boardId);
      broadcast(board, {
        type: 'reset',
        ops: board.ops,
      });
    }
  });

  ws.on('close', () => {
    board.clients.delete(ws);
    
    if (board.clients.size === 0) {
      board.lastClientDisconnectAt = new Date();
      // 断开连接时不应该更新 lastActiveAt，因为断开不是活动
      // 但需要确保 lastActiveAt 存在，用于 fallback 判断
      if (!board.lastActiveAt) {
        board.lastActiveAt = new Date();
      }
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[连接关闭] 白板 ${boardId} 所有客户端已断开，设置 lastClientDisconnectAt: ${board.lastClientDisconnectAt.toISOString()}`);
      }
      if (board.ops.length === 0) {
        boards.delete(boardId);
        console.log(`[清理] 删除空白板: ${boardId}`);
      }
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
  console.log(`[配置] 最大白板数: ${CONFIG.MAX_BOARDS}`);
  console.log(`[配置] TTL: ${CONFIG.TTL / 1000 / 60} 分钟`);
  console.log(`[配置] 单个白板最大操作数: ${CONFIG.MAX_OPS_PER_BOARD}`);
  console.log(`[配置] 清理间隔: ${CONFIG.BASE_CLEANUP_INTERVAL / 1000} 秒（动态调整）`);
  scheduleCleanup();
  console.log('[清理任务] 已启动，将根据内存使用率动态调整清理频率');
});


