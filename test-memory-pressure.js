/**
 * 服务端生命周期管理测试脚本（Node.js）
 * 
 * 测试目标：验证原生 tldraw 协同白板的服务端生命周期管理机制
 * - 白板创建和销毁
 * - TTL 过期清理
 * - LRU 淘汰机制
 * - 内存使用和清理
 * 
 * 使用方法:
 *   node test-memory-pressure.js              # 运行所有测试
 *   node test-memory-pressure.js basic        # 只运行基础内存测试
 *   node test-memory-pressure.js cleanup      # 只运行清理机制测试
 *   node test-memory-pressure.js stress       # 只运行压力测试（超过最大白板数）
 *   node test-memory-pressure.js complex      # 只运行复杂场景测试（模拟真实使用场景）
 *   node test-memory-pressure.js health       # 只运行健康检查
 *   node test-memory-pressure.js visual       # 可视化测试（创建测试白板并打开浏览器）
 * 
 * 注意：
 *   - 此脚本必须在 Node.js 环境中运行，不能在浏览器中运行
 *   - 此脚本针对原生 tldraw 开发的协同白板进行测试
 * 
 * 其他测试脚本：
 * - test-incremental-drawing.js: tldraw 协同性能测试（浏览器控制台）
 * - test-hittest-performance.js: tldraw hitTest 性能测试（浏览器控制台）
 */

// 检查运行环境
if (typeof require === 'undefined') {
  console.error('❌ 错误：此脚本必须在 Node.js 环境中运行！');
  console.error('请在终端中运行: node test-memory-pressure.js');
  console.error('不能在浏览器控制台中运行此脚本。');
  if (typeof process !== 'undefined' && process.exit) {
    process.exit(1);
  }
  throw new Error('此脚本必须在 Node.js 环境中运行');
}

const http = require('http');
const WebSocket = require('ws');

const BASE_URL = 'http://localhost:4000';
const WS_URL = 'ws://localhost:4000/ws';

// 测试配置
const TEST_CONFIG = {
  // 基础测试：创建少量白板，测试基本功能
  BASIC_BOARDS: 10,
  BASIC_OPS_PER_BOARD: 100,
  
  // 压力测试：创建大量白板，超过服务端限制，测试 LRU 清理机制
  // 服务端默认 MAX_BOARDS = 100，这里设置为 300 以充分测试清理机制
  STRESS_BOARDS: 300,
  STRESS_OPS_PER_BOARD: 1000,
  
  // 清理测试：创建中等数量白板，测试 TTL 清理机制
  CLEANUP_BOARDS: 50,
  CLEANUP_OPS_PER_BOARD: 500,
  
  // 复杂场景测试：模拟真实使用场景
  COMPLEX_SCENARIOS: {
    boardSizes: [
      { count: 20, shapesPerBoard: 50 },
      { count: 30, shapesPerBoard: 200 },
      { count: 15, shapesPerBoard: 500 },
      { count: 5, shapesPerBoard: 2000 },
    ],
    concurrentConnections: 10,
    operationInterval: [50, 200],
    sessionDurations: [5000, 30000, 60000],
  },
  
  // 请求超时
  REQUEST_TIMEOUT: 30000,
};

// ===== 工具函数 =====

/**
 * 清空服务端所有白板（用于测试前清理）
 */
async function clearAllBoards() {
  try {
    const clearResult = await request(`${BASE_URL}/api/boards`, {
      method: 'DELETE',
    });
    if (clearResult.clearedCount > 0) {
      console.log(`   ✅ 已清空 ${clearResult.clearedCount} 个白板`);
    }
    // 等待清空操作完成
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (error) {
    // 忽略错误（可能服务端没有白板需要清空）
  }
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };
    
    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(TEST_CONFIG.REQUEST_TIMEOUT, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

function randomBoardId() {
  return Math.random().toString(36).slice(2, 10);
}

// 生成唯一的 shape ID
function generateShapeId() {
  return 'shape:' + Math.random().toString(36).slice(2, 15);
}

// 创建 tldraw 原生格式的 shape
function createRandomShape() {
  const types = ['geo', 'draw', 'arrow'];
  const type = types[Math.floor(Math.random() * types.length)];
  
  const id = generateShapeId();
  const baseShape = {
    id,
    typeName: 'shape',
    x: 0,
    y: 0,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    meta: {},
  };
  
  const colors = ['black', 'grey', 'blue', 'green', 'red', 'yellow', 'orange'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const sizes = ['s', 'm', 'l', 'xl'];
  const size = sizes[Math.floor(Math.random() * sizes.length)];
  
  switch(type) {
    case 'geo':
      const geoTypes = ['rectangle', 'ellipse'];
      const geoType = geoTypes[Math.floor(Math.random() * geoTypes.length)];
      const x = Math.random() * 800;
      const y = Math.random() * 600;
      const w = 50 + Math.random() * 200;
      const h = 50 + Math.random() * 200;
      
      return {
        ...baseShape,
        type: 'geo',
        x,
        y,
        rotation: Math.random() * Math.PI * 2, // 随机旋转
        props: {
          w,
          h,
          geo: geoType,
          color,
          size,
          dash: Math.random() > 0.7 ? 'dashed' : 'draw', // 30%概率使用虚线
          fill: Math.random() > 0.8 ? (Math.random() > 0.5 ? 'solid' : 'semi') : 'none', // 20%概率填充（solid 或 semi）
        },
      };
    
    case 'draw':
      // 创建手绘线条（stroke），使用更多随机点形成自然曲线
      const numPoints = 5 + Math.floor(Math.random() * 20); // 5-25个点
      const points = [];
      let currentX = Math.random() * 800;
      let currentY = Math.random() * 600;
      
      for (let i = 0; i < numPoints; i++) {
        // 每个点基于前一个点，形成连续路径
        currentX += (Math.random() - 0.5) * 80;
        currentY += (Math.random() - 0.5) * 80;
        points.push({
          x: currentX,
          y: currentY,
          z: 0.3 + Math.random() * 0.4, // 随机压力值
        });
      }
      
      return {
        ...baseShape,
        type: 'draw',
        x: 0,
        y: 0,
        props: {
          color,
          size,
          dash: Math.random() > 0.9 ? 'dashed' : 'draw', // 10%概率使用虚线
          segments: [{
            type: 'free',
            points,
          }],
        },
      };
    
    case 'arrow':
      const startX = Math.random() * 800;
      const startY = Math.random() * 600;
      // 随机角度和长度
      const angle = Math.random() * Math.PI * 2;
      const length = 50 + Math.random() * 300;
      const endX = startX + Math.cos(angle) * length;
      const endY = startY + Math.sin(angle) * length;
      
      return {
        ...baseShape,
        type: 'arrow',
        x: startX,
        y: startY,
        rotation: Math.random() * Math.PI * 2, // 随机旋转
        props: {
          color,
          size,
          dash: Math.random() > 0.8 ? 'dashed' : 'draw', // 20%概率使用虚线
          arrowheadStart: Math.random() > 0.7 ? 'arrow' : 'none', // 30%概率起点也有箭头
          arrowheadEnd: Math.random() > 0.1 ? 'arrow' : 'none', // 90%概率终点有箭头
          start: { x: startX, y: startY },
          end: { x: endX, y: endY },
          bend: (Math.random() - 0.5) * 100, // 随机弯曲
        },
      };
    
    default:
      // 默认返回 geo rectangle
      return {
        ...baseShape,
        type: 'geo',
        x: Math.random() * 800,
        y: Math.random() * 600,
        props: {
          w: 100,
          h: 100,
          geo: 'rectangle',
          color: 'black',
          size: 'm',
          dash: 'draw',
          fill: 'none',
        },
      };
  }
}

// ===== 测试用例 =====

async function testBasicMemoryUsage() {
  console.log('\n📊 测试 1: 白板创建和销毁');
  console.log('========================================');
  console.log('测试目标：验证白板创建和基本内存使用情况');
  console.log(`将创建 ${TEST_CONFIG.BASIC_BOARDS} 个白板，每个白板包含 ${TEST_CONFIG.BASIC_OPS_PER_BOARD} 个图形`);
  console.log(`总计约 ${TEST_CONFIG.BASIC_BOARDS * TEST_CONFIG.BASIC_OPS_PER_BOARD} 个图形`);
  console.log('========================================');
  
  // 测试前清空所有白板
  console.log('🧹 清空服务端所有白板...');
  await clearAllBoards();
  console.log('');
  
  // 内存测量：等待GC稳定后再测量（借鉴 test-hittest-performance.js 的采样逻辑）
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // 多次采样内存值，取平均值（减少GC波动影响）
  let memorySamplesBefore = [];
  for (let i = 0; i < 3; i++) {
    const stats = await request(`${BASE_URL}/api/stats`);
    memorySamplesBefore.push(stats.memory.process.heapUsed);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const memoryBefore = memorySamplesBefore.reduce((a, b) => a + b, 0) / memorySamplesBefore.length;
  const statsBefore = await request(`${BASE_URL}/api/stats`);
  
  // 记录创建操作的开始时间（只计算实际创建时间，不包含等待时间）
  const createStartTime = Date.now();
  
  // 创建白板并添加操作
  const boards = [];
  
  process.stdout.write(`正在创建 ${TEST_CONFIG.BASIC_BOARDS} 个白板...`);
  
  for (let i = 0; i < TEST_CONFIG.BASIC_BOARDS; i++) {
    const boardId = randomBoardId();
    
    // 连接 WebSocket
    const ws = new WebSocket(`${WS_URL}?boardId=${boardId}`);
    
    await new Promise((resolve) => {
      ws.on('open', async () => {
        // 收集所有图形，然后发送 snapshot（服务端只处理 snapshot 和 diff 消息）
        const shapes = [];
        for (let j = 0; j < TEST_CONFIG.BASIC_OPS_PER_BOARD; j++) {
          const shape = createRandomShape();
          shapes.push(shape);
        }
        
        // 发送 snapshot 消息（服务端会保存 snapshot 和 snapshotBytes）
        const snapshot = {
          shapes: shapes.reduce((acc, shape) => {
            acc[shape.id] = shape;
            return acc;
          }, {}),
        };
        
        ws.send(JSON.stringify({ 
          type: 'snapshot', 
          snapshot: snapshot,
          clientId: 'test-client'
        }));
        
        // 等待服务端处理 snapshot 消息（服务端需要时间保存 snapshot 和 snapshotBytes）
        // 如果立即关闭连接，服务端可能还没保存 snapshot，导致白板被删除
        setTimeout(() => {
          ws.close();
          resolve();
        }, 1000); // 增加到 1000ms，确保服务端有时间处理 snapshot
      });
    });
    
    boards.push(boardId);
  }
  
  // 记录创建操作的结束时间（在等待之前，只计算实际创建时间）
  const createEndTime = Date.now();
  const createDuration = createEndTime - createStartTime;
  process.stdout.write(' 完成\n');
  
  // 等待服务端处理 snapshot 和连接关闭（这部分时间不计入性能测试）
  // 需要等待足够长的时间，确保：
  // 1. 所有 snapshot 消息都被服务端处理
  // 2. 所有连接关闭事件都被服务端处理
  // 3. 服务端有时间保存 snapshot 和 snapshotBytes
  // 4. 服务端有时间处理清理逻辑（如果有的话）
  console.log('  等待服务端处理完成...');
  await new Promise(resolve => setTimeout(resolve, 3000)); // 增加到 3 秒
  
  // 多次采样内存值，取平均值（减少GC波动影响）
  let memorySamplesAfter = [];
  for (let i = 0; i < 3; i++) {
    const stats = await request(`${BASE_URL}/api/stats`);
    memorySamplesAfter.push(stats.memory.process.heapUsed);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const memoryAfter = memorySamplesAfter.reduce((a, b) => a + b, 0) / memorySamplesAfter.length;
  const statsAfter = await request(`${BASE_URL}/api/stats`);
  
  // 计算差值
  const boardsDelta = statsAfter.boards.total - statsBefore.boards.total;
  const snapshotBytesDelta = statsAfter.operations.total - statsBefore.operations.total;
  const memoryDelta = memoryAfter - memoryBefore;
  
  // 计算预期的图形数量（用于显示）
  const expectedShapesCount = TEST_CONFIG.BASIC_BOARDS * TEST_CONFIG.BASIC_OPS_PER_BOARD;
  
  console.log('结果:');
  console.log(`  创建耗时: ${createDuration}ms（不包含等待时间）`);
  console.log(`  新增白板: ${boardsDelta}（预期 ${TEST_CONFIG.BASIC_BOARDS}）`);
  if (boardsDelta === TEST_CONFIG.BASIC_BOARDS) {
    console.log(`  ✅ 白板创建成功：实际创建 ${boardsDelta} 个白板`);
  } else {
    console.log(`  ⚠️ 白板创建可能不完整：实际创建 ${boardsDelta} 个，预期 ${TEST_CONFIG.BASIC_BOARDS} 个`);
    console.log(`  ⚠️ 可能原因：白板创建后立即关闭连接，服务端可能还没保存 snapshot`);
  }
  console.log(`  新增 snapshot 数据: ${(snapshotBytesDelta / 1024).toFixed(2)}KB（预期约 ${expectedShapesCount} 个图形）`);
  console.log(`  内存增长: ${memoryDelta.toFixed(2)}MB（多次采样平均值）`);
  if (boardsDelta > 0) {
    console.log(`  每个白板平均内存: ${(memoryDelta / boardsDelta).toFixed(2)}MB`);
    console.log(`  每个白板平均 snapshot 大小: ${(snapshotBytesDelta / boardsDelta / 1024).toFixed(2)}KB`);
  }
  
  return {
    boardsDelta,
    snapshotBytesDelta,
    memoryDelta,
    createDuration,
  };
}

async function testCleanupMechanism() {
  console.log('\n🧹 测试 2: TTL 过期清理');
  console.log('========================================');
  console.log('测试目标：验证无活动白板的 TTL 过期清理机制');
  console.log(`将创建 ${TEST_CONFIG.CLEANUP_BOARDS} 个白板，每个白板包含 ${TEST_CONFIG.CLEANUP_OPS_PER_BOARD} 个图形`);
  console.log(`总计约 ${TEST_CONFIG.CLEANUP_BOARDS * TEST_CONFIG.CLEANUP_OPS_PER_BOARD} 个图形`);
  console.log('创建后立即断开连接，模拟无活动白板');
  console.log('========================================');
  
  // 获取当前 TTL 配置
  let currentTTL = 24 * 60 * 60 * 1000; // 默认 24 小时
  try {
    const stats = await request(`${BASE_URL}/api/stats`);
    currentTTL = stats.config?.ttl || (24 * 60 * 60 * 1000);
  } catch (e) {
    // 使用默认值
  }
  
  const ttlMinutes = Math.round(currentTTL / 1000 / 60);
  const ttlSeconds = Math.round(currentTTL / 1000);
  
  console.log(`服务端当前 TTL: ${ttlMinutes} 分钟 (${ttlSeconds} 秒)`);
  console.log('');
  console.log('⚠️ 重要提示：');
  console.log('   为了准确测试 TTL 过期清理，建议在启动服务端时设置较短的 TTL：');
  console.log('   TTL=60000 node server/index.js  （TTL = 60 秒，用于测试）');
  console.log('   或者 TTL=30000 node server/index.js  （TTL = 30 秒，更快测试）');
  console.log('');
  
  if (ttlSeconds < 120) {
    console.log('   ✅ 当前 TTL 较短，适合测试 TTL 过期清理');
    console.log(`   ℹ️ 测试将等待约 ${ttlSeconds + 10} 秒，确保 TTL 过期清理触发`);
  } else {
    console.log('   ⚠️ 当前 TTL 较长，TTL 清理不会在测试期间触发');
    console.log('   ⚠️ 此测试将无法验证 TTL 过期清理机制');
    console.log('   ⚠️ 建议设置较短的 TTL 后重新运行测试');
  }
  console.log('========================================');
  
  // 测试前清空所有白板
  console.log('🧹 清空服务端所有白板...');
  await clearAllBoards();
  console.log('');
  
  // 并发创建白板（而不是串行创建）
  const boards = [];
  const disconnectTimes = []; // 记录每个白板的断开时间
  process.stdout.write(`正在并发创建 ${TEST_CONFIG.CLEANUP_BOARDS} 个测试白板...`);
  
  const createStartTime = Date.now();
  
  // 使用 Promise.all 并发创建所有白板
  const createPromises = [];
  for (let i = 0; i < TEST_CONFIG.CLEANUP_BOARDS; i++) {
    const boardId = randomBoardId();
    const createPromise = new Promise((resolve) => {
      const ws = new WebSocket(`${WS_URL}?boardId=${boardId}`);
      
      ws.on('open', async () => {
        // 收集所有图形，然后发送 snapshot（服务端只处理 snapshot 和 diff 消息）
        const shapes = [];
        for (let j = 0; j < TEST_CONFIG.CLEANUP_OPS_PER_BOARD; j++) {
          const shape = createRandomShape();
          shapes.push(shape);
        }
        
        // 发送 snapshot 消息（服务端会保存 snapshot 和 snapshotBytes）
        const snapshot = {
          shapes: shapes.reduce((acc, shape) => {
            acc[shape.id] = shape;
            return acc;
          }, {}),
        };
        
        ws.send(JSON.stringify({ 
          type: 'snapshot', 
          snapshot: snapshot,
          clientId: 'test-client'
        }));
        
        // 等待服务端处理 snapshot 消息（服务端需要时间保存 snapshot 和 snapshotBytes）
        // 如果立即关闭连接，服务端可能还没保存 snapshot，导致白板被删除
        setTimeout(() => {
          const disconnectTime = Date.now(); // 记录断开时间
          disconnectTimes.push(disconnectTime);
          ws.close();
          resolve();
        }, 1000); // 等待 1000ms，确保服务端有时间处理 snapshot
      });
      
      ws.on('error', () => {
        resolve(); // 忽略错误，继续执行
      });
    });
    
    createPromises.push(createPromise);
    boards.push(boardId);
  }
  
  // 等待所有白板创建完成
  await Promise.all(createPromises);
  
  const createEndTime = Date.now();
  const createDuration = createEndTime - createStartTime;
  process.stdout.write(` 完成（耗时: ${createDuration}ms）\n`);
  
  // 等待服务端处理所有 snapshot 和连接关闭
  console.log('  等待服务端处理完成...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // 记录最后一个断开时间（用于计算TTL过期时间）
  const lastDisconnectTime = disconnectTimes.length > 0 
    ? Math.max(...disconnectTimes) 
    : Date.now();
  
  const statsBefore = await request(`${BASE_URL}/api/stats`);
  console.log(`当前白板数: ${statsBefore.boards.total}（预期 ${boards.length}）`);
  
  if (statsBefore.boards.total === boards.length) {
    console.log(`  ✅ 白板创建成功：实际创建 ${statsBefore.boards.total} 个白板`);
  } else {
    console.log(`  ⚠️ 白板创建可能不完整：实际创建 ${statsBefore.boards.total} 个，预期 ${boards.length} 个`);
  }
  
  // 如果 TTL 较短，等待 TTL 过期并验证清理
  if (ttlSeconds < 120) {
    console.log('');
    console.log(`⏰ 等待 TTL 过期并触发清理...`);
    console.log('  ℹ️ 白板已断开连接，等待 TTL 过期后触发清理');
    
    // 计算需要等待的时间
    // 从最后一个断开时间开始，需要等待 TTL + 清理间隔（确保清理任务执行）
    const now = Date.now();
    const timeSinceLastDisconnect = now - lastDisconnectTime;
    const remainingTTL = Math.max(0, (ttlSeconds * 1000) - timeSinceLastDisconnect);
    
    // 获取服务端的清理间隔（用于计算总等待时间）
    let cleanupInterval = 5000; // 默认 5 秒
    try {
      const stats = await request(`${BASE_URL}/api/stats`);
      if (stats.config?.nextCleanupInterval) {
        cleanupInterval = stats.config.nextCleanupInterval;
      }
    } catch (e) {
      // 使用默认值
    }
    
    // 总等待时间 = 剩余TTL + 清理间隔 + 安全余量
    const totalWaitTime = remainingTTL + cleanupInterval + 5000; // 额外 5 秒安全余量
    const totalWaitSeconds = Math.ceil(totalWaitTime / 1000);
    
    console.log(`  ℹ️ 最后一个白板断开时间: ${new Date(lastDisconnectTime).toLocaleTimeString()}`);
    console.log(`  ℹ️ 当前时间: ${new Date(now).toLocaleTimeString()}`);
    console.log(`  ℹ️ 已等待: ${Math.round(timeSinceLastDisconnect / 1000)} 秒`);
    console.log(`  ℹ️ 剩余 TTL: ${Math.round(remainingTTL / 1000)} 秒`);
    console.log(`  ℹ️ 清理间隔: ${Math.round(cleanupInterval / 1000)} 秒`);
    console.log(`  ℹ️ 将等待 ${totalWaitSeconds} 秒，确保 TTL 过期清理触发`);
    console.log(`  ℹ️ 预计清理时间: ${new Date(now + totalWaitTime).toLocaleTimeString()}`);
    
    // 轮询检查清理状态
    const startWaitTime = Date.now();
    let previousCount = statsBefore.boards.total;
    let checkCount = 0;
    const maxWaitTime = totalWaitTime;
    
    while (Date.now() - startWaitTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 每 2 秒检查一次
      checkCount++;
      const elapsedSeconds = Math.round((Date.now() - startWaitTime) / 1000);
      const currentTime = Date.now();
      const timeSinceDisconnect = currentTime - lastDisconnectTime;
      const ttlExpired = timeSinceDisconnect >= (ttlSeconds * 1000);
      
      const currentStats = await request(`${BASE_URL}/api/stats`);
      const currentCount = currentStats.boards.total;
      
      if (currentCount < previousCount) {
        const deleted = previousCount - currentCount;
        console.log(`  清理中... (${elapsedSeconds}秒) 当前白板数: ${currentCount}，已删除: ${deleted}，TTL已过期: ${ttlExpired ? '是' : '否'}`);
      } else if (checkCount % 5 === 0) {
        // 每 10 秒显示一次状态
        const remainingWait = Math.max(0, Math.ceil((maxWaitTime - (currentTime - startWaitTime)) / 1000));
        console.log(`  等待中... (${elapsedSeconds}秒) 当前白板数: ${currentCount}，预期: 0（全部清理），剩余等待: ${remainingWait}秒，TTL已过期: ${ttlExpired ? '是' : '否'}`);
      }
      
      previousCount = currentCount;
      
      // 如果已经全部清理完成，提前结束
      if (currentCount === 0) {
        console.log(`  ✅ TTL 过期清理完成：所有白板已被清理（耗时 ${elapsedSeconds} 秒）`);
        break;
      }
    }
    
    // 最终检查
    const statsAfter = await request(`${BASE_URL}/api/stats`);
    const finalCount = statsAfter.boards.total;
    
    console.log('');
    console.log('📊 TTL 过期清理测试结果:');
    console.log(`  创建白板数: ${boards.length}`);
    console.log(`  最终剩余白板数: ${finalCount}`);
    console.log(`  清理白板数: ${boards.length - finalCount}`);
    
    if (finalCount === 0) {
      console.log(`  ✅ TTL 过期清理机制正常：所有白板已被清理`);
    } else {
      console.log(`  ⚠️ TTL 过期清理可能未完全生效：仍有 ${finalCount} 个白板未被清理`);
      console.log(`  ⚠️ 可能原因：TTL 还未完全过期，或者清理任务还未执行`);
    }
    
    // 检查清理日志
    const cleanupLogs = await request(`${BASE_URL}/api/cleanup-logs?limit=50`);
    const ttlLogs = (cleanupLogs.logs || []).filter(log => log.reason === 'ttl_expired');
    console.log(`  TTL 清理日志数量: ${ttlLogs.length}`);
    
    if (ttlLogs.length > 0) {
      console.log('  最近的 TTL 清理记录:');
      ttlLogs.slice(0, 5).forEach((log, i) => {
        console.log(`    ${i + 1}. ${new Date(log.timestamp).toLocaleString()}: 白板 ${log.boardId}, snapshot: ${log.stats.opsCount}KB`);
      });
    }
  } else {
    // TTL 太长，无法在测试期间验证
    console.log('');
    console.log('⚠️ 无法验证 TTL 过期清理：');
    console.log('  当前 TTL 为 24 小时，测试无法等待这么长时间');
    console.log('  建议设置较短的 TTL（如 60 秒）后重新运行测试');
    
    // 检查清理日志接口
    const cleanupLogs = await request(`${BASE_URL}/api/cleanup-logs?limit=10`);
    console.log(`清理日志数量: ${cleanupLogs.total || 0}`);
    if (cleanupLogs.logs && cleanupLogs.logs.length > 0) {
      console.log('最近的清理记录:');
      cleanupLogs.logs.slice(0, 5).forEach((log, i) => {
        const reasonText = log.reason === 'ttl_expired' ? 'TTL 过期' : log.reason === 'lru_eviction' ? 'LRU 淘汰' : log.reason;
        console.log(`  ${i + 1}. ${new Date(log.timestamp).toLocaleString()}: ${reasonText}`);
      });
    } else {
      console.log('  ℹ️ 暂无清理记录（正常，因为 TTL 为 24 小时）');
    }
  }
  
  return {
    boardsCreated: boards.length,
    currentBoards: statsBefore.boards.total,
    createDuration,
  };
}

async function testStressLoad() {
  console.log('\n🔥 测试 3: LRU 淘汰机制');
  console.log('========================================');
  console.log('测试目标：验证超过最大白板数时的 LRU 淘汰机制');
  
  // 获取当前配置
  let stressMaxBoards = 100;
  let currentTTL = 24 * 60 * 60 * 1000; // 默认 24 小时
  try {
    const stats = await request(`${BASE_URL}/api/stats`);
    stressMaxBoards = stats.config?.maxBoards || 100;
    currentTTL = stats.config?.ttl || (24 * 60 * 60 * 1000);
  } catch (e) {
    // 使用默认值
  }
  
  const ttlMinutes = Math.round(currentTTL / 1000 / 60);
  const ttlSeconds = Math.round(currentTTL / 1000);
  
  console.log(`服务端 MAX_BOARDS: ${stressMaxBoards}`);
  console.log(`服务端当前 TTL: ${ttlMinutes} 分钟 (${ttlSeconds} 秒)`);
  console.log(`将创建 ${TEST_CONFIG.STRESS_BOARDS} 个白板（超过限制 ${stressMaxBoards}）`);
  console.log(`每个白板包含 ${TEST_CONFIG.STRESS_OPS_PER_BOARD} 个图形`);
  console.log('');
  console.log('⚠️ 重要提示：');
  console.log('   为了准确测试 LRU 机制，建议在启动服务端时设置较短的 TTL：');
  console.log('   TTL=60000 node server/index.js  （TTL = 60 秒，用于测试）');
  console.log('   这样可以避免 TTL 清理干扰 LRU 测试');
  console.log('');
  if (ttlSeconds < 120) {
    console.log('   ✅ 当前 TTL 较短，适合测试 LRU 机制');
    console.log('   ⚠️ 但请注意：如果 TTL 太短（< 60秒），TTL 清理可能会在测试完成前触发');
    console.log('   ⚠️ 测试脚本会等待最多 60 秒，确保 LRU 清理完成');
  } else {
    console.log('   ⚠️ 当前 TTL 较长，TTL 清理不会在测试期间触发');
    console.log('   ℹ️ 主要测试 LRU 机制（按 lastActiveAt 排序清理）');
  }
  console.log('');
  console.log('预期结果：');
  console.log('   1. 创建完成时：约 300 个白板（连接仍打开）');
  console.log('   2. 关闭连接后：触发 LRU 清理（通过 setImmediate 异步执行）');
  console.log('   3. 等待时间：最多 60 秒，确保清理完成（包括渐进式清理）');
  console.log('   4. 最终保留：约 MAX_BOARDS 个最活跃的白板（按 lastActiveAt 排序）');
  console.log('========================================');
  
  // 测试前清空所有白板
  console.log('🧹 清空服务端所有白板...');
  await clearAllBoards();
  console.log('');
  
  // 内存测量：等待GC稳定后再测量（借鉴 test-hittest-performance.js 的采样逻辑）
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // 多次采样内存值，取平均值（减少GC波动影响）
  let memorySamplesBefore = [];
  for (let i = 0; i < 3; i++) {
    const stats = await request(`${BASE_URL}/api/stats`);
    memorySamplesBefore.push(stats.memory.process.heapUsed);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const memoryBefore = memorySamplesBefore.reduce((a, b) => a + b, 0) / memorySamplesBefore.length;
  const statsBefore = await request(`${BASE_URL}/api/stats`);
  
  // 记录创建操作的开始时间（只计算实际创建时间，不包含等待时间）
  const createStartTime = Date.now();
  
  // 并发创建超过限制的白板数量（而不是串行创建）
  const boards = [];
  process.stdout.write(`并发创建 ${TEST_CONFIG.STRESS_BOARDS} 个白板...`);
  
  // 保存所有 WebSocket 连接，避免在创建过程中被清理
  const wsConnections = [];
  
  // 使用 Promise.all 并发创建所有白板
  const createPromises = [];
  for (let i = 0; i < TEST_CONFIG.STRESS_BOARDS; i++) {
    const boardId = randomBoardId();
    const createPromise = new Promise((resolve) => {
      const ws = new WebSocket(`${WS_URL}?boardId=${boardId}`);
      
      ws.on('open', async () => {
        // 保存连接，避免被清理
        wsConnections.push(ws);
        
        // 收集所有图形，然后发送 snapshot（服务端只处理 snapshot 和 diff 消息）
        const shapes = [];
        for (let j = 0; j < TEST_CONFIG.STRESS_OPS_PER_BOARD; j++) {
          const shape = createRandomShape();
          shapes.push(shape);
        }
        
        // 发送 snapshot 消息（服务端会保存 snapshot 和 snapshotBytes）
        const snapshot = {
          shapes: shapes.reduce((acc, shape) => {
            acc[shape.id] = shape;
            return acc;
          }, {}),
        };
        
        ws.send(JSON.stringify({ 
          type: 'snapshot', 
          snapshot: snapshot,
          clientId: 'test-client'
        }));
        
        // 等待服务端处理 snapshot 消息（服务端需要时间保存 snapshot 和 snapshotBytes）
        setTimeout(() => {
          resolve();
        }, 200); // 等待服务端处理 snapshot
      });
      
      ws.on('error', () => {
        resolve(); // 忽略错误
      });
    });
    
    createPromises.push(createPromise);
    boards.push(boardId);
  }
  
  // 等待所有白板创建完成
  await Promise.all(createPromises);
  
  // 记录创建操作的结束时间（在等待之前，只计算实际创建时间）
  const createEndTime = Date.now();
  const createDuration = createEndTime - createStartTime;
  process.stdout.write(` 完成（耗时: ${createDuration}ms）\n`);
  
  // 立即统计一次（在关闭连接前），看看实际创建了多少
  const statsImmediate = await request(`${BASE_URL}/api/stats`);
  console.log(`  创建完成时白板数: ${statsImmediate.boards.total}（连接仍打开，应接近 ${boards.length}）`);
  
  // 验证创建是否成功
  if (statsImmediate.boards.total >= boards.length * 0.9) {
    console.log(`  ✅ 创建成功：实际创建 ${statsImmediate.boards.total} 个白板（预期 ${boards.length}）`);
  } else {
    console.log(`  ⚠️ 创建可能不完整：实际创建 ${statsImmediate.boards.total} 个白板（预期 ${boards.length}）`);
  }
  
  // 等待服务端处理完成
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 关闭所有连接（模拟用户断开，触发 LRU 清理）
  console.log('  正在关闭所有连接（模拟用户断开）...');
  const closeStartTime = Date.now();
  wsConnections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });
  
  // 等待连接完全关闭（给服务端一点时间处理 close 事件）
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // 获取关闭连接前的清理日志数量（用于后续验证）
  let cleanupLogsBefore = [];
  try {
    const logsBefore = await request(`${BASE_URL}/api/cleanup-logs?limit=100`);
    cleanupLogsBefore = logsBefore.logs || [];
  } catch (e) {
    // 忽略错误
  }
  
  // 等待清理机制执行
  console.log('  等待 LRU 清理机制执行...');
  console.log('  ℹ️ LRU 清理是异步的，通过 setImmediate 触发');
  console.log('  ℹ️ 服务端 MAX_CLEANUP_PER_BATCH = 10，如果待清理白板数 > 10，会触发渐进式清理');
  
  const expectedMaxBoardsForWait = statsImmediate.config?.maxBoards || 100;
  const boardsToClean = Math.max(0, statsImmediate.boards.total - expectedMaxBoardsForWait);
  const expectedBatches = Math.ceil(boardsToClean / 10);
  console.log(`  ℹ️ 当前需要清理 ${boardsToClean} 个白板，预计需要 ${expectedBatches} 个批次`);
  
  // 轮询检查，直到白板数量稳定或达到预期范围
  let previousCount = statsImmediate.boards.total;
  let stableCount = 0;
  const maxWaitTime = Math.max(60000, expectedBatches * 500 + 10000);
  const startWaitTime = Date.now();
  let checkCount = 0;
  let lastCleanupLogCount = cleanupLogsBefore.length;
  let totalCleaned = 0;
  
  while (Date.now() - startWaitTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // 每 2 秒检查一次（给清理更多时间）
    checkCount++;
    const elapsedSeconds = Math.round((Date.now() - startWaitTime) / 1000);
    
    const currentStats = await request(`${BASE_URL}/api/stats`);
    const currentCount = currentStats.boards.total;
    const expectedMaxBoards = currentStats.config?.maxBoards || 100;
    
    // 检查清理日志，确认是否有新的清理记录
    let newCleanupLogs = [];
    try {
      const logsAfter = await request(`${BASE_URL}/api/cleanup-logs?limit=100`);
      newCleanupLogs = (logsAfter.logs || []).slice(0, 20); // 只检查最近 20 条
      const lruLogs = newCleanupLogs.filter(log => log.reason === 'lru_eviction');
      const ttlLogs = newCleanupLogs.filter(log => log.reason === 'ttl_expired');
      
      if (lruLogs.length > 0 || ttlLogs.length > 0) {
        console.log(`  清理日志 (${elapsedSeconds}秒): LRU=${lruLogs.length} 条, TTL=${ttlLogs.length} 条`);
      }
    } catch (e) {
      // 忽略错误
    }
    
    // 显示清理进度
    const deleted = previousCount - currentCount;
    if (deleted > 0) {
      totalCleaned += deleted;
      const remainingToClean = Math.max(0, currentCount - expectedMaxBoards);
      const estimatedBatchesRemaining = Math.ceil(remainingToClean / 10);
      console.log(`  清理中... (${elapsedSeconds}秒) 当前白板数: ${currentCount}，已删除: ${deleted}（累计: ${totalCleaned}），剩余待清理: ${remainingToClean}（约 ${estimatedBatchesRemaining} 批次）`);
    } else if (currentCount !== previousCount) {
      console.log(`  清理中... (${elapsedSeconds}秒) 当前白板数: ${currentCount}（上次: ${previousCount}）`);
    } else if (checkCount % 5 === 0) {
      // 每 10 秒（5次检查）显示一次状态，避免日志过多
      const remainingToClean = Math.max(0, currentCount - expectedMaxBoards);
      console.log(`  等待中... (${elapsedSeconds}秒) 当前白板数: ${currentCount}，预期: 约 ${expectedMaxBoards}，剩余待清理: ${remainingToClean}`);
    }
    
    // 如果数量稳定（连续 4 次相同，即 8 秒），认为清理完成
    if (currentCount === previousCount) {
      stableCount++;
      if (stableCount >= 4) {
        console.log(`  ✅ 清理完成：白板数量已稳定在 ${currentCount}（连续 ${stableCount * 2} 秒未变化）`);
        
        // 验证是否达到预期范围
        const expectedRange = [Math.max(1, expectedMaxBoards - 10), expectedMaxBoards + 5];
        if (currentCount >= expectedRange[0] && currentCount <= expectedRange[1]) {
          console.log(`  ✅ LRU 机制正常：实际保留 ${currentCount} 个白板，符合预期范围 [${expectedRange[0]}, ${expectedRange[1]}]`);
        } else {
          console.log(`  ⚠️ LRU 机制可能异常：实际保留 ${currentCount} 个白板，预期范围 [${expectedRange[0]}, ${expectedRange[1]}]`);
          console.log(`  ⚠️ 可能原因：清理任务还未完成，或者 TTL 清理也在同时进行`);
        }
        break;
      }
    } else {
      stableCount = 0;
    }
    
    // 如果已经降到预期范围，也可以提前结束（但需要稳定）
    if (currentCount <= expectedMaxBoards + 5 && currentCount >= expectedMaxBoards - 10) {
      if (stableCount >= 3) {
        console.log(`  ✅ 已达到预期范围且稳定：${currentCount} 个白板（预期约 ${expectedMaxBoards}）`);
        break;
      }
    }
    
    previousCount = currentCount;
  }
  
  if (Date.now() - startWaitTime >= maxWaitTime) {
    console.log(`  ⚠️ 等待超时（${maxWaitTime / 1000}秒），使用当前白板数作为最终结果`);
    console.log(`  ⚠️ 如果结果异常，可能是清理任务还未完成，建议增加等待时间或检查服务端日志`);
  }
  
  // 额外等待一小段时间，确保清理完全完成（特别是渐进式清理）
  console.log('  额外等待 3 秒，确保渐进式清理完成...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // 多次采样内存值，取平均值（减少GC波动影响）
  let memorySamplesAfter = [];
  for (let i = 0; i < 3; i++) {
    const stats = await request(`${BASE_URL}/api/stats`);
    memorySamplesAfter.push(stats.memory.process.heapUsed);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const memoryAfter = memorySamplesAfter.reduce((a, b) => a + b, 0) / memorySamplesAfter.length;
  const statsAfter = await request(`${BASE_URL}/api/stats`);
  
  const memoryDelta = memoryAfter - memoryBefore;
  
  // 获取配置用于验证
  let expectedMaxBoards = 100;
  try {
    const configStats = await request(`${BASE_URL}/api/stats`);
    expectedMaxBoards = configStats.config?.maxBoards || 100;
  } catch (e) {}
  
  console.log(`  创建耗时: ${createDuration}ms（不包含等待时间）`);
  console.log(`  尝试创建: ${boards.length} 个白板`);
  console.log(`  创建完成时白板数: ${statsImmediate.boards.total}（连接仍打开）`);
  console.log(`  关闭连接后白板数: ${statsAfter.boards.total}（LRU 清理后）`);
  console.log(`  预期保留: 约 ${expectedMaxBoards} 个白板（MAX_BOARDS）`);
  console.log(`  实际清理: ${statsImmediate.boards.total - statsAfter.boards.total} 个白板`);
  
  // 验证 LRU 机制是否正常工作
  const expectedRange = [Math.max(1, expectedMaxBoards - 10), expectedMaxBoards + 5]; // 允许一些误差
  if (statsAfter.boards.total >= expectedRange[0] && statsAfter.boards.total <= expectedRange[1]) {
    console.log(`  ✅ LRU 机制正常：实际保留 ${statsAfter.boards.total} 个白板，符合预期范围 [${expectedRange[0]}, ${expectedRange[1]}]`);
    console.log(`  ✅ LRU 机制验证通过：成功清理了 ${statsImmediate.boards.total - statsAfter.boards.total} 个白板，保留了最活跃的 ${statsAfter.boards.total} 个`);
  } else {
    console.log(`  ⚠️ LRU 机制可能异常：实际保留 ${statsAfter.boards.total} 个白板，预期范围 [${expectedRange[0]}, ${expectedRange[1]}]`);
    if (statsAfter.boards.total < expectedRange[0]) {
      console.log(`  ⚠️ 可能原因：清理过度，或者 TTL 清理也在同时进行`);
    } else if (statsAfter.boards.total > expectedRange[1]) {
      console.log(`  ⚠️ 可能原因：清理不足，或者清理任务还未完成`);
    }
  }
  
  console.log(`  内存增长: ${memoryDelta.toFixed(2)}MB（多次采样平均值）`);
  console.log(`  当前内存: ${memoryAfter.toFixed(2)}MB / ${statsAfter.memory.process.heapTotal.toFixed(2)}MB`);
  console.log(`  内存使用率: ${(memoryAfter / statsAfter.memory.process.heapTotal * 100).toFixed(2)}%`);
  
  return {
    attempted: boards.length,
    created: statsImmediate.boards.total,
    actual: statsAfter.boards.total,
    expected: expectedMaxBoards,
    createDuration,
    memoryDelta,
  };
}

async function testHealthEndpoint() {
  console.log('\n🏥 健康检查接口测试');
  console.log('========================================');
  
  const health = await request(`${BASE_URL}/health`);
  console.log(`状态: ${health.ok ? '✅ 正常' : '❌ 异常'}`);
  console.log(`白板数: ${health.boards.count} (活跃: ${health.boards.active})`);
  console.log(`内存: ${health.memory.heapUsed.toFixed(2)}MB / ${health.memory.heapTotal.toFixed(2)}MB (${(health.memory.usageRatio * 100).toFixed(2)}%)`);
  
  return health;
}

async function testComplexScenarios() {
  console.log('\n🎭 复杂场景测试');
  console.log('========================================');
  console.log('模拟真实使用场景：不同大小的白板、并发连接、不同操作频率');
  console.log('========================================\n');
  
  // 测试前清空所有白板
  console.log('🧹 清空服务端所有白板...');
  await clearAllBoards();
  console.log('');
  
  // 内存测量：等待GC稳定后再测量（借鉴 test-hittest-performance.js 的采样逻辑）
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // 多次采样内存值，取平均值（减少GC波动影响）
  let memorySamplesBefore = [];
  for (let i = 0; i < 3; i++) {
    const stats = await request(`${BASE_URL}/api/stats`);
    memorySamplesBefore.push(stats.memory.process.heapUsed);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const memoryBefore = memorySamplesBefore.reduce((a, b) => a + b, 0) / memorySamplesBefore.length;
  const statsBefore = await request(`${BASE_URL}/api/stats`);
  
  const allBoards = [];
  // 记录创建操作的开始时间（只计算实际创建时间，不包含等待时间）
  const createStartTime = Date.now();
  
  // 测试不同大小的白板（完全并发创建，而不是分批）
  for (const scenario of TEST_CONFIG.COMPLEX_SCENARIOS.boardSizes) {
    console.log(`\n📦 场景：并发创建 ${scenario.count} 个白板，每个包含 ${scenario.shapesPerBoard} 个图形`);
    console.log(`   总计约 ${scenario.count * scenario.shapesPerBoard} 个图形`);
    
    const scenarioBoards = [];
    
    // 完全并发创建所有白板（而不是分批）
    console.log(`   正在并发创建 ${scenario.count} 个白板...`);
    
    const promises = [];
    for (let i = 0; i < scenario.count; i++) {
      const boardId = `complex-${scenario.shapesPerBoard}-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sessionDuration = TEST_CONFIG.COMPLEX_SCENARIOS.sessionDurations[
        Math.floor(Math.random() * TEST_CONFIG.COMPLEX_SCENARIOS.sessionDurations.length)
      ];
      
      promises.push(createComplexBoard(boardId, scenario.shapesPerBoard, sessionDuration));
      scenarioBoards.push(boardId);
    }
    
    // 等待所有白板创建完成
    await Promise.all(promises);
    
    allBoards.push(...scenarioBoards);
    console.log(`   ✅ 完成：已创建 ${scenarioBoards.length} 个白板`);
    
    // 等待服务端处理
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // 记录创建操作的结束时间（在等待之前，只计算实际创建时间）
  const createEndTime = Date.now();
  const createDuration = createEndTime - createStartTime;
  
  // 等待所有操作完成（这部分时间不计入性能测试）
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // 多次采样内存值，取平均值（减少GC波动影响）
  let memorySamplesAfter = [];
  for (let i = 0; i < 3; i++) {
    const stats = await request(`${BASE_URL}/api/stats`);
    memorySamplesAfter.push(stats.memory.process.heapUsed);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const memoryAfter = memorySamplesAfter.reduce((a, b) => a + b, 0) / memorySamplesAfter.length;
  const statsAfter = await request(`${BASE_URL}/api/stats`);
  
  // 计算统计
  const totalShapes = TEST_CONFIG.COMPLEX_SCENARIOS.boardSizes.reduce(
    (sum, s) => sum + (s.count * s.shapesPerBoard), 0
  );
  const boardsDelta = statsAfter.boards.total - statsBefore.boards.total;
  const memoryDelta = memoryAfter - memoryBefore;
  
  console.log('\n📊 复杂场景测试结果:');
  console.log('========================================');
  console.log(`  创建耗时: ${(createDuration / 1000).toFixed(2)} 秒（不包含等待时间）`);
  console.log(`  尝试创建: ${allBoards.length} 个白板`);
  console.log(`  实际存在: ${boardsDelta} 个白板`);
  console.log(`  总图形数: 约 ${totalShapes} 个`);
  console.log(`  内存增长: ${memoryDelta.toFixed(2)}MB（多次采样平均值）`);
  console.log(`  当前内存: ${memoryAfter.toFixed(2)}MB / ${statsAfter.memory.process.heapTotal.toFixed(2)}MB`);
  console.log(`  内存使用率: ${(memoryAfter / statsAfter.memory.process.heapTotal * 100).toFixed(2)}%`);
  
  return {
    boardsCreated: allBoards.length,
    boardsDelta,
    totalShapes,
    memoryDelta,
    createDuration,
  };
}

// 创建复杂场景的白板（带随机操作间隔和会话时长）
async function createComplexBoard(boardId, shapesCount, sessionDuration) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?boardId=${boardId}`);
    let shapesSent = 0;
    const remainingShapes = []; // 用于在会话结束后一次性补齐剩余图形（避免多次 reset 覆盖）
    
    ws.on('open', async () => {
      const startTime = Date.now();
      const endTime = startTime + sessionDuration;
      
      // 在会话持续时间内发送图形
      while (Date.now() < endTime && shapesSent < shapesCount) {
        const shape = createRandomShape();
        
        // 随机操作间隔（模拟真实用户操作）
        const interval = TEST_CONFIG.COMPLEX_SCENARIOS.operationInterval[0] + 
          Math.random() * (TEST_CONFIG.COMPLEX_SCENARIOS.operationInterval[1] - 
          TEST_CONFIG.COMPLEX_SCENARIOS.operationInterval[0]);
        
        // 收集图形，稍后统一发送 snapshot
        remainingShapes.push(shape);
        shapesSent++;
        
        // 随机间隔
        await new Promise(r => setTimeout(r, interval));
      }
      
      // 如果还有剩余图形，快速补齐
      if (shapesSent < shapesCount) {
        const remaining = shapesCount - shapesSent;
        while (remainingShapes.length < shapesCount) {
          remainingShapes.push(createRandomShape());
        }
      }
      
      // 统一发送 snapshot（服务端只处理 snapshot 和 diff 消息）
      const snapshot = {
        shapes: remainingShapes.reduce((acc, shape) => {
          acc[shape.id] = shape;
          return acc;
        }, {}),
      };
      
      try {
        ws.send(JSON.stringify({ 
          type: 'snapshot', 
          snapshot: snapshot 
        }));
      } catch (e) {
        // 如果发送失败，可以忽略，复杂场景测试更关注整体趋势而非绝对数量
      }
      
      // 等待会话结束
      const remainingTime = endTime - Date.now();
      if (remainingTime > 0) {
        await new Promise(r => setTimeout(r, remainingTime));
      }
      
      ws.close();
      resolve();
    });
    
    ws.on('error', (error) => {
      // 忽略错误，继续执行
      resolve();
    });
  });
}

async function testVisualization() {
  console.log('\n🎨 生命周期管理可视化测试');
  console.log('========================================');
  console.log('此测试将创建多个测试白板，并在浏览器中可视化展示');
  console.log('');
  
  // 测试前清空所有白板
  console.log('🧹 清空服务端所有白板...');
  await clearAllBoards();
  console.log('');
  
  const testBoards = [];
  const boardsToCreate = 5; // 创建5个测试白板用于可视化
  const shapesPerBoard = 200; // 每个白板200个图形
  
  for (let i = 0; i < boardsToCreate; i++) {
    const testBoardId = `lifecycle-test-${i}-${Date.now()}`;
    const ws = new WebSocket(`${WS_URL}?boardId=${testBoardId}`);
    
    await new Promise((resolve, reject) => {
      ws.on('open', async () => {
        console.log(`创建测试白板 ${i + 1}/${boardsToCreate}: ${testBoardId}`);
        
        const allShapes = [];
        const canvasWidth = 2000;
        const canvasHeight = 1500;
        
        for (let j = 0; j < shapesPerBoard; j++) {
          const shape = createRandomShape();
          
          // 随机分布
          const x = Math.random() * canvasWidth;
          const y = Math.random() * canvasHeight;
          
          if (shape.type === 'geo') {
            shape.x = x;
            shape.y = y;
            shape.rotation = Math.random() * Math.PI * 2;
            if (shape.props) {
              shape.props.w = 30 + Math.random() * 150;
              shape.props.h = 30 + Math.random() * 150;
            }
          } else if (shape.type === 'draw') {
            const numPoints = 5 + Math.floor(Math.random() * 15);
            const points = [];
            let currentX = x;
            let currentY = y;
            
            for (let k = 0; k < numPoints; k++) {
              currentX += (Math.random() - 0.5) * 100;
              currentY += (Math.random() - 0.5) * 100;
              points.push({
                x: currentX,
                y: currentY,
                z: 0.3 + Math.random() * 0.4,
              });
            }
            
            if (shape.props && shape.props.segments) {
              shape.props.segments[0].points = points;
            }
            shape.x = 0;
            shape.y = 0;
          } else if (shape.type === 'arrow') {
            const angle = Math.random() * Math.PI * 2;
            const length = 50 + Math.random() * 200;
            const endX = x + Math.cos(angle) * length;
            const endY = y + Math.sin(angle) * length;
            
            shape.x = x;
            shape.y = y;
            shape.rotation = Math.random() * Math.PI * 2;
            if (shape.props) {
              shape.props.start = { x, y };
              shape.props.end = { x: endX, y: endY };
              shape.props.bend = (Math.random() - 0.5) * 50;
            }
          }
          
          allShapes.push(shape);
        }
        
        ws.send(JSON.stringify({ type: 'reset', shapes: allShapes }));
        
        await new Promise(r => setTimeout(r, 1000));
        ws.close();
        
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const boardUrl = `${frontendUrl}/?boardId=${testBoardId}`;
        
        testBoards.push({
          id: testBoardId,
          url: boardUrl,
          shapesCount: allShapes.length,
        });
        
        resolve();
      });
      
      ws.on('error', reject);
    });
  }
  
  console.log('\n✅ 测试白板创建完成！');
  console.log('\n📋 测试白板列表：');
  testBoards.forEach((board, i) => {
    console.log(`   ${i + 1}. ${board.id}`);
    console.log(`      图形数: ${board.shapesCount}`);
    console.log(`      链接: ${board.url}`);
  });
  
  // 自动打开第一个白板
  if (testBoards.length > 0) {
    const firstBoard = testBoards[0];
    console.log(`\n🌐 正在打开第一个测试白板: ${firstBoard.url}`);
    
    try {
      const { exec } = require('child_process');
      const platform = process.platform;
      let command;
      
      if (platform === 'win32') {
        command = `start "" "${firstBoard.url}"`;
      } else if (platform === 'darwin') {
        command = `open "${firstBoard.url}"`;
      } else {
        command = `xdg-open "${firstBoard.url}"`;
      }
      
      exec(command);
    } catch (e) {
      console.log('⚠️  无法自动打开浏览器，请手动复制上面的链接');
    }
  }
  
  return testBoards;
}


// ===== 主函数 =====

async function runAllTests() {
  console.log('🚀 内存管理性能压力测试');
  console.log('========================================');
  console.log('请确保服务端已启动 (npm run dev)');
  console.log('========================================\n');
  
  // 获取服务端配置信息（TTL 和 LRU 设置）
  console.log('📋 服务端配置信息：');
  console.log('========================================');
  try {
    const stats = await request(`${BASE_URL}/api/stats`);
    const config = stats.config || {};
    
    const maxBoards = config.maxBoards || 100;
    const ttlMs = config.ttl || (24 * 60 * 60 * 1000);
    const ttlMinutes = Math.round(ttlMs / 1000 / 60);
    const ttlHours = Math.round(ttlMs / 1000 / 60 / 60);
    
    console.log('   🔧 LRU 淘汰机制：');
    console.log(`      - 最大白板数 (MAX_BOARDS): ${maxBoards}`);
    console.log(`      - 当白板数超过 ${maxBoards} 时，会触发 LRU 清理`);
    console.log(`      - 优先清理无客户端连接的白板`);
    console.log(`      - 按最后活动时间排序，清理最旧的白板`);
    console.log('');
    console.log('   ⏰ TTL 过期清理：');
    console.log(`      - TTL (Time To Live): ${ttlMs}ms`);
    console.log(`      - 约 ${ttlHours} 小时 (${ttlMinutes} 分钟)`);
    console.log(`      - 无客户端连接且超过 TTL 的白板会被清理`);
    console.log(`      - 清理间隔会根据内存使用率动态调整`);
    console.log('');
    console.log('   📊 其他配置：');
    console.log(`      - 单个白板最大操作数: ${config.maxOpsPerBoard || 'N/A'}`);
    if (config.nextCleanupInterval) {
      const nextCleanupSeconds = Math.round(config.nextCleanupInterval / 1000);
      console.log(`      - 下次清理间隔: ${nextCleanupSeconds} 秒`);
    }
    console.log('========================================\n');
  } catch (error) {
    console.log('   ⚠️ 无法获取服务端配置信息，使用默认值');
    console.log('   - MAX_BOARDS: 100');
    console.log('   - TTL: 24 小时');
    console.log('');
  }
  
  // 在测试开始前，执行一次清空操作（借鉴 test-hittest-performance.js）
  console.log('🧹 清空服务端所有白板...');
  console.log('   使用的 API（服务端 API）：');
  console.log('   - DELETE /api/boards - 服务端 API，清空所有白板');
  console.log('   说明：此 API 会关闭所有 WebSocket 连接并清空所有白板数据');
  
  try {
    const clearResult = await request(`${BASE_URL}/api/boards`, {
      method: 'DELETE',
    });
    
    if (clearResult.success) {
      console.log(`   ✅ 已清空 ${clearResult.clearedCount} 个白板，释放约 ${clearResult.memoryFreed}MB 内存`);
    } else {
      console.log('   ⚠️ 清空操作可能未完全成功');
    }
  } catch (error) {
    console.log(`   ⚠️ 清空操作失败: ${error.message}`);
    console.log('   ℹ️ 继续执行测试（可能服务端没有白板需要清空）');
  }
  console.log('');
  
  console.log('📋 测试说明：');
  console.log('   使用的 API：');
  console.log('   - http.request() - Node.js 原生方法，发送 HTTP 请求');
  console.log('   - WebSocket (ws) - WebSocket 客户端，连接服务端');
  console.log('   - /api/stats - 服务端 API，获取内存和统计信息');
  console.log('   说明：内存采样使用多次请求取平均值，减少 GC 波动影响');
  console.log('');
  console.log('🎯 测试目标：');
  console.log('   1. 白板创建和销毁 - 验证基本创建和内存使用');
  console.log('   2. TTL 过期清理 - 验证无活动白板的自动清理');
  console.log('   3. LRU 淘汰机制 - 验证超过最大白板数时的清理');
  console.log('   4. 复杂场景测试 - 模拟真实使用场景');
  console.log('');
  
  try {
    // 健康检查
    await testHealthEndpoint();
    
    // 基础内存测试
    await testBasicMemoryUsage();
    
    // 清理机制测试
    await testCleanupMechanism();
    
    // 压力测试
    await testStressLoad();
    
    // 复杂场景测试（新增）
    await testComplexScenarios();
    
    console.log('\n✅ 所有测试完成！');
    
  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    console.error('请确保服务端已启动: npm run dev');
    process.exit(1);
  }
}

// ===== 命令行参数处理 =====

const testType = process.argv[2] || 'all';

switch(testType) {
  case 'basic':
    testBasicMemoryUsage().then(() => process.exit(0));
    break;
  case 'cleanup':
    testCleanupMechanism().then(() => process.exit(0));
    break;
  case 'stress':
    testStressLoad().then(() => process.exit(0));
    break;
  case 'complex':
    testComplexScenarios().then(() => process.exit(0));
    break;
  case 'health':
    testHealthEndpoint().then(() => process.exit(0));
    break;
  case 'visual':
  case 'visualization':
    testVisualization().then(() => {
      console.log('\n✨ 可视化测试完成！');
      console.log('   您可以在浏览器中查看创建的测试白板');
      console.log('   测试白板将用于验证生命周期管理机制');
      process.exit(0);
    }).catch((error) => {
      console.error('测试失败:', error);
      process.exit(1);
    });
    break;
  case 'all':
  default:
    runAllTests().then(() => process.exit(0));
    break;
}
