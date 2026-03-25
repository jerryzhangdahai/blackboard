const express = require('express');
const http = require('http');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 4000;

// ===== 配置 =====
const CONFIG = {
  MAX_BOARDS: parseInt(process.env.MAX_BOARDS) || 100,                    // 最大白板数量
  TTL: parseInt(process.env.TTL) || 24 * 60 * 60 * 1000,                 // 过期时间（24 小时）
  BASE_CLEANUP_INTERVAL: parseInt(process.env.CLEANUP_INTERVAL) || 5 * 60 * 1000,  // 基础清理间隔（5 分钟）
  MIN_CLEANUP_INTERVAL: 1 * 60 * 1000,                                   // 最小清理间隔（1 分钟）
  MAX_CLEANUP_INTERVAL: 30 * 60 * 1000,                                  // 最大清理间隔（30 分钟）
  MAX_OPS_PER_BOARD: parseInt(process.env.MAX_OPS_PER_BOARD) || 50000,  // 单个白板最大操作数
  COMPRESSION_THRESHOLD: parseInt(process.env.COMPRESSION_THRESHOLD) || 40000,  // 压缩阈值
  MAX_CLEANUP_PER_BATCH: parseInt(process.env.MAX_CLEANUP_PER_BATCH) || 10,     // 每次清理最多 N 个
  WARN_THRESHOLD: parseFloat(process.env.WARN_THRESHOLD) || 0.8,         // 内存警告阈值（80%）
};

// ===== 白板数据结构 =====
// 扩展后的数据结构：
// {
//   snapshot: object | null,
//   clients: Set<WebSocket>,
//   createdAt: Date,
//   lastActiveAt: Date,
//   lastClientDisconnectAt: Date | null,
//   snapshotBytes: number,
//   priority: number,
//   compressed: boolean,
// }
const boards = new Map();

// ===== 清理日志 =====
const cleanupLog = [];
const MAX_LOG_SIZE = 1000;

// ===== 清理防抖 =====
let cleanupScheduled = false; // 标记是否已调度清理任务
let pendingCleanupTimer = null; // 防抖定时器

app.use(cors());
app.use(express.json());

// ===== API 接口 =====

// 健康检查（增强版，包含内存状态）
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

// 内存统计接口
app.get('/api/stats', (_req, res) => {
  const memUsage = process.memoryUsage();
  const totalSnapshotBytes = Array.from(boards.values())
    .reduce((sum, board) => sum + (board.snapshotBytes || 0), 0);
  
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
      total: totalSnapshotBytes, // bytes
      avgPerBoard: boards.size > 0 ? Math.round(totalSnapshotBytes / boards.size) : 0,
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

// 清理日志接口
app.get('/api/cleanup-logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json({
    logs: cleanupLog.slice(-limit),
    total: cleanupLog.length,
  });
});

// 创建新白板，返回 boardId（可以由前端生成，这里提供备用接口）
app.post('/api/boards', (_req, res) => {
  const boardId = createBoardIfNotExists();
  res.json({ boardId });
});

// 清空所有白板（测试用接口）
app.delete('/api/boards', (_req, res) => {
  const clearedCount = boards.size;
  const totalMemory = Array.from(boards.values())
    .reduce((sum, board) => sum + estimateBoardMemory(board), 0);
  
  // 记录每个被清理的白板（用于日志）
  const clearedBoards = [];
  for (const [boardId, board] of boards) {
    clearedBoards.push({
      boardId,
      snapshotBytes: board.snapshotBytes || 0,
      clientsCount: board.clients.size,
    });
  }
  
  // 关闭所有 WebSocket 连接
  for (const [boardId, board] of boards) {
    board.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
  }
  
  // 清空所有白板
  boards.clear();
  cleanupLog.length = 0; // 清空清理日志
  
  // 输出清理日志
  if (clearedCount > 0) {
    console.log(`[API清理] 通过 DELETE /api/boards 清空所有白板`);
    console.log(`[API清理] 已清空 ${clearedCount} 个白板，释放约 ${(totalMemory / 1024 / 1024).toFixed(2)} MB 内存`);
    
    // 如果白板数量较少（<= 20），显示每个白板的详细信息
    if (clearedBoards.length <= 20) {
      clearedBoards.forEach(({ boardId, snapshotBytes, clientsCount }) => {
        const snapshotKB = Math.round(snapshotBytes / 1024);
        console.log(`[API清理]   - 白板: ${boardId}, snapshot: ${snapshotKB}KB, 客户端: ${clientsCount}`);
      });
    } else {
      // 如果白板数量较多，只显示统计信息
      const totalSnapshotBytes = clearedBoards.reduce((sum, b) => sum + b.snapshotBytes, 0);
      const avgSnapshotKB = Math.round(totalSnapshotBytes / clearedBoards.length / 1024);
      console.log(`[API清理]   - 平均每个白板 snapshot 大小: ${avgSnapshotKB}KB`);
    }
  } else {
    console.log(`[API清理] 通过 DELETE /api/boards 清空所有白板（当前没有白板需要清理）`);
  }
  
  res.json({
    success: true,
    clearedCount,
    memoryFreed: Math.round(totalMemory / 1024 / 1024), // MB
    message: `已清空 ${clearedCount} 个白板，释放约 ${Math.round(totalMemory / 1024 / 1024)}MB 内存`,
  });
});

// ===== 工具函数 =====

/**
 * 更新白板活动时间（LRU touch）
 */
function touchBoard(boardId) {
  const board = boards.get(boardId);
  if (!board) return;
  
  board.lastActiveAt = new Date();
  
  // LRU: 先删除再重新插入（移到末尾，表示最近使用）
  boards.delete(boardId);
  boards.set(boardId, board);
}

/**
 * 更新白板活动时间
 */
function updateActivity(boardId) {
  const board = boards.get(boardId);
  if (!board) return;
  
  board.lastActiveAt = new Date();
  touchBoard(boardId); // LRU touch
}

/**
 * 估算白板内存占用（字节）
 */
function estimateBoardMemory(board) {
  // 粗略估算：snapshot 体积（字节）
  const snapshotMemory = board.snapshotBytes || 0;
  
  // WebSocket 连接内存（每个连接约 1KB）
  const clientsMemory = board.clients.size * 1024;
  
  // 元数据内存（约 200 字节）
  const metadataMemory = 200;
  
  return snapshotMemory + clientsMemory + metadataMemory;
}

/**
 * 获取清理优先级（返回值越小，越容易被清理）
 */
function getCleanupPriority(board) {
  let priority = 0;
  
  // 有客户端连接的白板优先级最高（不清理）
  if (board.clients.size > 0) {
    return Infinity;
  }
  
  // 根据最后活动时间调整（越旧优先级越低）
  const inactiveTime = Date.now() - board.lastActiveAt.getTime();
  priority -= Math.floor(inactiveTime / (60 * 1000)); // 每分钟减 1
  
  // 根据 snapshot 体积调整（越大越不容易被清理，但影响较小）
  priority += Math.min((board.snapshotBytes || 0) / (1024 * 50), 100); // 每 50KB +1，上限 100
  
  return priority;
}

/**
 * 判断白板是否应该被清理
 */
function shouldCleanup(board) {
  // 有客户端连接的白板不清理
  if (board.clients.size > 0) {
    return false;
  }
  
  const now = Date.now();
  
  // TTL 检查：无客户端且超过 TTL
  if (board.lastClientDisconnectAt) {
    const disconnectedTime = now - board.lastClientDisconnectAt.getTime();
    if (disconnectedTime > CONFIG.TTL) {
      return true;
    }
  }
  
  return false;
}

/**
 * 记录清理日志
 */
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
  
  // 只保留最近 N 条日志
  if (cleanupLog.length > MAX_LOG_SIZE) {
    cleanupLog.shift();
  }
  
  console.log(`[清理] ${reason} - 白板: ${boardId}, 操作数: ${stats.opsCount}, 释放内存: ${(stats.memoryFreed / 1024).toFixed(2)} KB`);
}

/**
 * 清理任务（渐进式清理）
 */
function cleanup() {
  const now = Date.now();
  let cleaned = 0;
  const candidates = [];
  
  // 1. 收集候选清理白板（不立即删除）
  for (const [boardId, board] of boards) {
    if (shouldCleanup(board)) {
      candidates.push({
        boardId,
        board,
        priority: getCleanupPriority(board),
      });
    }
  }
  
  // 2. 按优先级排序（最旧、无客户端、操作少的优先）
  candidates.sort((a, b) => a.priority - b.priority);
  
  // 3. 分批清理（每次最多清理 N 个）
  for (let i = 0; i < Math.min(CONFIG.MAX_CLEANUP_PER_BATCH, candidates.length); i++) {
    const { boardId, board } = candidates[i];
    
    // 记录清理日志
    const memoryFreed = estimateBoardMemory(board);
    logCleanup(boardId, 'ttl_expired', {
      opsCount: Math.round((board.snapshotBytes || 0) / 1024), // 复用字段：这里记录 KB
      clientsCount: board.clients.size,
      memoryFreed,
    });
    
    boards.delete(boardId);
    cleaned++;
  }
  
  // 4. LRU 清理：如果仍然超过上限，删除最不活跃的白板
  // 按照 lastActiveAt 排序，删除最久未使用的白板
  if (boards.size > CONFIG.MAX_BOARDS) {
    // 收集所有无客户端的白板，按 lastActiveAt 排序
    const inactiveBoards = [];
    for (const [boardId, board] of boards) {
      if (board.clients.size === 0) {
        inactiveBoards.push({
          boardId,
          board,
          lastActiveAt: board.lastActiveAt.getTime(),
        });
      }
    }
    
    // 按 lastActiveAt 排序（最旧的在前面）
    inactiveBoards.sort((a, b) => a.lastActiveAt - b.lastActiveAt);
    
    // 删除最不活跃的白板，直到数量降到 MAX_BOARDS 以下
    // 注意：这里应该尽可能多地清理，而不是只清理 1 个
    // 但是为了避免一次性清理太多导致阻塞，我们限制每次最多清理 MAX_CLEANUP_PER_BATCH 个
    let toDelete = boards.size - CONFIG.MAX_BOARDS;
    const maxDeleteInThisBatch = Math.min(toDelete, inactiveBoards.length, CONFIG.MAX_CLEANUP_PER_BATCH);
    
    for (let i = 0; i < maxDeleteInThisBatch; i++) {
      const { boardId, board } = inactiveBoards[i];
      const memoryFreed = estimateBoardMemory(board);
      logCleanup(boardId, 'lru_eviction', {
        opsCount: Math.round((board.snapshotBytes || 0) / 1024),
        clientsCount: board.clients.size,
        memoryFreed,
      });
      
      boards.delete(boardId);
      cleaned++;
    }
    
    // 如果删除无客户端的白板后仍然超过上限，说明有客户端连接的白板太多
    // 这种情况下，我们只能等待客户端断开连接
    if (boards.size > CONFIG.MAX_BOARDS) {
      const activeCount = Array.from(boards.values()).filter(b => b.clients.size > 0).length;
      console.log(`[清理警告] 仍有 ${boards.size} 个白板（超过上限 ${CONFIG.MAX_BOARDS}），其中 ${activeCount} 个有客户端连接，无法清理`);
    }
  }
  
  if (cleaned > 0) {
    console.log(`[清理完成] 本次清理 ${cleaned} 个白板，剩余 ${boards.size} 个`);
  }
  
  // 5. 如果还有候选，延迟执行下一批（渐进式清理）
  if (candidates.length > CONFIG.MAX_CLEANUP_PER_BATCH) {
    setImmediate(() => cleanup());
  }
  
  // 6. 如果 LRU 清理后仍然超过上限，继续清理（渐进式 LRU 清理）
  if (boards.size > CONFIG.MAX_BOARDS) {
    // 再次收集无客户端的白板
    const remainingInactiveBoards = [];
    for (const [boardId, board] of boards) {
      if (board.clients.size === 0) {
        remainingInactiveBoards.push({
          boardId,
          board,
          lastActiveAt: board.lastActiveAt.getTime(),
        });
      }
    }
    
    // 如果还有无客户端的白板，继续清理
    if (remainingInactiveBoards.length > 0) {
      remainingInactiveBoards.sort((a, b) => a.lastActiveAt - b.lastActiveAt);
      const toDelete = Math.min(boards.size - CONFIG.MAX_BOARDS, remainingInactiveBoards.length, CONFIG.MAX_CLEANUP_PER_BATCH);
      
      if (toDelete > 0) {
        // 延迟执行下一批 LRU 清理，避免阻塞
        setImmediate(() => cleanup());
      }
    }
  }
}

/**
 * 获取智能清理间隔（根据内存使用率和TTL动态调整）
 */
function getCleanupInterval() {
  const memUsage = process.memoryUsage();
  const heapUsed = memUsage.heapUsed;
  const heapTotal = memUsage.heapTotal;
  const usageRatio = heapUsed / heapTotal;
  
  // 如果 TTL 很短（< 5分钟），清理间隔应该更短，确保能及时清理过期白板
  // 清理间隔应该 <= TTL，这样过期白板能被及时清理
  const ttlSeconds = CONFIG.TTL / 1000;
  let baseInterval;
  
  // 内存使用率越高，清理间隔越短
  if (usageRatio > 0.9) {
    baseInterval = CONFIG.MIN_CLEANUP_INTERVAL; // 紧急：1 分钟
  } else if (usageRatio > 0.75) {
    baseInterval = CONFIG.BASE_CLEANUP_INTERVAL / 2; // 2.5 分钟
  } else if (usageRatio > 0.5) {
    baseInterval = CONFIG.BASE_CLEANUP_INTERVAL; // 5 分钟
  } else {
    baseInterval = CONFIG.MAX_CLEANUP_INTERVAL; // 30 分钟
  }
  
  // 如果 TTL 很短，确保清理间隔不超过 TTL 的一半
  // 这样过期白板能在 TTL 过期后很快被清理
  if (ttlSeconds < 5 * 60) { // TTL < 5 分钟
    const maxIntervalForShortTTL = Math.max(CONFIG.TTL / 2, 1000); // 至少 1 秒
    return Math.min(baseInterval, maxIntervalForShortTTL);
  }
  
  return baseInterval;
}

/**
 * 调度清理任务（智能频率调整）
 */
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

/**
 * 创建新白板
 */
function createBoardIfNotExists(boardId) {
  const id = boardId || Math.random().toString(36).slice(2, 10);
  
  if (!boards.has(id)) {
    const now = new Date();
    boards.set(id, {
      snapshot: null,
      snapshotBytes: 0,
      clients: new Set(),
      createdAt: now,
      lastActiveAt: now,
      lastClientDisconnectAt: null,
      priority: 2, // 默认中等优先级
      compressed: false,
    });
    
    // 如果超过上限，触发清理
    if (boards.size > CONFIG.MAX_BOARDS) {
      setImmediate(() => cleanup());
    }
  }
  
  return id;
}

// ===== WebSocket 连接处理 =====
wss.on('connection', (ws, req) => {
  console.log('WS connection incoming:', req.url);
  const params = new URLSearchParams(req.url.replace(/^.*\?/, ''));
  let boardId = params.get('boardId');
  
  // 如果没有提供 boardId，创建新白板
  if (!boardId) {
    boardId = createBoardIfNotExists();
  } else {
    // 如果提供了 boardId，先尝试创建（如果不存在）
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

  // 更新活动时间
  updateActivity(boardId);
  
  // 如果有客户端连接，清除断开时间标记
  if (board.clients.size === 0 && board.lastClientDisconnectAt) {
    board.lastClientDisconnectAt = null;
  }
  
  board.clients.add(ws);

  // 初始发送 snapshot，让新加入的客户端还原画面
  const initMsg = {
    type: 'init',
    boardId,
    snapshot: board.snapshot,
  };
  ws.send(JSON.stringify(initMsg));

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    // 更新活动时间
    updateActivity(boardId);

    // tldraw：优先走增量 diff，同步 document 变更；snapshot 仅用于初始化/兜底
    if (msg.type === 'snapshot') {
      const snapshot = msg.snapshot ?? null;
      const clientId = msg.clientId ?? null;
      board.snapshot = snapshot;
      board.snapshotBytes = snapshot ? Buffer.byteLength(JSON.stringify(snapshot), 'utf8') : 0;
      updateActivity(boardId);
      broadcast(board, {
        type: 'snapshot',
        snapshot: board.snapshot,
        clientId,
      }, ws);
    } else if (msg.type === 'diff') {
      // 服务器不理解 diff 的语义，只负责转发给其他客户端
      const clientId = msg.clientId ?? null;
      const diff = msg.diff ?? null;
      if (!diff) {
        return;
      }
      updateActivity(boardId);
      broadcast(board, { type: 'diff', diff, clientId }, ws);
    }
  });

  ws.on('close', () => {
    board.clients.delete(ws);
    
    // 更新活动时间
    updateActivity(boardId);
    
    // 如果所有客户端都断开，记录断开时间
    if (board.clients.size === 0) {
      board.lastClientDisconnectAt = new Date();
      
      // 如果白板为空，立即删除（旧逻辑保留）
      if (!board.snapshot || (board.snapshotBytes || 0) === 0) {
        boards.delete(boardId);
        console.log(`[清理] 删除空白板: ${boardId}`);
        return; // 空白板已删除，不需要触发清理
      }
      
      // 如果超过上限，触发 LRU 清理（使用防抖，避免频繁触发）
      if (boards.size > CONFIG.MAX_BOARDS) {
        // 如果已经有清理任务在调度，不重复触发
        if (!cleanupScheduled) {
          cleanupScheduled = true;
          // 使用 setImmediate 立即触发，但标记已调度，避免重复
          setImmediate(() => {
            cleanupScheduled = false;
            cleanup();
          });
        }
      }
      
      // 如果 TTL 很短（< 5分钟），在客户端断开时也触发一次清理检查
      // 这样可以更快地清理过期的白板
      const ttlSeconds = CONFIG.TTL / 1000;
      if (ttlSeconds < 5 * 60) {
        // 延迟触发清理，给其他可能同时断开的连接一些时间
        // 避免频繁触发清理
        if (!cleanupScheduled) {
          cleanupScheduled = true;
          setTimeout(() => {
            cleanupScheduled = false;
            cleanup();
          }, 2000); // 延迟 2 秒，批量处理
        }
      }
    }
  });

  ws.on('error', (err) => {
    console.error('WS error on board', boardId, err);
  });
});

function broadcast(board, msg, excludeClient) {
  const data = JSON.stringify(msg);
  board.clients.forEach((client) => {
    if (excludeClient && client === excludeClient) return;
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// ===== 启动服务器 =====
server.listen(PORT, () => {
  console.log(`Whiteboard server listening on http://localhost:${PORT}`);
  console.log(`[配置] 最大白板数: ${CONFIG.MAX_BOARDS}`);
  console.log(`[配置] TTL: ${CONFIG.TTL / 1000 / 60} 分钟`);
  console.log(`[配置] 单个白板最大操作数: ${CONFIG.MAX_OPS_PER_BOARD}`);
  console.log(`[配置] 清理间隔: ${CONFIG.BASE_CLEANUP_INTERVAL / 1000} 秒（动态调整）`);
  
  // 启动清理任务
  scheduleCleanup();
  console.log('[清理任务] 已启动，将根据内存使用率动态调整清理频率');
});


