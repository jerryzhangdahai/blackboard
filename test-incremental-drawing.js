/**
 * 增量绘制性能测试脚本（浏览器控制台）
 * 
 * 测试目标：验证增量绘制和同步性能
 * - 新增图形时的增量渲染性能
 * - 修改图形时的增量更新性能
 * - WebSocket 增量同步性能
 * - 内存使用情况
 * 
 * 使用方法:
 * 
 * 【发送端（绘制端）】：
 *   1. 启动前端和后端服务
 *   2. 在浏览器中打开白板页面（http://localhost:5173）
 *   3. 打开浏览器控制台（F12）
 *   4. 直接复制此脚本内容到控制台执行（不需要设置任何变量）
 *   5. 脚本会自动开始测试，依次创建 100、500、1000、2000、4000 个图形
 * 
 * 【接收端（同步验证端）】：
 *   1. 打开另一个浏览器窗口/标签，访问同一个白板页面（http://localhost:5173/?boardId=xxx）
 *   2. 打开浏览器控制台（F12）
 *   3. 先执行：window.__INCREMENTAL_TEST_ROLE = 'receiver'
 *   4. 然后复制此脚本内容到控制台执行
 *   5. 接收端会监听绘制端的通知，并在接收完成后自动回复确认
 * 
 * 注意：
 *   - 发送端和接收端必须访问同一个白板（相同的 boardId）
 *   - 接收端会通过控制台输出显示接收进度和确认信息
 *   - 发送端会等待接收端确认后才开始下一轮测试
 */

(function() {
  'use strict';
  
  console.log('🎨 增量绘制性能测试脚本（适配自定义白板系统）');
  console.log('========================================');
  
  // 多窗口通信配置（用于绘制端 / 接收端之间协调轮次）
  const CHANNEL_NAME = 'incremental-drawing-test';
  const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';
  const channel = hasBroadcastChannel ? new BroadcastChannel(CHANNEL_NAME) : null;
  const INSTANCE_ID = Math.random().toString(36).slice(2, 11);
  // 在接收端运行脚本前，可以在控制台先设置 window.__INCREMENTAL_TEST_ROLE = 'receiver'
  const ROLE = (window.__INCREMENTAL_TEST_ROLE === 'receiver') ? 'receiver' : 'sender';
  
  // 测试配置
  const TEST_CONFIG = {
    // 不同规模的测试（调整到最多2000个图形）
    testSizes: [100,1000,4000],
    // 每个规模测试的次数
    iterations: 2,
    // 同步等待时间（毫秒）：主要用于统计和兜底，真正的"等待接收端"由 BroadcastChannel 确认控制
    syncWaitBase: 500,       // 基础等待时间（毫秒）
    syncWaitPerShape: 0.5,   // 每个图形额外等待时间（毫秒）
    // 图形类型分布（使用项目的图形类型）
    shapeTypes: ['rect', 'circle', 'arrow', 'pen'], // pen 对应 stroke
    // 画布尺寸（将在运行时检测）
    canvasWidth: 2000,
    canvasHeight: 1500,
  };
  
  // 通用：让悬浮窗支持拖动和关闭
  function makePanelDraggableAndClosable(panel) {
    if (!panel) return;
    panel.style.cursor = 'move';
    panel.style.position = 'fixed';
    panel.style.top = panel.style.top || '20px';
    panel.style.right = panel.style.right || '20px';
    panel.style.zIndex = '10000';
    panel.style.boxSizing = 'border-box';

    // 注入关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.setAttribute('data-role', 'close-panel');
    closeBtn.style.cssText = 'position:absolute;top:4px;right:8px;background:transparent;border:none;color:#fff;font-size:16px;cursor:pointer;';
    panel.style.position = 'fixed';
    panel.style.paddingTop = '22px';
    panel.appendChild(closeBtn);

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.remove();
    });

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onMouseDown = (e) => {
      // 忽略在 close 按钮上的按下
      const target = e.target;
      if (target && target.getAttribute && target.getAttribute('data-role') === 'close-panel') {
        return;
      }
      isDragging = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      // 拖动时改用 left/top，取消 right 约束
      panel.style.left = `${startLeft}px`;
      panel.style.top = `${startTop}px`;
      panel.style.right = 'auto';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = `${startLeft + dx}px`;
      panel.style.top = `${startTop + dy}px`;
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    panel.addEventListener('mousedown', onMouseDown);
  }
  
  // 等待白板系统准备就绪
  function waitForWhiteboard() {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 75; // 15秒 = 75次 * 200ms
      
        const checkWhiteboard = setInterval(() => {
        attempts++;
        const getOps = window.__whiteboardOps;
        const batchAddOps = window.__whiteboardBatchAddOps;
        const clearCanvas = window.__whiteboardClearCanvas;
        const spatialIndexRef = window.__whiteboardSpatialIndex;
        const ws = window.__whiteboardWS;
        
        if (typeof getOps === 'function' && typeof batchAddOps === 'function' && spatialIndexRef) {
          clearInterval(checkWhiteboard);
          console.log(`✅ 成功获取白板系统 API（尝试了 ${attempts} 次）`);
          resolve({
            getOps,
            batchAddOps,
            clearCanvas,
            spatialIndexRef,
            ws,
          });
          return;
        }
        
        // 每5次尝试输出一次调试信息
        if (attempts % 5 === 0) {
          console.log(`⏳ 正在等待白板系统就绪... (${attempts}/${maxAttempts})`);
          console.log(`   - window.__whiteboardOps: ${typeof getOps === 'function' ? '存在' : '不存在'}`);
          console.log(`   - window.__whiteboardBatchAddOps: ${typeof batchAddOps === 'function' ? '存在' : '不存在'}`);
          console.log(`   - window.__whiteboardSpatialIndex: ${spatialIndexRef ? '存在' : '不存在'}`);
        }
      }, 200);
      
      // 15秒超时
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
  
  // 清空画布（使用 Whiteboard 组件提供的全局函数）
  function clearCanvas(whiteboard) {
    const clearFn = window.__whiteboardClearCanvas;
    if (typeof clearFn === 'function') {
      clearFn();
      return true;
    }
    // 备用方案：通过 WebSocket 发送 reset 消息
    const ws = whiteboard?.ws || window.__whiteboardWS;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'reset', ops: [] }));
      return true;
    }
    return false;
  }
  
  // 生成随机图形（使用项目的 DrawOp 格式）
  function generateShape(type, index, total) {
    const x = Math.random() * TEST_CONFIG.canvasWidth;
    const y = Math.random() * TEST_CONFIG.canvasHeight;
    const w = 50 + Math.random() * 100;
    const h = 50 + Math.random() * 100;
    const color = '#000000';
    const width = 2;
    const style = 'solid';
    
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
        return {
          kind: 'arrow',
          tool: 'arrow',
          start: { x, y },
          end: { x: x + w, y: y + h },
          color,
          width,
          style,
        };
        
      case 'pen': // stroke
        const points = [];
        const numPoints = 5 + Math.floor(Math.random() * 10);
        for (let i = 0; i < numPoints; i++) {
          points.push({
            x: x + (w * i / (numPoints - 1)) + (Math.random() - 0.5) * 10,
            y: y + (h * i / (numPoints - 1)) + (Math.random() - 0.5) * 10,
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
        return null;
    }
  }
  
  // 等待接收端确认一轮已完成
  function waitForReceiverAck(roundId, timeoutMs = 20000) {
    if (!channel || ROLE !== 'sender') return Promise.resolve(false);
    
    return new Promise((resolve) => {
      let settled = false;
      const handler = (event) => {
        const data = event.data || event;
        if (!data || data.type !== 'round-received' || data.roundId !== roundId) return;
        settled = true;
        channel.removeEventListener('message', handler);
        clearTimeout(timer);
        console.log(`✅ 接收端已确认本轮接收完成 (round=${roundId})`);
        resolve(true);
      };
      
      const timer = setTimeout(() => {
        if (settled) return;
        channel.removeEventListener('message', handler);
        console.warn(`⚠️ 在 ${timeoutMs / 1000}s 内未收到接收端确认 (round=${roundId})，继续下一轮测试`);
        resolve(false);
      }, timeoutMs);
      
      channel.addEventListener('message', handler);
    });
  }
  
  // 执行性能测试（绘制端）
  async function runPerformanceTest() {
    const whiteboard = await waitForWhiteboard();
    
    if (!whiteboard) {
      console.error('❌ 无法找到白板系统 API');
      console.error('请确保在开发环境下运行，并且白板页面已完全加载');
      return;
    }
    
    const { getOps, batchAddOps, clearCanvas: clearCanvasFn, spatialIndexRef, ws } = whiteboard;
    const results = [];
    
    // 获取当前画布尺寸
    const canvas = document.querySelector('canvas');
    if (canvas) {
      TEST_CONFIG.canvasWidth = canvas.width || 2000;
      TEST_CONFIG.canvasHeight = canvas.height || 1500;
    }
    
    for (const size of TEST_CONFIG.testSizes) {
      const iterationResults = [];
      
      for (let iter = 0; iter < TEST_CONFIG.iterations; iter++) {
        // 当前轮次 ID（用于多窗口通信）
        const roundId = `size-${size}-iter-${iter + 1}-${Date.now()}`;
        
        console.log(`\n🔄 开始第 ${iter + 1}/${TEST_CONFIG.iterations} 次迭代（规模: ${size} 个图形）`);
        
        // 如果不是第一次迭代，先等待上一轮同步完成，再清空画布
        // 这样可以确保上一轮的数据已经完全处理完成
        if (iter > 0) {
          const syncWaitTime = TEST_CONFIG.syncWaitBase + (size * TEST_CONFIG.syncWaitPerShape);
          console.log(`  等待上一轮同步完成（约 ${(syncWaitTime/1000).toFixed(1)} 秒）...`);
          await new Promise(resolve => setTimeout(resolve, syncWaitTime));
        }
        
        // 每次迭代开始前都清空画布（确保从干净状态开始）
        const currentOps = getOps();
        if (currentOps.length > 0) {
          console.log(`  清空画布（当前有 ${currentOps.length} 个图形）...`);
          if (clearCanvas(whiteboard)) {
            // 等待 React 状态更新和 WebSocket 同步完成
            // 需要等待足够长的时间，因为：
            // 1. React 状态更新是异步的（setOps 需要时间）
            // 2. WebSocket reset 消息会同步回来，可能重新设置状态
            // 3. 需要等待服务端处理完 reset 消息
            await new Promise(resolve => setTimeout(resolve, 800));
            
            // 多次验证清空是否成功（因为 WebSocket 消息可能延迟）
            let afterClear = getOps();
            let retries = 0;
            const maxRetries = 10;
            while (afterClear.length > 0 && retries < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 200));
              afterClear = getOps();
              retries++;
            }
            
            if (afterClear.length > 0) {
              console.warn(`  ⚠️ 清空后仍有 ${afterClear.length} 个图形（已重试 ${retries} 次）`);
            } else {
              console.log(`  ✅ 画布已清空`);
            }
          } else {
            console.warn('  ⚠️ 无法清空画布，测试将在现有图形基础上进行');
          }
        } else {
          console.log(`  ✅ 画布已为空，无需清空`);
        }
        
        // 清空画布后，等待GC稳定，再测量初始内存
        // 给GC足够时间回收上一轮的内存（清空验证过程中可能还在处理WebSocket消息）
        // 等待时间要足够长，确保GC完成回收
        console.log(`  等待GC稳定，准备测量初始内存...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // 增加等待时间，确保GC完成
        
        // 多次采样初始内存值，取平均值（减少GC波动影响）
        // 采样间隔要足够长，确保每次采样时GC已经稳定
        let memoryBeforeSamples = [];
        for (let i = 0; i < 3; i++) {
          if (performance.memory) {
            memoryBeforeSamples.push(performance.memory.usedJSHeapSize);
          }
          await new Promise(resolve => setTimeout(resolve, 800)); // 增加采样间隔，确保GC稳定
        }
        const memoryBefore = memoryBeforeSamples.length > 0
          ? memoryBeforeSamples.reduce((a, b) => a + b, 0) / memoryBeforeSamples.length
          : (performance.memory ? performance.memory.usedJSHeapSize : 0);
        
        // 生成图形
        const shapes = [];
        for (let i = 0; i < size; i++) {
          const type = TEST_CONFIG.shapeTypes[i % TEST_CONFIG.shapeTypes.length];
          const shape = generateShape(type, i, size);
          if (shape) {
            shapes.push(shape);
          }
        }
        
        // 记录开始时间（在内存测量之后）
        const startTime = performance.now();
        
        // 开始本轮测试前，关闭上一轮可能残留的进度窗
        const lastProgressPanels = document.querySelectorAll('[data-role="incremental-progress-panel"]');
        lastProgressPanels.forEach(p => {
          if (p.parentElement) p.parentElement.removeChild(p);
        });
        
        // 批量创建图形（分批创建，避免阻塞）
        const batchSize = 100;
        let createdCount = 0;
        
        // 创建可视化进度显示（可拖动、可关闭）
        const progressDiv = document.createElement('div');
        progressDiv.setAttribute('data-role', 'incremental-progress-panel');
        progressDiv.style.cssText = 'position:fixed;top:20px;right:20px;background:rgba(0,0,0,0.85);color:#fff;padding:15px;border-radius:8px;z-index:10000;font-family:monospace;min-width:300px;max-width:360px;box-sizing:border-box;';
        progressDiv.innerHTML = `
          <div style="font-weight:bold;margin-bottom:10px;">📊 增量绘制测试进度</div>
          <div>目标规模: ${size} 个图形</div>
          <div>迭代: ${iter + 1}/${TEST_CONFIG.iterations}</div>
          <div>已创建: <span id="progress-count">0</span>/${shapes.length}</div>
          <div>进度: <span id="progress-percent">0</span>%</div>
          <div style="margin-top:10px;background:#333;height:20px;border-radius:10px;overflow:hidden;">
            <div id="progress-bar" style="background:#4CAF50;height:100%;width:0%;transition:width 0.3s;"></div>
          </div>
        `;
        document.body.appendChild(progressDiv);
        makePanelDraggableAndClosable(progressDiv);
        const progressCountEl = progressDiv.querySelector('#progress-count');
        const progressPercentEl = progressDiv.querySelector('#progress-percent');
        const progressBarEl = progressDiv.querySelector('#progress-bar');
        
        try {
          for (let i = 0; i < shapes.length; i += batchSize) {
            const batch = shapes.slice(i, i + batchSize);
            
            try {
              batchAddOps(batch);
              createdCount += batch.length;
              
              // 更新进度显示
              if (progressCountEl && progressPercentEl && progressBarEl) {
                const percent = Math.round((createdCount / shapes.length) * 100);
                progressCountEl.textContent = String(createdCount);
                progressPercentEl.textContent = String(percent);
                progressBarEl.style.width = percent + '%';
              }
            } catch (error) {
              console.warn(`创建图形时出错: ${error.message}`);
              break;
            }
            
            // 小延迟，允许浏览器渲染和 WebSocket 同步
            // 批量添加时，给 WebSocket 一些时间同步到接收端
            if (i + batchSize < shapes.length) {
              await new Promise(resolve => setTimeout(resolve, 20));
            }
          }
        } catch (error) {
          console.warn(`\n创建图形时出错: ${error.message}`);
        }
        
        // 记录结束时间（所有 batchAddOps 调用完成的时间）
        // 注意：这里记录的是"添加操作"完成的时间，不包括渲染和同步等待
        // batchAddOps 是同步函数，但内部的 setOps 和 redraw 是异步的
        // 为了确保状态更新完成，等待一个事件循环周期
        await new Promise(resolve => setTimeout(resolve, 0));
        const endTime = performance.now();
        
        // 更新最终进度
        const finalPercent = shapes.length > 0 ? Math.round((createdCount / shapes.length) * 100) : 100;
        if (progressCountEl && progressPercentEl && progressBarEl) {
          progressCountEl.textContent = String(createdCount);
          progressPercentEl.textContent = String(finalPercent);
          progressBarEl.style.width = `${finalPercent}%`;
        }
        
        // 等待渲染完成和同步完成（用于同步验证，不计入添加操作时间）
        const syncWaitTime = TEST_CONFIG.syncWaitBase + (shapes.length * TEST_CONFIG.syncWaitPerShape);
        await new Promise(resolve => setTimeout(resolve, Math.max(500, syncWaitTime)));
        
        // 创建完图形后，等待GC稳定，再测量最终内存
        // 给GC足够时间处理新创建的对象和回收临时对象
        // 等待时间要足够长，确保GC完成处理
        console.log(`  等待GC稳定，准备测量最终内存...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // 增加等待时间，确保GC完成
        
        // 多次采样最终内存值，取平均值（减少GC波动影响）
        // 采样间隔要足够长，确保每次采样时GC已经稳定
        let memoryAfterSamples = [];
        for (let i = 0; i < 5; i++) {
          if (performance.memory) {
            memoryAfterSamples.push(performance.memory.usedJSHeapSize);
          }
          await new Promise(resolve => setTimeout(resolve, 800)); // 增加采样间隔，确保GC稳定
        }
        const memoryAfter = memoryAfterSamples.length > 0 
          ? memoryAfterSamples.reduce((a, b) => a + b, 0) / memoryAfterSamples.length 
          : (performance.memory ? performance.memory.usedJSHeapSize : 0);
        
        const duration = endTime - startTime;
        const memoryDelta = memoryAfter - memoryBefore;
        
        iterationResults.push({
          duration,
          memoryDelta,
          shapesCreated: createdCount,
        });
        
        // 一次迭代的数据准备完毕，通知接收端本轮已发送完成
        if (channel && ROLE === 'sender') {
          channel.postMessage({
            type: 'round-sent',
            from: INSTANCE_ID,
            role: 'sender',
            roundId,
            size,
            iteration: iter + 1,
            shapesPlanned: createdCount,
          });
          console.log(`📨 已通知接收端：本轮发送完成 (size=${size}, iter=${iter + 1})，等待接收端确认...`);
          await waitForReceiverAck(roundId, 20000);
        }
        
        console.log(`✅ 第 ${iter + 1}/${TEST_CONFIG.iterations} 次迭代完成（耗时: ${duration.toFixed(0)}ms，创建: ${createdCount} 个图形）`);
        
        // 每次迭代完成后清空画布，为下一轮做准备（最后一次迭代除外）
        if (iter < TEST_CONFIG.iterations - 1) {
          console.log(`  清空画布，准备下一轮迭代...`);
          const opsAfterTest = getOps();
          if (opsAfterTest.length > 0) {
            if (clearCanvas(whiteboard)) {
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        }
        
        // 每轮之间额外等待几秒，让双方界面稳定下来
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // 计算平均值
      const avgDuration = iterationResults.reduce((sum, r) => sum + r.duration, 0) / iterationResults.length;
      const avgMemory = iterationResults.reduce((sum, r) => sum + r.memoryDelta, 0) / iterationResults.length;
      const shapesPerSecond = size / (avgDuration / 1000);
      
      results.push({
        size,
        avgDuration,
        avgMemory,
        shapesPerSecond,
      });
      
      // 该规模测试完成后移除进度窗
      const progressDiv = document.querySelector('[data-role="incremental-progress-panel"]');
      if (progressDiv && progressDiv.parentElement) {
        progressDiv.parentElement.removeChild(progressDiv);
      }
      
      console.log(`${size} 个图形: ${avgDuration.toFixed(0)}ms, ${shapesPerSecond.toFixed(0)} 图形/秒`);
      
      // 每个测试规模完成后，等待一段时间再进行下一个规模
      if (TEST_CONFIG.testSizes.indexOf(size) < TEST_CONFIG.testSizes.length - 1) {
        const nextSize = TEST_CONFIG.testSizes[TEST_CONFIG.testSizes.indexOf(size) + 1];
        const waitTime = TEST_CONFIG.syncWaitBase + (size * TEST_CONFIG.syncWaitPerShape);
        console.log(`  准备下一个测试（${nextSize} 个图形），短暂等待 ${(waitTime/1000).toFixed(1)} 秒...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    // 输出测试结果总结
    console.log('\n\n📈 测试结果总结');
    console.log('========================================');
    console.log('规模\t平均耗时(ms)\t图形/秒');
    console.log('----------------------------------------');
    results.forEach(r => {
      console.log(`${r.size}\t${r.avgDuration.toFixed(0)}\t\t${r.shapesPerSecond.toFixed(0)}`);
    });
    
    // 创建可视化结果图表
    const resultsDiv = document.createElement('div');
    resultsDiv.setAttribute('data-role', 'incremental-results-panel');
    resultsDiv.style.cssText = 'position:fixed;bottom:20px;right:20px;background:rgba(0,0,0,0.9);color:#fff;padding:16px 18px;border-radius:8px;z-index:10000;font-family:monospace;min-width:320px;max-width:480px;max-height:70vh;overflow:auto;box-sizing:border-box;';
    resultsDiv.innerHTML = `
      <div style="font-weight:bold;font-size:16px;margin-bottom:15px;">📊 增量绘制测试结果</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="border-bottom:1px solid #555;">
            <th style="text-align:left;padding:5px;">规模</th>
            <th style="text-align:right;padding:5px;">耗时(ms)</th>
            <th style="text-align:right;padding:5px;">图形/秒</th>
            <th style="text-align:right;padding:5px;">内存(MB)</th>
          </tr>
        </thead>
        <tbody id="results-table-body">
        </tbody>
      </table>
      <div style="margin-top:15px;padding-top:15px;border-top:1px solid #555;font-size:11px;color:#aaa;">
        <div>✅ 测试完成！结果已保存到 window.__testResults</div>
      </div>
    `;
    document.body.appendChild(resultsDiv);
    makePanelDraggableAndClosable(resultsDiv);
    
    const tbody = document.getElementById('results-table-body');
    results.forEach((r, idx) => {
      const row = document.createElement('tr');
      row.style.cssText = idx % 2 === 0 ? 'background:rgba(255,255,255,0.05);' : '';
      row.innerHTML = `
        <td style="padding:5px;">${r.size}</td>
        <td style="text-align:right;padding:5px;color:${r.avgDuration > 2000 ? '#f44336' : r.avgDuration > 1000 ? '#ff9800' : '#4caf50'}">${r.avgDuration.toFixed(0)}</td>
        <td style="text-align:right;padding:5px;color:#4caf50">${r.shapesPerSecond.toFixed(0)}</td>
        <td style="text-align:right;padding:5px;color:#2196f3">${(r.avgMemory / 1024 / 1024).toFixed(2)}</td>
      `;
      tbody.appendChild(row);
    });
    
    return results;
  }
  
  // 接收端监听：在另一端完成接收后，通过 BroadcastChannel 通知绘制端
  async function setupReceiverListener() {
    if (!channel) {
      console.warn('⚠️ 当前浏览器不支持 BroadcastChannel，无法进行接收端联动提示');
      return;
    }
    
    console.log(`📥 接收端监听初始化中（ROLE=${ROLE}，INSTANCE_ID=${INSTANCE_ID}）...`);
    
    // 尝试获取白板 API（但不阻塞）
    let whiteboard = null;
    try {
      whiteboard = await waitForWhiteboard();
      if (whiteboard) {
        console.log('✅ 白板系统 API 已就绪');
      } else {
        console.warn('⚠️ 无法获取白板系统 API，将使用备用检测方案');
      }
    } catch (e) {
      console.warn('⚠️ 获取白板系统 API 时出错:', e);
    }
    
    let currentRound = null;
    let quietTimer = null;
    let lastOpsCount = 0;
    let opsCountCheckTimer = null;
    let fallbackTimer = null;
    const QUIET_MS = 2000; // 2 秒内没有新的变化，认为本轮接收完成
    const FALLBACK_DELAY_MS = 8000; // 备用方案：固定延迟 8 秒（给足够时间接收）
    
    // 获取当前操作数量（带重试）
    function getCurrentOpsCount() {
      // 如果 whiteboard 可用，使用它
      if (whiteboard && whiteboard.getOps) {
        try {
          return whiteboard.getOps().length;
        } catch (e) {
          console.warn('⚠️ 通过 whiteboard API 获取操作数量失败:', e);
        }
      }
      
      // 备用方案：尝试直接从 window 获取
      if (typeof window.__whiteboardOps === 'function') {
        try {
          return window.__whiteboardOps().length;
        } catch (e) {
          console.warn('⚠️ 通过 window.__whiteboardOps 获取操作数量失败:', e);
        }
      }
      
      return -1; // 表示无法获取
    }
    
    // 清理所有定时器
    function clearAllTimers() {
      if (quietTimer) {
        clearTimeout(quietTimer);
        quietTimer = null;
      }
      if (opsCountCheckTimer) {
        clearInterval(opsCountCheckTimer);
        opsCountCheckTimer = null;
      }
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    }
    
    // 发送确认消息
    function sendAck() {
      if (!currentRound) {
        console.warn('⚠️ 尝试发送确认但 currentRound 为空');
        return;
      }
      if (!channel) {
        console.warn('⚠️ 尝试发送确认但 channel 不存在');
        return;
      }
      
      const roundInfo = { ...currentRound };
      
      try {
        channel.postMessage({
          type: 'round-received',
          from: INSTANCE_ID,
          role: 'receiver',
          roundId: roundInfo.roundId,
          size: roundInfo.size,
          iteration: roundInfo.iteration,
        });
        
        console.log(`✅ 已向绘制端确认本轮接收完成 (size=${roundInfo.size}, iter=${roundInfo.iteration})`);
      } catch (e) {
        console.error('❌ 发送确认消息失败:', e);
      }
      
      // 清理状态
      currentRound = null;
      clearAllTimers();
    }
    
    // 重置安静计时器（操作数量变化时调用）
    function resetQuietTimer() {
      if (!currentRound) return;
      
      // 清除旧的计时器
      if (quietTimer) {
        clearTimeout(quietTimer);
      }
      
      // 设置新的计时器：如果 2 秒内没有变化，发送确认
      quietTimer = setTimeout(() => {
        if (currentRound) {
          console.log(`⏱️ 操作数量已稳定 ${QUIET_MS/1000} 秒，发送确认`);
          sendAck();
        }
      }, QUIET_MS);
    }
    
    // 通过操作数量变化来判断接收完成
    function setupOpsCountDetection() {
      if (!currentRound) {
        console.warn('⚠️ 无法设置操作数量检测：currentRound 为空');
        return;
      }
      
      // 记录初始操作数量
      lastOpsCount = getCurrentOpsCount();
      if (lastOpsCount >= 0) {
        console.log(`📊 开始监听操作变化（初始数量: ${lastOpsCount}，目标: ${currentRound.size} 个图形）`);
      } else {
        console.warn('⚠️ 无法获取初始操作数量，将使用固定延迟方案');
        // 如果无法获取操作数量，直接使用固定延迟
        fallbackTimer = setTimeout(() => {
          if (currentRound) {
            console.log(`⏰ 无法检测操作变化，使用固定延迟 ${FALLBACK_DELAY_MS/1000} 秒后发送确认`);
            sendAck();
          }
        }, FALLBACK_DELAY_MS);
        return;
      }
      
      // 立即开始第一次检查
      resetQuietTimer();
      
      // 定期检查操作数量
      opsCountCheckTimer = setInterval(() => {
        if (!currentRound) {
          clearInterval(opsCountCheckTimer);
          opsCountCheckTimer = null;
          return;
        }
        
        const currentOpsCount = getCurrentOpsCount();
        if (currentOpsCount < 0) {
          // 无法获取操作数量，跳过本次检查
          return;
        }
        
        // 如果操作数量发生变化，重置计时器
        if (currentOpsCount !== lastOpsCount) {
          console.log(`📈 操作数量变化: ${lastOpsCount} -> ${currentOpsCount}`);
          lastOpsCount = currentOpsCount;
          resetQuietTimer(); // 重新开始计时
        }
      }, 500); // 每 500ms 检查一次
      
      // 备用方案：固定延迟后发送确认（防止永远收不到）
      fallbackTimer = setTimeout(() => {
        if (currentRound) {
          console.log(`⏰ 备用方案：固定延迟 ${FALLBACK_DELAY_MS/1000} 秒后发送确认`);
          sendAck();
        }
      }, FALLBACK_DELAY_MS);
    }
    
    // 监听绘制端的通知
    channel.addEventListener('message', (event) => {
      const data = event.data || event;
      
      // 调试：输出所有收到的消息
      if (data && data.type) {
        console.log(`📬 收到 BroadcastChannel 消息: type=${data.type}, from=${data.from}`);
      }
      
      if (!data || data.type !== 'round-sent') return;
      
      // 忽略自己发出的 round-sent，只响应其他窗口的
      if (data.from === INSTANCE_ID) {
        console.log('🔇 忽略自己发出的 round-sent 消息');
        return;
      }
      
      // 清理上一轮的定时器（如果有）
      clearAllTimers();
      
      currentRound = {
        roundId: data.roundId,
        size: data.size,
        iteration: data.iteration,
      };
      
      console.log(`📨 收到绘制端通知：已发送一轮 (size=${data.size}, iter=${data.iteration})，等待本端接收完成...`);
      
      // 如果 whiteboard 还没准备好，尝试重新获取
      if (!whiteboard) {
        waitForWhiteboard().then(wb => {
          if (wb) {
            whiteboard = wb;
            console.log('✅ 白板系统 API 已就绪（延迟获取）');
          }
          setupOpsCountDetection();
        }).catch(() => {
          console.warn('⚠️ 延迟获取白板系统 API 失败，使用备用方案');
          setupOpsCountDetection();
        });
      } else {
        // 设置操作数量检测
        setupOpsCountDetection();
      }
    });
    
    console.log('✅ 接收端消息监听已设置完成，等待绘制端消息...');
  }
  
  // 所有窗口都启动接收端监听
  setupReceiverListener().catch(error => {
    console.error('\n❌ 接收端监听初始化失败:', error);
  });
  
  // 只有 sender 角色执行绘制端测试逻辑
  if (ROLE === 'sender') {
    runPerformanceTest().then(results => {
      console.log('\n✅ 测试完成！');
      window.__testResults = results;
    }).catch(error => {
      console.error('\n❌ 测试失败:', error);
    });
    
    // 导出测试函数，方便手动调用
    window.runIncrementalDrawingTest = runPerformanceTest;
  }
})();
