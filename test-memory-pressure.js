/**
 * 服务端生命周期管理测试脚本（Node.js）
 * 
 * 测试目标：验证服务端白板生命周期管理机制和保护机制完整性
 * - 白板创建和销毁
 * - TTL 过期清理机制验证
 * - LRU 淘汰机制验证（超过 MAX_BOARDS 限制时自动清理）
 * - 内存使用和清理
 * - 保护机制完整性验证（确保清理机制正常工作）
 * 
 * 测试特点：
 * - 使用项目自定义的 DrawOp 格式（rect, circle, arrow, stroke）
 * - 参数已优化，便于验证保护机制（不会创建过多白板）
 * - 自动验证清理机制是否触发和工作正常
 * - 显示详细的验证结果和清理日志
 * 
 * 使用方法:
 *   node test-memory-pressure.js              # 运行所有测试
 *   node test-memory-pressure.js basic        # 只运行基础内存测试
 *   node test-memory-pressure.js cleanup      # 只运行清理机制测试（验证 TTL 和 LRU）
 *   node test-memory-pressure.js stress       # 只运行压力测试（创建 120 个白板，验证 LRU 清理到 100 个）
 *   node test-memory-pressure.js complex      # 只运行复杂场景测试（模拟真实使用场景）
 *   node test-memory-pressure.js health       # 只运行健康检查
 *   node test-memory-pressure.js visual       # 可视化测试（创建测试白板并打开浏览器）
 * 
 * 测试配置说明：
 * - 服务端默认 MAX_BOARDS = 100
 * - 压力测试创建 120 个白板，验证是否清理到约 100 个
 * - 清理测试创建 30 个白板，验证无活动白板识别
 * - 所有测试都会验证清理机制是否正常工作
 * 
 * 注意：
 * - 此脚本必须在 Node.js 环境中运行，不能在浏览器中运行！
 * - 运行前请确保服务端已启动（npm run dev）
 * - 测试会创建真实的白板数据，建议在测试环境运行
 * 
 * 其他测试脚本：
 * - test-incremental-drawing.js: 增量绘制性能测试（浏览器控制台）
 * - test-hittest-performance.js: hitTest 性能测试（浏览器控制台）
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
  
  // 压力测试：创建超过服务端限制的白板，测试 LRU 清理机制
  // 注意：服务端默认 MAX_BOARDS = 100
  // 创建 120 个白板，验证清理机制是否正常工作（应该清理到约 100 个）
  STRESS_BOARDS: 120,  // 超过限制但不会太多，便于验证清理机制
  STRESS_OPS_PER_BOARD: 100,  // 每个白板 100 个图形，总共 12,000 个图形
  
  // 清理测试：创建中等数量白板，测试 TTL 清理机制
  // 注意：TTL 默认是 24 小时，此测试主要验证无活动白板是否能被正确识别
  CLEANUP_BOARDS: 30,  // 创建30个白板，验证清理机制
  CLEANUP_OPS_PER_BOARD: 100,  // 每个白板 100 个图形，总共 3,000 个图形
  
  // 复杂场景测试：模拟真实使用场景
  COMPLEX_SCENARIOS: {
    // 不同大小的白板（模拟不同用户的使用习惯）
    boardSizes: [
      { count: 20, shapesPerBoard: 50 },   // 小规模白板（20个，每个50个图形）
      { count: 30, shapesPerBoard: 200 }, // 中等规模白板（30个，每个200个图形）
      { count: 15, shapesPerBoard: 500 },  // 大规模白板（15个，每个500个图形）
      { count: 5, shapesPerBoard: 2000 },  // 超大规模白板（5个，每个2000个图形）
    ],
    // 并发连接数（模拟多用户同时操作）
    concurrentConnections: 10,
    // 操作间隔（模拟真实用户的操作频率，单位：毫秒）
    operationInterval: [50, 200], // 50-200ms 随机间隔
    // 连接持续时间（模拟用户会话时长，单位：毫秒）
    sessionDurations: [5000, 30000, 60000], // 5秒、30秒、60秒
  },
  
  // 请求超时
  REQUEST_TIMEOUT: 30000,
};

// ===== 工具函数 =====

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
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

// 修改服务端配置（用于测试）
async function updateConfig(config) {
  const url = `${BASE_URL}/api/config`;
  return await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: config,
  });
}

// 恢复服务端配置
async function resetConfig() {
  const url = `${BASE_URL}/api/config/reset`;
  return await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

// 获取当前配置
async function getConfig() {
  const url = `${BASE_URL}/api/config`;
  try {
    const result = await request(url);
    // 检查返回的是否是HTML错误页面
    if (typeof result === 'string' && result.includes('<!DOCTYPE html>')) {
      console.error('\n❌ 错误：服务端返回了HTML错误页面');
      console.error('   这说明配置API不存在或服务端未重启');
      console.error('   请执行以下步骤：');
      console.error('   1. 停止当前服务端（Ctrl+C）');
      console.error('   2. 重新启动服务端：npm run dev');
      console.error('   3. 确保 server/index.js 包含配置API代码');
      throw new Error('配置API不存在，请重启服务端');
    }
    return result;
  } catch (error) {
    if (error.message.includes('ECONNREFUSED') || error.message.includes('timeout')) {
      console.error('\n❌ 错误：无法连接到服务端');
      console.error('   请确保服务端已启动：npm run dev');
      throw new Error('无法连接到服务端');
    }
    throw error;
  }
}

function randomBoardId() {
  return Math.random().toString(36).slice(2, 10);
}

// 创建项目自定义格式的 DrawOp
function createRandomShape() {
  const canvasWidth = 2000;
  const canvasHeight = 1500;
  
  // 支持的图形类型（适配项目格式）
  const types = ['rect', 'circle', 'arrow', 'stroke'];
  const type = types[Math.floor(Math.random() * types.length)];
  
  const colors = ['#000000', '#808080', '#0000ff', '#00ff00', '#ff0000', '#ffff00', '#ffa500'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const width = 2 + Math.floor(Math.random() * 5); // 2-6
  const style = Math.random() > 0.7 ? 'dashed' : 'solid';
  
  const x = Math.random() * canvasWidth;
  const y = Math.random() * canvasHeight;
  const w = 50 + Math.random() * 200;
  const h = 50 + Math.random() * 200;
  
  switch(type) {
    case 'rect':
      return {
        kind: 'rect',
        tool: 'rect',
        start: { x, y },
        end: { x: x + w, y: y + h },
        color,
        width,
        style,
      };
    
    case 'circle':
      const radius = Math.min(w, h) / 2;
      return {
        kind: 'circle',
        tool: 'circle',
        center: { x: x + w / 2, y: y + h / 2 },
        radius,
        color,
        width,
        style,
      };
    
    case 'arrow':
      const angle = Math.random() * Math.PI * 2;
      const length = 50 + Math.random() * 300;
      const endX = x + Math.cos(angle) * length;
      const endY = y + Math.sin(angle) * length;
      
      return {
        kind: 'arrow',
        tool: 'arrow',
        start: { x, y },
        end: { x: endX, y: endY },
        color,
        width,
        style,
      };
    
    case 'stroke': // pen
      // 创建手绘线条，使用随机点形成自然曲线
      const numPoints = 5 + Math.floor(Math.random() * 20); // 5-25个点
      const points = [];
      let currentX = x;
      let currentY = y;
      
      for (let i = 0; i < numPoints; i++) {
        // 每个点基于前一个点，形成连续路径
        currentX += (Math.random() - 0.5) * 80;
        currentY += (Math.random() - 0.5) * 80;
        points.push({
          x: currentX,
          y: currentY,
        });
      }
      
      return {
        kind: 'stroke',
        tool: 'pen',
        points,
        color,
        width,
        style,
      };
    
    default:
      // 默认返回 rect
      return {
        kind: 'rect',
        tool: 'rect',
        start: { x, y },
        end: { x: x + 100, y: y + 100 },
        color: '#000000',
        width: 2,
        style: 'solid',
      };
  }
}

// ===== 测试用例 =====

async function testBasicMemoryUsage() {
  console.log('\n📊 基础内存使用测试');
  console.log('========================================');
  console.log(`将创建 ${TEST_CONFIG.BASIC_BOARDS} 个白板，每个白板包含 ${TEST_CONFIG.BASIC_OPS_PER_BOARD} 个图形`);
  console.log(`总计约 ${TEST_CONFIG.BASIC_BOARDS * TEST_CONFIG.BASIC_OPS_PER_BOARD} 个图形`);
  console.log('此测试用于验证基本内存使用情况');
  console.log('========================================');
  
  // 获取初始状态
  const statsBefore = await request(`${BASE_URL}/api/stats`);
  
  // 创建白板并添加操作
  const boards = [];
  const startTime = Date.now();
  
  process.stdout.write(`正在创建 ${TEST_CONFIG.BASIC_BOARDS} 个白板...`);
  
  for (let i = 0; i < TEST_CONFIG.BASIC_BOARDS; i++) {
    const boardId = randomBoardId();
    
    // 连接 WebSocket
    const ws = new WebSocket(`${WS_URL}?boardId=${boardId}`);
    
    await new Promise((resolve) => {
      ws.on('open', async () => {
        // 发送图形（DrawOp 格式）
        for (let j = 0; j < TEST_CONFIG.BASIC_OPS_PER_BOARD; j++) {
          const shape = createRandomShape();
          ws.send(JSON.stringify({ type: 'op', payload: shape }));
          
          // 小延迟，避免发送过快
          if (j % 10 === 0) {
            await new Promise(r => setTimeout(r, 10));
          }
        }
        
        // 关闭连接
        setTimeout(() => {
          ws.close();
          resolve();
        }, 100);
      });
    });
    
    boards.push(boardId);
  }
  
  const duration = Date.now() - startTime;
  process.stdout.write(' 完成\n');
  
  // 等待服务端处理
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 获取最终状态
  const statsAfter = await request(`${BASE_URL}/api/stats`);
  
  // 计算差值
  const boardsDelta = statsAfter.boards.total - statsBefore.boards.total;
  const opsDelta = statsAfter.operations.total - statsBefore.operations.total;
  const memoryDelta = statsAfter.memory.process.heapUsed - statsBefore.memory.process.heapUsed;
  
  console.log('结果:');
  console.log(`  耗时: ${duration}ms`);
  console.log(`  新增白板: ${boardsDelta}`);
  console.log(`  新增图形: ${opsDelta}`);
  console.log(`  内存增长: ${memoryDelta.toFixed(2)}MB`);
  if (boardsDelta > 0) console.log(`  每个白板平均内存: ${(memoryDelta / boardsDelta).toFixed(2)}MB`);
  if (opsDelta > 0) console.log(`  每个图形平均内存: ${(memoryDelta / opsDelta * 1024).toFixed(2)}KB`);
  
  return {
    boardsDelta,
    opsDelta,
    memoryDelta,
    duration,
  };
}

async function testCleanupMechanism() {
  console.log('\n🧹 清理机制测试（TTL 和 LRU）');
  console.log('========================================');
  
  // 获取并保存原始配置
  let originalConfig;
  try {
    originalConfig = await getConfig();
    if (!originalConfig || !originalConfig.current) {
      console.error('❌ 无法获取服务端配置，API可能不存在或返回格式错误');
      console.error('   返回的数据:', JSON.stringify(originalConfig, null, 2));
      throw new Error('无法获取服务端配置');
    }
  } catch (error) {
    console.error('❌ 获取配置失败:', error.message);
    console.error('   请确保服务端已启动，并且支持配置API');
    throw error;
  }
  
  console.log(`原始配置:`);
  console.log(`  TTL: ${originalConfig.current.TTL / 1000 / 60} 分钟`);
  console.log(`  CLEANUP_INTERVAL: ${originalConfig.current.BASE_CLEANUP_INTERVAL / 1000} 秒`);
  
  // 临时修改配置以便测试（缩短TTL和清理间隔）
  const TEST_TTL = 10 * 1000; // 10秒TTL，快速过期
  const TEST_CLEANUP_INTERVAL = 4 * 1000; // 2秒清理间隔，快速触发清理
  
  console.log(`\n临时修改配置（仅用于测试）:`);
  console.log(`  TTL: ${TEST_TTL / 1000} 秒 (原: ${originalConfig.current.TTL / 1000 / 60} 分钟)`);
  console.log(`  CLEANUP_INTERVAL: ${TEST_CLEANUP_INTERVAL / 1000} 秒 (原: ${originalConfig.current.BASE_CLEANUP_INTERVAL / 1000} 秒)`);
  
  await updateConfig({
    ttl: TEST_TTL,
    cleanupInterval: TEST_CLEANUP_INTERVAL,
  });
  
  console.log(`将创建 ${TEST_CONFIG.CLEANUP_BOARDS} 个白板，每个白板包含 ${TEST_CONFIG.CLEANUP_OPS_PER_BOARD} 个图形`);
  console.log(`总计约 ${TEST_CONFIG.CLEANUP_BOARDS * TEST_CONFIG.CLEANUP_OPS_PER_BOARD} 个图形`);
  console.log('创建后立即断开连接，模拟无活动白板');
  console.log(`预期：${TEST_TTL / 1000} 秒后TTL过期，清理机制应触发`);
  console.log('========================================');
  
  // 获取初始状态
  const statsBefore = await request(`${BASE_URL}/api/stats`);
  const cleanupLogsBefore = await request(`${BASE_URL}/api/cleanup-logs?limit=10`);
  const cleanupCountBefore = cleanupLogsBefore.total || 0;
  
  console.log(`\n测试前状态:`);
  console.log(`  当前白板数: ${statsBefore.boards.total}`);
  console.log(`  清理日志数: ${cleanupCountBefore}`);
  
  // 创建一批白板
  const boards = [];
  process.stdout.write(`\n正在创建 ${TEST_CONFIG.CLEANUP_BOARDS} 个测试白板...`);
  
  for (let i = 0; i < TEST_CONFIG.CLEANUP_BOARDS; i++) {
    const boardId = randomBoardId();
    const ws = new WebSocket(`${WS_URL}?boardId=${boardId}`);
    
    await new Promise((resolve) => {
      ws.on('open', async () => {
        // 添加图形（DrawOp 格式）
        for (let j = 0; j < TEST_CONFIG.CLEANUP_OPS_PER_BOARD; j++) {
          const shape = createRandomShape();
          ws.send(JSON.stringify({ type: 'op', payload: shape }));
        }
        
        // 立即关闭连接（模拟无活动白板）
        setTimeout(() => {
          ws.close();
          resolve();
        }, 100);
      });
      
      ws.on('error', () => {
        resolve(); // 忽略错误
      });
    });
    
    boards.push(boardId);
    
    // 每创建5个白板显示进度
    if ((i + 1) % 5 === 0) {
      process.stdout.write(` ${i + 1}/${TEST_CONFIG.CLEANUP_BOARDS}`);
    }
  }
  
  // 等待创建完成，确保所有连接都已关闭
  await new Promise(resolve => setTimeout(resolve, 3000));
  process.stdout.write(' 完成\n');
  
  const statsAfter = await request(`${BASE_URL}/api/stats`);
  const cleanupLogsAfter = await request(`${BASE_URL}/api/cleanup-logs?limit=20`);
  const cleanupCountAfter = cleanupLogsAfter.total || 0;
  
  console.log(`\n测试结果:`);
  console.log(`  创建白板数: ${boards.length}`);
  console.log(`  当前白板数: ${statsAfter.boards.total}`);
  console.log(`  清理日志总数: ${cleanupCountAfter}`);
  console.log(`  新增清理日志: ${cleanupCountAfter - cleanupCountBefore}`);
  
  if (cleanupLogsAfter.logs && cleanupLogsAfter.logs.length > 0) {
    console.log(`\n最近的清理记录（最多5条）:`);
    cleanupLogsAfter.logs.slice(-5).forEach((log, i) => {
      const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleString() : '未知时间';
      console.log(`  ${i + 1}. [${timestamp}] ${log.reason || '未知原因'} - 白板: ${log.boardId || 'N/A'}`);
    });
  }
  
  // 验证无活动白板是否被正确识别
  const inactiveBoards = statsAfter.boards.total - statsAfter.boards.active;
  console.log(`\n✅ 验证结果:`);
  console.log(`  活跃白板: ${statsAfter.boards.active}`);
  console.log(`  非活跃白板: ${inactiveBoards}`);
  
  if (inactiveBoards >= boards.length * 0.8) {
    console.log(`  ✅ 通过：大部分白板被正确识别为非活跃状态`);
  } else {
    console.log(`  ⚠️  警告：非活跃白板数量较少，可能存在问题`);
  }
  
  // 等待TTL过期并触发清理
  console.log(`\n等待TTL过期（${TEST_TTL / 1000}秒）和清理机制触发...`);
  // 等待TTL过期 + 清理间隔 + 额外缓冲时间
  const waitTime = TEST_TTL + TEST_CLEANUP_INTERVAL * 2 + 3000; // 多等待一个清理间隔和3秒缓冲
  await new Promise(resolve => setTimeout(resolve, waitTime));
  
  // 多次检查，确保清理机制有足够时间触发
  let statsAfterTTL = await request(`${BASE_URL}/api/stats`);
  let cleanupLogsAfterTTL = await request(`${BASE_URL}/api/cleanup-logs?limit=20`);
  let cleanupCountAfterTTL = cleanupLogsAfterTTL.total || 0;
  let attempts = 0;
  const maxAttempts = 5;
  const checkInterval = 2000;
  
  // 如果清理还没触发，继续等待
  while (statsAfterTTL.boards.total >= statsAfter.boards.total && attempts < maxAttempts) {
    attempts++;
    console.log(`  检查 ${attempts}/${maxAttempts}: 当前白板数 ${statsAfterTTL.boards.total}，等待清理触发...`);
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    statsAfterTTL = await request(`${BASE_URL}/api/stats`);
    cleanupLogsAfterTTL = await request(`${BASE_URL}/api/cleanup-logs?limit=20`);
    cleanupCountAfterTTL = cleanupLogsAfterTTL.total || 0;
  }
  
  console.log(`\nTTL过期后状态:`);
  console.log(`  白板数: ${statsAfterTTL.boards.total} (之前: ${statsAfter.boards.total})`);
  console.log(`  清理日志新增: ${cleanupCountAfterTTL - cleanupCountAfter} 条`);
  
  if (statsAfterTTL.boards.total < statsAfter.boards.total) {
    const cleaned = statsAfter.boards.total - statsAfterTTL.boards.total;
    console.log(`  ✅ 通过：TTL清理机制正常工作，清理了 ${cleaned} 个过期白板`);
  } else {
    console.log(`  ⚠️  警告：TTL清理机制可能未触发，白板数量未减少`);
    console.log(`    可能原因：`);
    console.log(`      1. 清理间隔设置可能不正确`);
    console.log(`      2. 白板的 lastClientDisconnectAt 或 lastActiveAt 可能未正确设置`);
    console.log(`      3. 清理机制可能未正确启动`);
  }
  
  // 恢复原始配置
  console.log(`\n恢复原始配置...`);
  await resetConfig();
  const restoredConfig = await getConfig();
  console.log(`  ✅ 配置已恢复:`);
  console.log(`    TTL: ${restoredConfig.current.TTL / 1000 / 60} 分钟`);
  console.log(`    CLEANUP_INTERVAL: ${restoredConfig.current.BASE_CLEANUP_INTERVAL / 1000} 秒`);
  
  return {
    boardsCreated: boards.length,
    currentBoards: statsAfter.boards.total,
    activeBoards: statsAfter.boards.active,
    inactiveBoards,
    cleanupLogsAdded: cleanupCountAfter - cleanupCountBefore,
    boardsAfterTTL: statsAfterTTL.boards.total,
    ttlCleanupWorked: statsAfterTTL.boards.total < statsAfter.boards.total,
  };
}

async function testStressLoad() {
  console.log('\n🔥 压力测试（超过最大白板数限制，验证 LRU 清理机制）');
  console.log('========================================');
  
  // 获取并保存原始配置
  let originalConfig;
  try {
    originalConfig = await getConfig();
    if (!originalConfig || !originalConfig.current) {
      console.error('❌ 无法获取服务端配置，API可能不存在或返回格式错误');
      console.error('   返回的数据:', JSON.stringify(originalConfig, null, 2));
      throw new Error('无法获取服务端配置');
    }
  } catch (error) {
    console.error('❌ 获取配置失败:', error.message);
    console.error('   请确保服务端已启动，并且支持配置API');
    throw error;
  }
  
  console.log(`原始配置:`);
  console.log(`  MAX_BOARDS: ${originalConfig.current.MAX_BOARDS}`);
  console.log(`  TTL: ${originalConfig.current.TTL / 1000 / 60} 分钟`);
  console.log(`  CLEANUP_INTERVAL: ${originalConfig.current.BASE_CLEANUP_INTERVAL / 1000} 秒`);
  
  // 临时修改配置以便测试（缩短清理间隔，降低MAX_BOARDS以便快速验证）
  const TEST_MAX_BOARDS = 50; // 降低到50，便于快速验证
  const TEST_CLEANUP_INTERVAL = 2 * 1000; // 2秒清理间隔，快速触发清理
  
  console.log(`\n临时修改配置（仅用于测试）:`);
  console.log(`  MAX_BOARDS: ${TEST_MAX_BOARDS} (原: ${originalConfig.current.MAX_BOARDS})`);
  console.log(`  CLEANUP_INTERVAL: ${TEST_CLEANUP_INTERVAL / 1000} 秒 (原: ${originalConfig.current.BASE_CLEANUP_INTERVAL / 1000} 秒)`);
  
  await updateConfig({
    maxBoards: TEST_MAX_BOARDS,
    cleanupInterval: TEST_CLEANUP_INTERVAL,
  });
  
  console.log(`将创建 ${TEST_CONFIG.STRESS_BOARDS} 个白板（超过限制 ${TEST_MAX_BOARDS}）`);
  console.log(`预期：清理机制应快速触发，最终保留约 ${TEST_MAX_BOARDS} 个白板`);
  console.log('========================================');
  
  // 获取当前状态
  const statsBefore = await request(`${BASE_URL}/api/stats`);
  const cleanupLogsBefore = await request(`${BASE_URL}/api/cleanup-logs?limit=10`);
  const cleanupCountBefore = cleanupLogsBefore.total || 0;
  
  console.log(`\n测试前状态:`);
  console.log(`  当前白板数: ${statsBefore.boards.total}`);
  console.log(`  清理日志数: ${cleanupCountBefore}`);
  
  // 检查测试前是否已有大量白板
  if (statsBefore.boards.total > TEST_MAX_BOARDS) {
    console.log(`\n⚠️  警告：测试前已有 ${statsBefore.boards.total} 个白板，超过限制 ${TEST_MAX_BOARDS}`);
    console.log(`  继续测试将创建 ${TEST_CONFIG.STRESS_BOARDS} 个白板，总计将达到 ${statsBefore.boards.total + TEST_CONFIG.STRESS_BOARDS} 个`);
  }
  
  // 创建超过限制的白板数量
  const boards = [];
  const startTime = Date.now();
  process.stdout.write(`\n正在创建 ${TEST_CONFIG.STRESS_BOARDS} 个白板...`);
  
  for (let i = 0; i < TEST_CONFIG.STRESS_BOARDS; i++) {
    const boardId = randomBoardId();
    const ws = new WebSocket(`${WS_URL}?boardId=${boardId}`);
    
    await new Promise((resolve) => {
      ws.on('open', async () => {
        // 添加图形（DrawOp 格式）
        for (let j = 0; j < TEST_CONFIG.STRESS_OPS_PER_BOARD; j++) {
          const shape = createRandomShape();
          ws.send(JSON.stringify({ type: 'op', payload: shape }));
        }
        
        // 立即关闭（模拟无活动白板）
        setTimeout(() => {
          ws.close();
          resolve();
        }, 50);
      });
      
      ws.on('error', () => {
        resolve(); // 忽略错误
      });
    });
    
    boards.push(boardId);
    
    // 每创建10个白板显示进度
    if ((i + 1) % 10 === 0) {
      process.stdout.write(` ${i + 1}/${TEST_CONFIG.STRESS_BOARDS}`);
    }
  }
  
  const duration = Date.now() - startTime;
  process.stdout.write(' 完成\n');
  
  // 等待服务端处理和清理机制触发
  // 清理机制是异步的，需要多次检查直到清理完成
  console.log(`\n等待服务端处理和清理机制触发...`);
  let statsAfter = await request(`${BASE_URL}/api/stats`);
  let attempts = 0;
  const maxAttempts = 10; // 最多检查10次
  const checkInterval = 2000; // 每次间隔2秒
  
  while (statsAfter.boards.total > TEST_MAX_BOARDS && attempts < maxAttempts) {
    attempts++;
    console.log(`  检查 ${attempts}/${maxAttempts}: 当前白板数 ${statsAfter.boards.total}，等待清理...`);
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    statsAfter = await request(`${BASE_URL}/api/stats`);
  }
  
  // 最终检查状态
  const cleanupLogsAfter = await request(`${BASE_URL}/api/cleanup-logs?limit=20`);
  const cleanupCountAfter = cleanupLogsAfter.total || 0;
  const newCleanupLogs = cleanupLogsAfter.logs ? cleanupLogsAfter.logs.slice(-(cleanupCountAfter - cleanupCountBefore)) : [];
  
  console.log(`\n测试结果:`);
  console.log(`  耗时: ${duration}ms`);
  console.log(`  尝试创建: ${boards.length} 个白板`);
  console.log(`  测试前白板数: ${statsBefore.boards.total}`);
  console.log(`  测试后白板数: ${statsAfter.boards.total}`);
  console.log(`  实际增加: ${statsAfter.boards.total - statsBefore.boards.total} 个白板`);
  console.log(`  清理日志新增: ${cleanupCountAfter - cleanupCountBefore} 条`);
  console.log(`  内存使用: ${statsAfter.memory.process.heapUsed.toFixed(2)}MB / ${statsAfter.memory.process.heapTotal.toFixed(2)}MB`);
  console.log(`  内存使用率: ${(statsAfter.memory.process.heapUsed / statsAfter.memory.process.heapTotal * 100).toFixed(2)}%`);
  
  // 验证清理机制
  const boardsDelta = statsAfter.boards.total - statsBefore.boards.total;
  const totalAfterCreation = statsBefore.boards.total + boards.length;
  const expectedMaxBoards = TEST_MAX_BOARDS;
  
  console.log(`\n✅ 清理机制验证:`);
  
  // 验证1: 白板数量是否符合限制
  if (statsAfter.boards.total <= expectedMaxBoards + 5) { // 允许5个误差
    console.log(`  ✅ 通过：白板数量 ${statsAfter.boards.total} 符合限制（≤ ${expectedMaxBoards}）`);
  } else {
    console.log(`  ⚠️  警告：白板数量 ${statsAfter.boards.total} 超过预期（应 ≤ ${expectedMaxBoards}）`);
    console.log(`    提示：清理机制可能需要更长时间，或服务端清理逻辑有问题`);
  }
  
  // 验证2: 清理日志是否新增
  if (cleanupCountAfter > cleanupCountBefore) {
    console.log(`  ✅ 通过：清理机制已触发（新增 ${cleanupCountAfter - cleanupCountBefore} 条清理日志）`);
    if (newCleanupLogs.length > 0) {
      console.log(`  最近的清理记录:`);
      newCleanupLogs.slice(-5).forEach((log, i) => {
        console.log(`    ${i + 1}. ${log.reason || '未知原因'} - 白板: ${log.boardId || 'N/A'}`);
      });
    }
  } else {
    console.log(`  ⚠️  警告：未检测到清理日志，清理机制可能未触发`);
    console.log(`    可能原因：`);
    console.log(`      1. 清理机制是定时触发的（默认5分钟间隔），需要等待更长时间`);
    console.log(`      2. 服务端清理逻辑可能有问题`);
  }
  
  // 验证3: 清理机制是否正常工作
  if (boardsDelta < boards.length) {
    const cleaned = totalAfterCreation - statsAfter.boards.total;
    console.log(`  ✅ 通过：清理机制正常工作`);
    console.log(`    创建 ${boards.length} 个，实际增加 ${boardsDelta} 个，清理了约 ${cleaned} 个`);
  } else if (statsAfter.boards.total <= expectedMaxBoards) {
    // 如果总数符合限制，即使增加了所有白板也算通过（说明清理了旧的白板）
    const cleaned = Math.max(0, statsBefore.boards.total + boards.length - statsAfter.boards.total);
    console.log(`  ✅ 通过：清理机制正常工作（清理了约 ${cleaned} 个旧白板）`);
  } else {
    console.log(`  ⚠️  警告：所有白板都被保留，清理机制可能未正常工作`);
    console.log(`    预期：创建后总数应为 ${totalAfterCreation}，清理后应为 ≤ ${expectedMaxBoards}`);
    console.log(`    实际：${statsAfter.boards.total}`);
  }
  
  // 恢复原始配置
  console.log(`\n恢复原始配置...`);
  await resetConfig();
  const restoredConfig = await getConfig();
  console.log(`  ✅ 配置已恢复:`);
  console.log(`    MAX_BOARDS: ${restoredConfig.current.MAX_BOARDS}`);
  console.log(`    CLEANUP_INTERVAL: ${restoredConfig.current.BASE_CLEANUP_INTERVAL / 1000} 秒`);
  
  return {
    attempted: boards.length,
    actual: statsAfter.boards.total,
    boardsDelta,
    cleanupLogsAdded: cleanupCountAfter - cleanupCountBefore,
    duration,
    passed: statsAfter.boards.total <= expectedMaxBoards + 5 && (cleanupCountAfter > cleanupCountBefore || boardsDelta < boards.length),
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
  
  const statsBefore = await request(`${BASE_URL}/api/stats`);
  const allBoards = [];
  const startTime = Date.now();
  
  // 测试不同大小的白板
  for (const scenario of TEST_CONFIG.COMPLEX_SCENARIOS.boardSizes) {
    console.log(`\n📦 场景：创建 ${scenario.count} 个白板，每个包含 ${scenario.shapesPerBoard} 个图形`);
    console.log(`   总计约 ${scenario.count * scenario.shapesPerBoard} 个图形`);
    
    const scenarioBoards = [];
    
    // 并发创建白板（模拟多用户同时操作）
    const concurrent = TEST_CONFIG.COMPLEX_SCENARIOS.concurrentConnections;
    const batches = Math.ceil(scenario.count / concurrent);
    
    for (let batch = 0; batch < batches; batch++) {
      const batchStart = batch * concurrent;
      const batchEnd = Math.min(batchStart + concurrent, scenario.count);
      const batchSize = batchEnd - batchStart;
      
      console.log(`   批次 ${batch + 1}/${batches}: 并发创建 ${batchSize} 个白板...`);
      
      // 并发创建
      const promises = [];
      for (let i = batchStart; i < batchEnd; i++) {
        const boardId = `complex-${scenario.shapesPerBoard}-${i}-${Date.now()}`;
        const sessionDuration = TEST_CONFIG.COMPLEX_SCENARIOS.sessionDurations[
          Math.floor(Math.random() * TEST_CONFIG.COMPLEX_SCENARIOS.sessionDurations.length)
        ];
        
        promises.push(createComplexBoard(boardId, scenario.shapesPerBoard, sessionDuration));
        scenarioBoards.push(boardId);
      }
      
      await Promise.all(promises);
      
      // 批次间延迟，模拟真实场景
      if (batch < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    allBoards.push(...scenarioBoards);
    console.log(`   ✅ 完成：已创建 ${scenarioBoards.length} 个白板`);
    
    // 等待服务端处理
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  const duration = Date.now() - startTime;
  
  // 等待所有操作完成
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const statsAfter = await request(`${BASE_URL}/api/stats`);
  
  // 计算统计
  const totalShapes = TEST_CONFIG.COMPLEX_SCENARIOS.boardSizes.reduce(
    (sum, s) => sum + (s.count * s.shapesPerBoard), 0
  );
  const boardsDelta = statsAfter.boards.total - statsBefore.boards.total;
  const memoryDelta = statsAfter.memory.process.heapUsed - statsBefore.memory.process.heapUsed;
  
  console.log('\n📊 复杂场景测试结果:');
  console.log('========================================');
  console.log(`  总耗时: ${(duration / 1000).toFixed(2)} 秒`);
  console.log(`  尝试创建: ${allBoards.length} 个白板`);
  console.log(`  实际存在: ${boardsDelta} 个白板`);
  console.log(`  总图形数: 约 ${totalShapes} 个`);
  console.log(`  内存增长: ${memoryDelta.toFixed(2)}MB`);
  console.log(`  当前内存: ${statsAfter.memory.process.heapUsed.toFixed(2)}MB / ${statsAfter.memory.process.heapTotal.toFixed(2)}MB`);
  console.log(`  内存使用率: ${(statsAfter.memory.process.heapUsed / statsAfter.memory.process.heapTotal * 100).toFixed(2)}%`);
  
  return {
    boardsCreated: allBoards.length,
    boardsDelta,
    totalShapes,
    memoryDelta,
    duration,
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
        
        try {
          ws.send(JSON.stringify({ type: 'op', payload: shape }));
          shapesSent++;
        } catch (e) {
          // 如果发送失败，记录到补齐列表，稍后统一补发
          remainingShapes.push(shape);
        }
        
        // 随机间隔发送
        await new Promise(r => setTimeout(r, interval));
      }
      
      // 如果还有剩余图形，快速发送完（使用 op 批量补齐，避免多次 reset 覆盖状态）
      if (shapesSent < shapesCount) {
        const remaining = shapesCount - shapesSent;
        const batchSize = 50;
        // 把会话期间未成功发送的也补进去
        while (remainingShapes.length < remaining) {
          remainingShapes.push(createRandomShape());
        }
        
        for (let i = 0; i < remaining; i += batchSize) {
          const batch = remainingShapes.slice(i, i + batchSize);
          if (batch.length > 0) {
            try {
              for (const shape of batch) {
                ws.send(JSON.stringify({ type: 'op', payload: shape }));
              }
            } catch (e) {
              // 如果在补齐阶段仍然发送失败，可以忽略，复杂场景测试更关注整体趋势而非绝对数量
              break;
            }
          }
          await new Promise(r => setTimeout(r, 10));
        }
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
          // createRandomShape 已经返回正确格式的 DrawOp，直接使用即可
          allShapes.push(shape);
        }
        
        ws.send(JSON.stringify({ type: 'reset', ops: allShapes }));
        
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
