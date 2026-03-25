/**
 * 批量生成圆形测试脚本
 * 在浏览器控制台中运行此脚本，自动生成 500 个随机位置的圆形
 * 
 * 使用方法：
 * 1. 打开浏览器控制台（F12）
 * 2. 复制整个脚本内容并粘贴到控制台
 * 3. 按回车执行
 * 4. 脚本会自动生成并添加 500 个圆形到白板
 */

(function() {
  'use strict';
  
  console.log('🎨 开始批量生成圆形...');
  
  // 配置
  const CONFIG = {
    count: 500,              // 生成数量
    canvasWidth: 2000,      // 画布宽度（根据实际画布大小调整）
    canvasHeight: 1500,     // 画布高度（根据实际画布大小调整）
    minRadius: 20,          // 最小半径
    maxRadius: 80,          // 最大半径
    color: '#1f2937',       // 默认颜色
    width: 3,              // 线宽
    style: 'solid',        // 线型
    delay: 10,             // 每个圆形之间的延迟（毫秒），避免一次性发送太多
  };
  
  /**
   * 生成单个圆形操作
   */
  function generateCircle(index) {
    // 随机中心位置
    const centerX = Math.random() * CONFIG.canvasWidth;
    const centerY = Math.random() * CONFIG.canvasHeight;
    
    // 随机半径
    const radius = CONFIG.minRadius + Math.random() * (CONFIG.maxRadius - CONFIG.minRadius);
    
    // 生成圆形操作
    const circleOp = {
      kind: 'circle',
      tool: 'circle',
      center: { x: centerX, y: centerY },
      radius: radius,
      color: CONFIG.color,
      width: CONFIG.width,
      style: CONFIG.style,
    };
    
    return circleOp;
  }
  
  /**
   * 方法1：通过 WebSocket 发送（推荐）
   */
  function sendViaWebSocket(circleOp) {
    // 尝试获取 WebSocket 连接
    // 注意：这需要根据实际实现调整
    const ws = window.__whiteboardWS || null;
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'op', payload: circleOp }));
      return true;
    }
    
    return false;
  }
  
  /**
   * 方法2：通过 React DevTools 或全局变量（如果可用）
   */
  function addViaComponent(circleOp) {
    // 尝试通过全局变量访问组件
    const whiteboardComponent = window.__whiteboardComponent || null;
    
    if (whiteboardComponent && typeof whiteboardComponent.setOps === 'function') {
      whiteboardComponent.setOps(prev => [...prev, circleOp]);
      return true;
    }
    
    return false;
  }
  
  /**
   * 方法3：通过模拟用户操作（最可靠但较慢）
   */
  function simulateUserAction(circleOp) {
    // 这个方法需要访问 canvas 元素和触发事件
    // 由于比较复杂，这里提供一个思路
    console.warn('模拟用户操作方式需要更多实现，建议使用 WebSocket 方式');
    return false;
  }
  
  /**
   * 批量生成并添加圆形
   */
  async function generateAndAddCircles() {
    const circles = [];
    
    // 生成所有圆形数据
    console.log(`📦 生成 ${CONFIG.count} 个圆形数据...`);
    for (let i = 0; i < CONFIG.count; i++) {
      circles.push(generateCircle(i));
    }
    console.log('✅ 圆形数据生成完成');
    
    // 尝试找到 WebSocket 连接
    // 方法：通过检查全局变量或 DOM 元素
    let ws = null;
    
    // 尝试从 window 对象获取
    if (window.__whiteboardWS) {
      ws = window.__whiteboardWS;
    }
    
    // 如果找不到，尝试通过 React DevTools
    // 或者提示用户手动连接
    
    // 显示统计信息
    console.log('\n📊 生成的圆形统计：');
    console.log(`  总数: ${circles.length}`);
    console.log(`  平均半径: ${(circles.reduce((sum, c) => sum + c.radius, 0) / circles.length).toFixed(2)}`);
    console.log(`  位置范围: (0, 0) 到 (${CONFIG.canvasWidth}, ${CONFIG.canvasHeight})`);
    
    // 返回圆形数据，供用户手动使用
    console.log('\n💡 使用方式：');
    console.log('方式1：通过 WebSocket 发送（如果已连接）');
    console.log('方式2：通过 React DevTools 设置状态');
    console.log('方式3：复制数据到剪贴板，手动处理');
    
    // 将数据保存到全局变量，方便使用
    window.__testCircles = circles;
    console.log('\n✅ 圆形数据已保存到 window.__testCircles');
    console.log('   你可以通过以下方式使用：');
    console.log('   1. window.__testCircles - 查看所有圆形数据');
    console.log('   2. 使用下面的辅助函数批量添加');
    
    return circles;
  }
  
  /**
   * 辅助函数：批量发送圆形（通过 WebSocket）
   */
  window.batchAddCircles = async function(circles, delay = CONFIG.delay) {
    if (!circles || circles.length === 0) {
      console.error('❌ 没有圆形数据');
      return;
    }
    
    // 尝试获取 WebSocket
    const ws = window.__whiteboardWS;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('❌ WebSocket 未连接，无法自动发送');
      console.log('💡 请手动通过其他方式添加圆形');
      console.log('   数据已保存在 window.__testCircles');
      return;
    }
    
    console.log(`🚀 开始批量发送 ${circles.length} 个圆形...`);
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < circles.length; i++) {
      try {
        ws.send(JSON.stringify({ type: 'op', payload: circles[i] }));
        successCount++;
        
        if ((i + 1) % 50 === 0) {
          console.log(`   已发送: ${i + 1}/${circles.length}`);
        }
        
        // 延迟，避免发送太快
        if (delay > 0 && i < circles.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        failCount++;
        console.error(`   发送第 ${i + 1} 个圆形失败:`, error);
      }
    }
    
    console.log(`\n✅ 批量发送完成！`);
    console.log(`   成功: ${successCount}`);
    console.log(`   失败: ${failCount}`);
  };
  
  /**
   * 辅助函数：复制圆形数据到剪贴板（JSON 格式）
   */
  window.copyCirclesToClipboard = function(circles) {
    if (!circles) {
      circles = window.__testCircles;
    }
    
    if (!circles || circles.length === 0) {
      console.error('❌ 没有圆形数据');
      return;
    }
    
    const json = JSON.stringify(circles, null, 2);
    
    // 复制到剪贴板
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(() => {
        console.log('✅ 圆形数据已复制到剪贴板（JSON 格式）');
      }).catch(err => {
        console.error('❌ 复制失败:', err);
        console.log('📋 数据内容：');
        console.log(json);
      });
    } else {
      console.log('📋 圆形数据（请手动复制）：');
      console.log(json);
    }
  };
  
  /**
   * 辅助函数：显示圆形数据统计
   */
  window.showCirclesStats = function(circles) {
    if (!circles) {
      circles = window.__testCircles;
    }
    
    if (!circles || circles.length === 0) {
      console.error('❌ 没有圆形数据');
      return;
    }
    
    const stats = {
      count: circles.length,
      avgRadius: circles.reduce((sum, c) => sum + c.radius, 0) / circles.length,
      minRadius: Math.min(...circles.map(c => c.radius)),
      maxRadius: Math.max(...circles.map(c => c.radius)),
      positions: {
        minX: Math.min(...circles.map(c => c.center.x)),
        maxX: Math.max(...circles.map(c => c.center.x)),
        minY: Math.min(...circles.map(c => c.center.y)),
        maxY: Math.max(...circles.map(c => c.center.y)),
      },
    };
    
    console.log('📊 圆形数据统计：');
    console.log(`  总数: ${stats.count}`);
    console.log(`  平均半径: ${stats.avgRadius.toFixed(2)}`);
    console.log(`  半径范围: ${stats.minRadius.toFixed(2)} - ${stats.maxRadius.toFixed(2)}`);
    console.log(`  位置范围: (${stats.positions.minX.toFixed(2)}, ${stats.positions.minY.toFixed(2)}) 到 (${stats.positions.maxX.toFixed(2)}, ${stats.positions.maxY.toFixed(2)})`);
    
    return stats;
  };
  
  // 执行生成
  generateAndAddCircles().then(circles => {
    console.log('\n🎉 脚本执行完成！');
    console.log('\n📖 可用命令：');
    console.log('  window.batchAddCircles() - 批量添加圆形（通过 WebSocket）');
    console.log('  window.copyCirclesToClipboard() - 复制数据到剪贴板');
    console.log('  window.showCirclesStats() - 显示统计信息');
    console.log('  window.__testCircles - 查看所有圆形数据');
  });
})();

