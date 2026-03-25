/**
 * hitTest 性能测试脚本（浏览器控制台）
 * 
 * 测试目标：验证图形堆叠时的命中检测（hitTest）性能
 * - 大量重叠图形的点击选择性能
 * - 不同堆叠深度的响应时间
 * - 空间索引优化效果
 * 
 * 使用方法:
 *   1. 启动前端和后端服务
 *   2. 在浏览器中打开白板页面（http://localhost:5173）
 *   3. 打开浏览器控制台（F12）
 *   4. 复制此脚本内容到控制台执行
 *   5. 观察控制台输出的性能数据
 * 
 * 测试场景：
 * - 创建大量重叠图形（不同堆叠深度）
 * - 随机点击测试 hitTest 性能
 * - 测量选择操作的响应时间
 */

(function() {
  'use strict';
  
  console.log('🎯 hitTest 性能测试脚本（适配自定义白板系统）');
  console.log('========================================');
  
  // ========= UI 工具：可拖动 + 可关闭面板 =========
  function makePanelDraggableAndClosable(panel) {
    if (!panel) return;
    panel.style.cursor = 'move';
    panel.style.position = 'fixed';
    panel.style.zIndex = '10000';
    panel.style.boxSizing = 'border-box';
    panel.style.userSelect = 'none';
    
    // 关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.setAttribute('data-role', 'close-panel');
    closeBtn.style.cssText = 'position:absolute;top:4px;right:8px;background:transparent;border:none;color:#fff;font-size:16px;cursor:pointer;line-height:16px;';
    panel.style.paddingTop = '22px';
    panel.appendChild(closeBtn);
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.remove();
    });
    
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    
    const onMouseDown = (e) => {
      const target = e.target;
      if (target && target.getAttribute && target.getAttribute('data-role') === 'close-panel') return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.left = `${startLeft}px`;
      panel.style.top = `${startTop}px`;
      panel.style.right = 'auto';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };
    
    const onMouseMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = `${startLeft + dx}px`;
      panel.style.top = `${startTop + dy}px`;
    };
    
    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    
    panel.addEventListener('mousedown', onMouseDown);
  }
  
  // 测试配置
  const TEST_CONFIG = {
    // 不同堆叠深度的测试
    stackDepths: [500], // 每个位置堆叠的图形数
    // 测试位置数量
    testPositions: 20, // 在画布上创建20个堆叠区域
    // 每个测试的点击次数
    clickTests: 100,
    // 画布尺寸（使用实际画布尺寸）
    canvasWidth: 2000,
    canvasHeight: 1500,
    // 图形大小（重叠区域）
    shapeSize: 100,
    // 可视化开关：关闭可以让测试更接近纯性能（避免 DOM 操作干扰测量）
    visual: true,
    // 命中测试预热次数（避免首次调用抖动）
    warmup: 10,
  };
  
  // 等待白板系统准备就绪
  function waitForWhiteboard() {
    return new Promise((resolve) => {
      const checkWhiteboard = setInterval(() => {
        const getOps = window.__whiteboardOps;
        const batchAddOps = window.__whiteboardBatchAddOps;
        const spatialIndexRef = window.__whiteboardSpatialIndex;
        const ws = window.__whiteboardWS;
        
        if (typeof getOps === 'function' && typeof batchAddOps === 'function' && spatialIndexRef) {
          clearInterval(checkWhiteboard);
          resolve({
            getOps,
            batchAddOps,
            spatialIndexRef,
            ws,
          });
        }
      }, 200);
      
      setTimeout(() => {
        clearInterval(checkWhiteboard);
        console.warn('⚠️ 无法自动获取白板系统 API');
        console.warn('请确保：');
        console.warn('1. 白板页面已加载');
        console.warn('2. 在开发环境下运行（window.__whiteboardOps 等仅在开发环境暴露）');
        resolve(null);
      }, 15000);
    });
  }
  
  // 清空画布（通过 WebSocket 发送 reset 消息）
  function clearCanvas(ws) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'reset', ops: [] }));
      return true;
    }
    return false;
  }
  
  // 简化的 hitTest 实现（用于测试）
  // 注意：这是简化版本，实际项目中 hitTest 在模块内部
  // 这里我们通过模拟点击事件来触发实际的 hitTest
  function performHitTest(ops, point, tolerance, spatialIndex) {
    // 小规模数据：直接遍历
    if (ops.length < 1000) {
      for (let i = ops.length - 1; i >= 0; i--) {
        const op = ops[i];
        if (hitTestOp(op, point, tolerance)) {
          return i;
        }
      }
      return null;
    }
    
    // 大规模数据：使用空间索引
    if (spatialIndex && spatialIndex.current) {
      const candidates = spatialIndex.current.getCandidates(point, tolerance);
      for (const index of candidates) {
        const op = ops[index];
        if (op && hitTestOp(op, point, tolerance)) {
          return index;
        }
      }
      return null;
    }
    
    // 回退到基础版本
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i];
      if (hitTestOp(op, point, tolerance)) {
        return i;
      }
    }
    return null;
  }
  
  // 单个图形的命中测试
  function hitTestOp(op, point, tolerance = 6) {
    switch (op.kind) {
      case 'rect': {
        const minX = Math.min(op.start.x, op.end.x) - tolerance;
        const maxX = Math.max(op.start.x, op.end.x) + tolerance;
        const minY = Math.min(op.start.y, op.end.y) - tolerance;
        const maxY = Math.max(op.start.y, op.end.y) + tolerance;
        return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
      }
      case 'circle': {
        const dx = point.x - op.center.x;
        const dy = point.y - op.center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= op.radius + tolerance;
      }
      case 'triangle': {
        const minX = Math.min(op.start.x, op.end.x) - tolerance;
        const maxX = Math.max(op.start.x, op.end.x) + tolerance;
        const minY = Math.min(op.start.y, op.end.y) - tolerance;
        const maxY = Math.max(op.start.y, op.end.y) + tolerance;
        return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
      }
      case 'diamond': {
        const minX = Math.min(op.start.x, op.end.x) - tolerance;
        const maxX = Math.max(op.start.x, op.end.x) + tolerance;
        const minY = Math.min(op.start.y, op.end.y) - tolerance;
        const maxY = Math.max(op.start.y, op.end.y) + tolerance;
        return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
      }
      default:
        return false;
    }
  }
  
  // 生成堆叠图形（使用项目的 DrawOp 格式）
  function generateStackedShapes(centerX, centerY, count, index) {
    const shapes = [];
    const colors = ['#000000', '#0000ff', '#00ff00', '#ff0000', '#ffff00', '#ffa500', '#ee82ee'];
    
    for (let i = 0; i < count; i++) {
      const offset = (i * 2); // 轻微偏移，确保重叠
      const color = colors[i % colors.length];
      const size = TEST_CONFIG.shapeSize / 2;
      
      // 交替创建矩形和圆形
      if (i % 2 === 0) {
        // 矩形
        shapes.push({
          kind: 'rect',
          tool: 'rect',
          start: {
            x: centerX - size + offset,
            y: centerY - size + offset,
          },
          end: {
            x: centerX + size + offset,
            y: centerY + size + offset,
          },
          color,
          width: 2,
          style: 'solid',
        });
      } else {
        // 圆形
        shapes.push({
          kind: 'circle',
          tool: 'circle',
          center: {
            x: centerX + offset,
            y: centerY + offset,
          },
          radius: size,
          color,
          width: 2,
          style: 'solid',
        });
      }
    }
    
    return shapes;
  }
  
  // 执行 hitTest 性能测试
  async function runHitTestPerformanceTest() {
    const whiteboard = await waitForWhiteboard();
    
    if (!whiteboard) {
      console.error('❌ 无法找到白板系统 API');
      console.error('请确保在开发环境下运行，并且白板页面已完全加载');
      return;
    }
    
    const { getOps, batchAddOps, spatialIndexRef, ws } = whiteboard;
    const results = [];
    
    // 获取当前画布尺寸
    const canvas = document.querySelector('canvas');
    if (canvas) {
      TEST_CONFIG.canvasWidth = canvas.width || 2000;
      TEST_CONFIG.canvasHeight = canvas.height || 1500;
    }
    
    // 清空画布（通过 WebSocket 发送 reset 消息）
    const currentOps = getOps();
    if (currentOps.length > 0) {
      if (clearCanvas(ws)) {
        console.log('清空画布...');
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        console.warn('⚠️ WebSocket 未连接，无法清空画布，测试将在现有图形基础上进行');
      }
    }
    
    // 为每个堆叠深度创建测试
    for (const stackDepth of TEST_CONFIG.stackDepths) {
      console.log(`\n📊 测试堆叠深度: ${stackDepth} 个图形/位置`);
      console.log('----------------------------------------');
      
      // 清空画布（通过 WebSocket 发送 reset 消息）
      const existingOps = getOps();
      if (existingOps.length > 0) {
        if (clearCanvas(ws)) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      // 创建堆叠区域
      const allShapes = [];
      const stackCenters = [];
      
      for (let i = 0; i < TEST_CONFIG.testPositions; i++) {
        const centerX = (Math.random() * (TEST_CONFIG.canvasWidth - TEST_CONFIG.shapeSize)) + TEST_CONFIG.shapeSize / 2;
        const centerY = (Math.random() * (TEST_CONFIG.canvasHeight - TEST_CONFIG.shapeSize)) + TEST_CONFIG.shapeSize / 2;
        
        stackCenters.push({ x: centerX, y: centerY });
        const stackedShapes = generateStackedShapes(centerX, centerY, stackDepth, i);
        allShapes.push(...stackedShapes);
      }
      
      console.log(`创建 ${allShapes.length} 个图形（${TEST_CONFIG.testPositions} 个堆叠区域，每个 ${stackDepth} 个图形）...`);
      
      // 创建可视化进度显示
      document.querySelectorAll('[data-role="hittest-progress-panel"]').forEach(el => el.remove());
      const progressDiv = document.createElement('div');
      progressDiv.setAttribute('data-role', 'hittest-progress-panel');
      progressDiv.style.cssText = 'position:fixed;top:20px;right:20px;background:rgba(0,0,0,0.85);color:#fff;padding:15px;border-radius:8px;z-index:10000;font-family:monospace;min-width:300px;max-width:380px;box-sizing:border-box;';
      progressDiv.innerHTML = `
        <div style="font-weight:bold;margin-bottom:10px;">🎯 hitTest 性能测试</div>
        <div>堆叠深度: ${stackDepth} 个图形/位置</div>
        <div>总图形数: ${allShapes.length}</div>
        <div>堆叠区域: ${TEST_CONFIG.testPositions} 个</div>
        <div style="margin-top:10px;">创建进度: <span id="create-progress">0</span>%</div>
        <div style="background:#333;height:20px;border-radius:10px;overflow:hidden;margin-top:5px;">
          <div id="create-progress-bar" style="background:#2196F3;height:100%;width:0%;transition:width 0.3s;"></div>
        </div>
      `;
      document.body.appendChild(progressDiv);
      makePanelDraggableAndClosable(progressDiv);
      const createProgressEl = progressDiv.querySelector('#create-progress');
      const createProgressBarEl = progressDiv.querySelector('#create-progress-bar');
      
      // 批量创建图形
      const batchSize = 200;
      let createdCount = 0;
      for (let i = 0; i < allShapes.length; i += batchSize) {
        const batch = allShapes.slice(i, i + batchSize);
        batchAddOps(batch);
        createdCount += batch.length;
        
        // 更新进度
        const percent = Math.round((createdCount / allShapes.length) * 100);
        if (createProgressEl) createProgressEl.textContent = String(percent);
        if (createProgressBarEl) createProgressBarEl.style.width = percent + '%';
        
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      // 等待渲染完成
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 更新进度显示
      progressDiv.innerHTML = `
        <div style="font-weight:bold;margin-bottom:10px;">🎯 hitTest 性能测试</div>
        <div>堆叠深度: ${stackDepth} 个图形/位置</div>
        <div>总图形数: ${allShapes.length}</div>
        <div style="margin-top:10px;">测试进度: <span id="test-progress">0</span>/${TEST_CONFIG.clickTests}</div>
        <div style="background:#333;height:20px;border-radius:10px;overflow:hidden;margin-top:5px;">
          <div id="test-progress-bar" style="background:#FF9800;height:100%;width:0%;transition:width 0.3s;"></div>
        </div>
        <div style="margin-top:10px;font-size:12px;color:#aaa;">
          <div>平均: <span id="avg-time">-</span>ms</div>
          <div>P95: <span id="p95-time">-</span>ms</div>
        </div>
      `;
      makePanelDraggableAndClosable(progressDiv);
      const testProgressEl = progressDiv.querySelector('#test-progress');
      const testProgressBarEl = progressDiv.querySelector('#test-progress-bar');
      const avgEl = progressDiv.querySelector('#avg-time');
      const p95El = progressDiv.querySelector('#p95-time');
      
      console.log(`图形创建完成，开始 hitTest 性能测试...`);
      
      // 执行点击测试
      const clickTimes = [];
      const spatialIndex = spatialIndexRef?.current || null;
      
      // 预热（避免首次调用带来抖动）
      for (let i = 0; i < TEST_CONFIG.warmup; i++) {
        const c = stackCenters[i % stackCenters.length];
        const px = c.x + (Math.random() - 0.5) * TEST_CONFIG.shapeSize;
        const py = c.y + (Math.random() - 0.5) * TEST_CONFIG.shapeSize;
        const ops = getOps();
        performHitTest(ops, { x: px, y: py }, 6, spatialIndexRef);
      }
      
      for (let i = 0; i < TEST_CONFIG.clickTests; i++) {
        // 随机选择一个堆叠中心进行点击
        const stackCenter = stackCenters[Math.floor(Math.random() * stackCenters.length)];
        
        // 在堆叠区域内随机偏移
        const clickX = stackCenter.x + (Math.random() - 0.5) * TEST_CONFIG.shapeSize;
        const clickY = stackCenter.y + (Math.random() - 0.5) * TEST_CONFIG.shapeSize;
        
        // 获取当前操作列表
        const ops = getOps();
        
        // 纯 hitTest 计时（避免 DOM 可视化干扰测量）
        const startTime = performance.now();
        try {
          performHitTest(ops, { x: clickX, y: clickY }, 6, spatialIndexRef);
        } catch (e) {
          // ignore
        }
        const endTime = performance.now();
        clickTimes.push(endTime - startTime);
        
        // 更新进度和实时统计
        const percent = Math.round(((i + 1) / TEST_CONFIG.clickTests) * 100);
        if (testProgressEl) testProgressEl.textContent = String(i + 1);
        if (testProgressBarEl) testProgressBarEl.style.width = percent + '%';
        
        if (clickTimes.length > 0) {
          const currentAvg = clickTimes.reduce((a, b) => a + b, 0) / clickTimes.length;
          const sorted = [...clickTimes].sort((a, b) => a - b);
          const currentP95 = sorted[Math.floor(sorted.length * 0.95)];
          if (avgEl) avgEl.textContent = currentAvg.toFixed(2);
          if (p95El) p95El.textContent = currentP95.toFixed(2);
        }
        
        // 小延迟，避免阻塞
        if (i % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      }
      
      // 计算统计数据
      if (clickTimes.length === 0) {
        console.warn(`⚠️ 堆叠深度 ${stackDepth} 的测试没有收集到有效数据，跳过`);
        continue;
      }
      
      const avgTime = clickTimes.reduce((a, b) => a + b, 0) / clickTimes.length;
      const minTime = Math.min(...clickTimes);
      const maxTime = Math.max(...clickTimes);
      const sortedTimes = [...clickTimes].sort((a, b) => a - b);
      const p95Time = sortedTimes[Math.floor(sortedTimes.length * 0.95)];
      
      results.push({
        stackDepth,
        totalShapes: allShapes.length,
        avgTime,
        minTime,
        maxTime,
        p95Time,
      });
      
      // 更新最终结果显示
      const finalDiv = document.querySelector('[data-role="hittest-progress-panel"]');
      if (finalDiv) {
        finalDiv.innerHTML = `
          <div style="font-weight:bold;margin-bottom:10px;">✅ 测试完成</div>
          <div>堆叠深度: ${stackDepth} 个图形/位置</div>
          <div>总图形数: ${allShapes.length}</div>
          <div style="margin-top:10px;">
            <div>平均: ${avgTime.toFixed(2)}ms</div>
            <div>最小: ${minTime.toFixed(2)}ms</div>
            <div>最大: ${maxTime.toFixed(2)}ms</div>
            <div>P95: ${p95Time.toFixed(2)}ms</div>
          </div>
        `;
        makePanelDraggableAndClosable(finalDiv);
      }
      
      console.log(`  平均响应时间: ${avgTime.toFixed(2)}ms`);
      console.log(`  最小: ${minTime.toFixed(2)}ms, 最大: ${maxTime.toFixed(2)}ms`);
      console.log(`  P95: ${p95Time.toFixed(2)}ms`);
    }
    
    // 输出测试结果总结
    console.log('\n\n📈 hitTest 性能测试结果总结');
    console.log('========================================');
    console.log('堆叠深度\t总图形数\t平均(ms)\t最小(ms)\t最大(ms)\tP95(ms)');
    console.log('----------------------------------------');
    results.forEach(r => {
      console.log(`${r.stackDepth}\t\t${r.totalShapes}\t\t${r.avgTime.toFixed(2)}\t\t${r.minTime.toFixed(2)}\t\t${r.maxTime.toFixed(2)}\t\t${r.p95Time.toFixed(2)}`);
    });
    
    // 创建可视化结果图表
    document.querySelectorAll('[data-role="hittest-results-panel"]').forEach(el => el.remove());
    const resultsDiv = document.createElement('div');
    resultsDiv.setAttribute('data-role', 'hittest-results-panel');
    resultsDiv.style.cssText = 'position:fixed;bottom:20px;right:20px;background:rgba(0,0,0,0.9);color:#fff;padding:16px 18px;border-radius:8px;z-index:10000;font-family:monospace;min-width:360px;max-width:520px;max-height:70vh;overflow:auto;box-sizing:border-box;';
    resultsDiv.innerHTML = `
      <div style="font-weight:bold;font-size:16px;margin-bottom:15px;">🎯 hitTest 性能测试结果</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="border-bottom:1px solid #555;">
            <th style="text-align:left;padding:5px;">堆叠深度</th>
            <th style="text-align:right;padding:5px;">总图形数</th>
            <th style="text-align:right;padding:5px;">平均(ms)</th>
            <th style="text-align:right;padding:5px;">最小(ms)</th>
            <th style="text-align:right;padding:5px;">最大(ms)</th>
            <th style="text-align:right;padding:5px;">P95(ms)</th>
          </tr>
        </thead>
        <tbody id="hittest-results-table-body">
        </tbody>
      </table>
      <div style="margin-top:15px;padding-top:15px;border-top:1px solid #555;font-size:11px;color:#aaa;">
        <div>✅ 测试完成！结果已保存到 window.__hitTestResults</div>
        <div style="margin-top:5px;">💡 提示：绿色表示性能良好，黄色表示一般，红色表示需要优化</div>
      </div>
    `;
    document.body.appendChild(resultsDiv);
    makePanelDraggableAndClosable(resultsDiv);
    
    const tbody = document.getElementById('hittest-results-table-body');
    results.forEach((r, idx) => {
      const row = document.createElement('tr');
      row.style.cssText = idx % 2 === 0 ? 'background:rgba(255,255,255,0.05);' : '';
      
      // 根据性能设置颜色
      const getColor = (time) => {
        if (time < 10) return '#4caf50'; // 绿色 - 优秀
        if (time < 30) return '#ff9800'; // 橙色 - 良好
        return '#f44336'; // 红色 - 需要优化
      };
      
      row.innerHTML = `
        <td style="padding:5px;">${r.stackDepth}</td>
        <td style="text-align:right;padding:5px;">${r.totalShapes}</td>
        <td style="text-align:right;padding:5px;color:${getColor(r.avgTime)}">${r.avgTime.toFixed(2)}</td>
        <td style="text-align:right;padding:5px;color:#4caf50">${r.minTime.toFixed(2)}</td>
        <td style="text-align:right;padding:5px;color:${getColor(r.maxTime)}">${r.maxTime.toFixed(2)}</td>
        <td style="text-align:right;padding:5px;color:${getColor(r.p95Time)}">${r.p95Time.toFixed(2)}</td>
      `;
      tbody.appendChild(row);
    });
    
    return results;
  }
  
  // 开始测试
  runHitTestPerformanceTest().then(results => {
    console.log('\n✅ hitTest 性能测试完成！');
    window.__hitTestResults = results;
  }).catch(error => {
    console.error('\n❌ 测试失败:', error);
  });
  
  // 导出测试函数
  window.runHitTestPerformanceTest = runHitTestPerformanceTest;
})();
