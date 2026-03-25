/**
 * hitTest 性能测试工具
 * 在浏览器控制台中运行此脚本，用于测试空间索引的性能
 */

// 测试配置
const TEST_CONFIG = {
  // 不同规模的测试
  testSizes: [100, 500, 1000, 5000, 10000],
  // 每个规模测试的次数
  iterations: 10,
  // 测试点位置（随机或固定）
  testPoints: [
    { x: 500, y: 400 },
    { x: 1000, y: 800 },
    { x: 1500, y: 1200 },
  ],
};

/**
 * 生成测试图形
 */
function generateTestShapes(count, canvasWidth = 2000, canvasHeight = 1500) {
  const shapes = [];
  const types = ['rect', 'circle', 'triangle', 'diamond', 'arrow'];
  
  for (let i = 0; i < count; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    const x1 = Math.random() * canvasWidth;
    const y1 = Math.random() * canvasHeight;
    const x2 = x1 + (Math.random() - 0.5) * 200;
    const y2 = y1 + (Math.random() - 0.5) * 200;
    
    let shape;
    switch (type) {
      case 'rect':
        shape = {
          kind: 'rect',
          tool: 'rect',
          start: { x: x1, y: y1 },
          end: { x: x2, y: y2 },
          color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
          width: Math.floor(Math.random() * 5) + 1,
          style: 'solid',
        };
        break;
      case 'circle':
        const radius = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        shape = {
          kind: 'circle',
          tool: 'circle',
          center: { x: x1, y: y1 },
          radius: Math.max(10, radius),
          color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
          width: Math.floor(Math.random() * 5) + 1,
          style: 'solid',
        };
        break;
      case 'triangle':
        shape = {
          kind: 'triangle',
          tool: 'triangle',
          start: { x: x1, y: y1 },
          end: { x: x2, y: y2 },
          color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
          width: Math.floor(Math.random() * 5) + 1,
          style: 'solid',
        };
        break;
      case 'diamond':
        shape = {
          kind: 'diamond',
          tool: 'diamond',
          start: { x: x1, y: y1 },
          end: { x: x2, y: y2 },
          color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
          width: Math.floor(Math.random() * 5) + 1,
          style: 'solid',
        };
        break;
      case 'arrow':
        shape = {
          kind: 'arrow',
          tool: 'arrow',
          start: { x: x1, y: y1 },
          end: { x: x2, y: y2 },
          color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
          width: Math.floor(Math.random() * 5) + 1,
          style: 'solid',
        };
        break;
    }
    shapes.push(shape);
  }
  
  return shapes;
}

/**
 * 性能测试函数
 */
function performanceTest(size, point, ops, hitTestFunc) {
  const times = [];
  
  for (let i = 0; i < TEST_CONFIG.iterations; i++) {
    const start = performance.now();
    hitTestFunc(ops, point, 6);
    const end = performance.now();
    times.push(end - start);
  }
  
  return {
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    min: Math.min(...times),
    max: Math.max(...times),
    median: times.sort((a, b) => a - b)[Math.floor(times.length / 2)],
  };
}

/**
 * 运行完整测试套件
 * 需要在浏览器控制台中调用，并且需要访问 Whiteboard 组件的内部状态
 */
async function runHitTestPerformanceTest() {
  console.log('🚀 开始 hitTest 性能测试...\n');
  
  // 检查是否在正确的环境中
  if (typeof window === 'undefined') {
    console.error('❌ 此测试需要在浏览器环境中运行');
    return;
  }
  
  console.log('📋 测试配置：');
  console.log(`   - 测试规模: ${TEST_CONFIG.testSizes.join(', ')}`);
  console.log(`   - 每次测试迭代: ${TEST_CONFIG.iterations} 次`);
  console.log(`   - 测试点数: ${TEST_CONFIG.testPoints.length}\n`);
  
  // 注意：实际测试需要访问 React 组件内部状态
  // 这里提供一个模板，实际使用时需要根据具体情况调整
  console.log('💡 使用说明：');
  console.log('1. 打开浏览器开发者工具（F12）');
  console.log('2. 在控制台中运行此脚本');
  console.log('3. 或者使用 React DevTools 访问组件状态');
  console.log('4. 手动调用测试函数\n');
  
  return {
    message: '测试工具已加载，请根据实际情况调用测试函数',
    functions: {
      generateTestShapes,
      performanceTest,
      TEST_CONFIG,
    },
  };
}

// 导出到全局（如果在浏览器环境中）
if (typeof window !== 'undefined') {
  window.hitTestPerformanceTest = {
    run: runHitTestPerformanceTest,
    generateTestShapes,
    performanceTest,
    TEST_CONFIG,
  };
  
  console.log('✅ hitTest 性能测试工具已加载到 window.hitTestPerformanceTest');
  console.log('💡 使用方式：');
  console.log('   window.hitTestPerformanceTest.run() - 运行测试');
  console.log('   window.hitTestPerformanceTest.generateTestShapes(1000) - 生成测试图形');
}

// 如果在 Node.js 环境中（测试时），直接导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    runHitTestPerformanceTest,
    generateTestShapes,
    performanceTest,
    TEST_CONFIG,
  };
}

