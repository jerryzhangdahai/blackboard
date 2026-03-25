/**
 * tldraw 协同性能测试脚本（浏览器控制台）
 * 
 * 测试目标：验证原生 tldraw 协同白板的性能和同步能力
 * - tldraw 批量创建图形的性能
 * - WebSocket diff 增量同步性能
 * - 网络同步延迟
 * - 内存使用情况
 * - 极端情况（4000+ 图形）的性能表现
 * 
 * 使用方法:
 * 
 * 【发送端（绘制端）】：
 *   1. 启动前端和后端服务（npm run dev）
 *   2. 在浏览器中打开白板页面（http://localhost:5173）
 *   3. 打开浏览器控制台（F12）
 *   4. 直接复制此脚本内容到控制台执行
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
 *   - 此脚本针对原生 tldraw 开发的协同白板进行测试
 */

(function() {
  'use strict';
  
  console.log('🎨 tldraw 协同性能测试脚本');
  console.log('========================================');
  console.log('测试目标：原生 tldraw 协同白板的批量创建、diff 同步、网络延迟、内存使用');
  
  // 多窗口通信配置（用于绘制端 / 接收端之间协调轮次）
  const CHANNEL_NAME = 'incremental-drawing-test';
  const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';
  const channel = hasBroadcastChannel ? new BroadcastChannel(CHANNEL_NAME) : null;
  const INSTANCE_ID = Math.random().toString(36).slice(2, 11);
  // 在接收端运行脚本前，可以在控制台先设置 window.__INCREMENTAL_TEST_ROLE = 'receiver'
  const ROLE = (window.__INCREMENTAL_TEST_ROLE === 'receiver') ? 'receiver' : 'sender';
  
  // 测试配置
  const TEST_CONFIG = {
    // 不同规模的测试（注意：tldraw 默认限制为 4000 个图形/页）
    // 实际测试时会预留安全余量，避免真正触碰 4000 的硬限制
    testSizes: [100, 500, 1000, 2000, 4000],
    // 每个规模测试的次数
    iterations: 3,
    // 同步等待时间（毫秒）：主要用于统计和兜底，真正的“等待接收端”由 BroadcastChannel 确认控制
    // 这里不再故意拉长时间，而是保持相对保守的短等待
    syncWaitBase: 500,       // 基础等待时间（毫秒，原来 3000，改为 500）
    syncWaitPerShape: 0.5,   // 每个图形额外等待时间（毫秒，原来 4，改为 0.5）
    // 图形类型分布（暂时移除 draw 类型，因为需要复杂的 base64 编码点数据）
    shapeTypes: ['rect', 'circle', 'arrow'],
    // 画布尺寸
    canvasWidth: 2000,
    canvasHeight: 1500,
    // tldraw 最大图形数限制（会在运行时动态检测）
    // 如果组件中设置了 maxShapesPerPage，这里会自动使用更大的值
    maxShapesPerPage: null, // 将在运行时检测
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

  // 等待 tldraw 编辑器准备就绪
  function waitForEditor() {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 75; // 15秒 = 75次 * 200ms
      
      const checkEditor = setInterval(() => {
        attempts++;
        // 尝试多种方式获取编辑器
        let editor = null;
        
        // 方法1: 从 window 全局对象获取
        if (window.__tldrawEditor) {
          editor = window.__tldrawEditor;
        }
        // 方法2: 从 React 组件实例获取（通过 DOM）
        else if (document.querySelector('[data-tldraw]')) {
          // 尝试通过事件监听器获取
          const container = document.querySelector('.tl-container');
          if (container && container.__editor) {
            editor = container.__editor;
          }
        }
        // 方法3: 尝试从 tldraw 的 store 获取
        else {
          try {
            const tldrawElement = document.querySelector('[data-tldraw]');
            if (tldrawElement) {
              // 尝试从 React Fiber 获取
              const reactKey = Object.keys(tldrawElement).find(key => key.startsWith('__react'));
              if (reactKey) {
                const reactInstance = tldrawElement[reactKey];
                if (reactInstance && reactInstance.memoizedState) {
                  // 尝试从 React state 中找到 editor
                  let state = reactInstance.memoizedState;
                  while (state) {
                    if (state.memoizedState && typeof state.memoizedState.getCurrentPageShapes === 'function') {
                      editor = state.memoizedState;
                      break;
                    }
                    state = state.next;
                  }
                }
              }
            }
          } catch (e) {
            // 忽略错误，继续尝试其他方法
          }
        }
        
        // 验证编辑器是否有必要的方法
        if (editor && 
            typeof editor.getCurrentPageShapes === 'function' &&
            typeof editor.createShapes === 'function') {
          clearInterval(checkEditor);
          console.log(`✅ 成功获取编辑器（尝试了 ${attempts} 次）`);
          resolve(editor);
          return;
        }
        
        // 每5次尝试输出一次调试信息
        if (attempts % 5 === 0) {
          console.log(`⏳ 正在等待编辑器就绪... (${attempts}/${maxAttempts})`);
          console.log(`   - window.__tldrawEditor: ${window.__tldrawEditor ? '存在' : '不存在'}`);
          console.log(`   - .tl-container: ${document.querySelector('.tl-container') ? '存在' : '不存在'}`);
          console.log(`   - [data-tldraw]: ${document.querySelector('[data-tldraw]') ? '存在' : '不存在'}`);
        }
      }, 200);
      
      // 15秒超时
      setTimeout(() => {
        clearInterval(checkEditor);
        console.warn('⚠️ 无法自动获取编辑器，将使用备用方案（基于DOM变化检测）');
        console.log('  提示：如果页面刚加载，请等待几秒后重试');
        console.log('  或者手动检查：window.__tldrawEditor');
        resolve(null);
      }, 15000);
    });
  }
  
  // 生成随机图形（使用 tldraw API）
  function generateShape(editor, type, index, total) {
    const x = Math.random() * TEST_CONFIG.canvasWidth;
    const y = Math.random() * TEST_CONFIG.canvasHeight;
    const w = 50 + Math.random() * 100;
    const h = 50 + Math.random() * 100;
    
    switch(type) {
      case 'rect':
        return {
          type: 'geo',
          x,
          y,
          rotation: 0,
          isLocked: false,
          opacity: 1,
          props: {
            w,
            h,
            geo: 'rectangle',
            color: 'black',
            size: 'm',
            dash: 'draw',
            fill: 'none',
          },
        };
        
      case 'circle':
        return {
          type: 'geo',
          x,
          y,
          rotation: 0,
          isLocked: false,
          opacity: 1,
          props: {
            w,
            h,
            geo: 'ellipse',
            color: 'black',
            size: 'm',
            dash: 'draw',
            fill: 'none',
          },
        };
        
      case 'arrow':
        return {
          type: 'arrow',
          x,
          y,
          rotation: 0,
          isLocked: false,
          opacity: 1,
          props: {
            color: 'black',
            size: 'm',
            dash: 'draw',
            arrowheadStart: 'none',
            arrowheadEnd: 'arrow',
            start: { x, y },
            end: { x: x + w, y: y + h },
            bend: 0,
          },
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
    const editor = await waitForEditor();
    
    if (!editor) {
      console.error('❌ 无法找到 tldraw 编辑器');
      return;
    }
    
    // 尝试检测实际的图形数量限制
    let actualMaxShapes = TEST_CONFIG.maxShapesPerPage || 4000;
    try {
      if (editor.store && editor.store.options && editor.store.options.maxShapesPerPage) {
        actualMaxShapes = editor.store.options.maxShapesPerPage;
      }
    } catch (e) {
      // 使用默认值
    }
    
    // 最大不超过 4000，避免硬上限被过滤掉（不再扣安全余量）
    const usableMaxShapes = Math.min(4000, Math.max(1000, actualMaxShapes));
    TEST_CONFIG.maxShapesPerPage = usableMaxShapes;
    
    // 过滤掉超过限制的测试规模（使用预留安全余量后的可用上限）
    const validSizes = TEST_CONFIG.testSizes.filter(size => size <= usableMaxShapes);
    
    if (validSizes.length === 0) {
      console.error('❌ 所有测试规模都超过图形数量限制');
      return;
    }
    
    const results = [];
    
    for (const size of validSizes) {
      const iterationResults = [];
      
      // 在每个测试规模开始前，清空画布并采样基准内存（多次采样取平均值，减少GC波动）
      console.log(`\n准备测试规模 ${size} 个图形...`);
      const currentShapes = editor.getCurrentPageShapes();
      if (currentShapes.length > 0) {
        editor.deleteShapes(currentShapes.map(s => s.id));
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // 等待GC稳定，多次采样取平均值作为基准内存
      await new Promise(resolve => setTimeout(resolve, 1000)); // 等待GC执行
      let memorySamplesBefore = [];
      for (let i = 0; i < 3; i++) {
        if (performance.memory) {
          memorySamplesBefore.push(performance.memory.usedJSHeapSize);
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      const memoryBefore = memorySamplesBefore.length > 0
        ? memorySamplesBefore.reduce((a, b) => a + b, 0) / memorySamplesBefore.length
        : (performance.memory ? performance.memory.usedJSHeapSize : 0);
      
      for (let iter = 0; iter < TEST_CONFIG.iterations; iter++) {
        // 当前轮次 ID（用于多窗口通信）
        const roundId = `size-${size}-iter-${iter + 1}-${Date.now()}`;
        // 如果不是第一次迭代，等待上一轮同步完成后再清空
        if (iter > 0) {
          // 轻量级等待，让上一轮的网络 / 渲染稍微稳定一下（真正的"是否可以进入下一轮"交给接收端确认）
          const syncWaitTime = TEST_CONFIG.syncWaitBase + (size * TEST_CONFIG.syncWaitPerShape);
          console.log(`  短暂等待同步稳定（约 ${(syncWaitTime/1000).toFixed(1)} 秒）...`);
          await new Promise(resolve => setTimeout(resolve, syncWaitTime));
          
          // 清空画布，准备下一轮迭代
          const prevShapes = editor.getCurrentPageShapes();
          if (prevShapes.length > 0) {
            editor.deleteShapes(prevShapes.map(s => s.id));
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        // 生成图形
        const shapes = [];
        for (let i = 0; i < size; i++) {
          const type = TEST_CONFIG.shapeTypes[i % TEST_CONFIG.shapeTypes.length];
          const shape = generateShape(editor, type, i, size);
          if (shape) {
            shapes.push(shape);
          }
        }
        
        // 记录开始时间
        const startTime = performance.now();
        
        // 检查当前图形数量，避免超过限制
        const currentShapeCount = editor.getCurrentPageShapes().length;
        const maxShapes = TEST_CONFIG.maxShapesPerPage || 4000; // tldraw 默认限制为 4000
        
        // 如果接近或超过限制，调整图形数量
        if (maxShapes && currentShapeCount + shapes.length > maxShapes) {
          const allowedCount = Math.max(0, maxShapes - currentShapeCount);
          if (allowedCount > 0) {
            shapes.splice(allowedCount);
          } else {
            continue;
          }
        }
        
        if (shapes.length === 0) {
          continue;
        }
        
        // 开始本轮测试前，关闭上一轮可能残留的进度窗（结果窗保留，直到整轮测试结束）
        const lastProgressPanels = document.querySelectorAll('[data-role="incremental-progress-panel"]');
        lastProgressPanels.forEach(p => {
          if (p.parentElement) p.parentElement.removeChild(p);
        });
        
        // 批量创建图形（分批创建，避免阻塞）
        const batchSize = 100;
        let createdCount = 0;
        let hitLimit = false;
        
        // 创建可视化进度显示（可拖动、可关闭）
        const progressDiv = document.createElement('div');
        progressDiv.setAttribute('data-role', 'incremental-progress-panel');
        progressDiv.style.cssText = 'position:fixed;top:20px;right:20px;background:rgba(0,0,0,0.85);color:#fff;padding:15px;border-radius:8px;z-index:10000;font-family:monospace;min-width:300px;max-width:360px;box-sizing:border-box;';
        progressDiv.innerHTML = `
          <div style="font-weight:bold;margin-bottom:10px;">📊 tldraw 协同性能测试进度</div>
          <div>目标规模: ${size} 个图形</div>
          <div>实际计划: ${shapes.length} 个图形（已根据上限自动调整）</div>
          <div>迭代: ${iter + 1}/${TEST_CONFIG.iterations}</div>
          <div>已创建: <span id="progress-count">0</span>/${shapes.length}</div>
          <div>进度: <span id="progress-percent">0</span>%</div>
          <div style="margin-top:10px;background:#333;height:20px;border-radius:10px;overflow:hidden;">
            <div id="progress-bar" style="background:#4CAF50;height:100%;width:0%;transition:width 0.3s;"></div>
          </div>
        `;
        document.body.appendChild(progressDiv);
        makePanelDraggableAndClosable(progressDiv);
        // 绑定当前进度面板的元素，避免多个测试相互干扰
        const progressCountEl = progressDiv.querySelector('#progress-count');
        const progressPercentEl = progressDiv.querySelector('#progress-percent');
        const progressBarEl = progressDiv.querySelector('#progress-bar');
        
        // 记录创建图形的开始时间
        const createStartTime = performance.now();
        
        try {
          for (let i = 0; i < shapes.length; i += batchSize) {
            const batch = shapes.slice(i, i + batchSize);
            
            try {
              editor.createShapes(batch);
              createdCount += batch.length;
              
              // 更新进度显示
              if (progressCountEl && progressPercentEl && progressBarEl) {
                const percent = Math.round((createdCount / shapes.length) * 100);
                progressCountEl.textContent = String(createdCount);
                progressPercentEl.textContent = String(percent);
                progressBarEl.style.width = percent + '%';
              }
            } catch (error) {
              // 如果遇到限制错误，记录并停止
              if (error.message && (error.message.includes('maximum') || 
                  error.message.includes('limit') ||
                  error.message.includes('4000'))) {
                hitLimit = true;
                const newLimit = editor.getCurrentPageShapes().length;
                if (newLimit < TEST_CONFIG.maxShapesPerPage || !TEST_CONFIG.maxShapesPerPage) {
                  TEST_CONFIG.maxShapesPerPage = newLimit;
                }
                break;
              } else {
                throw error;
              }
            }
            
            // 小延迟，允许浏览器渲染
            if (i + batchSize < shapes.length && !hitLimit) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }
        } catch (error) {
          if (!hitLimit) {
            console.warn(`\n创建图形时出错: ${error.message}`);
          }
        }

        // 记录创建图形的结束时间（在同步等待之前，只计算实际创建时间）
        const createEndTime = performance.now();
        const createDuration = createEndTime - createStartTime;
        
        // tldraw 会自动通过 store.listen 发送 diff 到服务端
        
        // 更新最终进度（使用实际创建数量，避免显示 0 的情况）
        const finalShapeCount = editor.getCurrentPageShapes().length;
        const actuallyCreated = Math.max(0, finalShapeCount - currentShapeCount);
        const displayCreated = Math.max(createdCount, actuallyCreated);
        const finalPercent = shapes.length > 0 ? Math.round((displayCreated / shapes.length) * 100) : 100;
        if (progressCountEl && progressPercentEl && progressBarEl) {
          progressCountEl.textContent = String(displayCreated);
          progressPercentEl.textContent = String(finalPercent);
          progressBarEl.style.width = `${finalPercent}%`;
        }
        
        // 更新实际创建的图形数量（用于性能计算）
        if (actuallyCreated < shapes.length) {
          // 如果实际创建的少于预期，更新 shapes 数组长度用于计算
          shapes.splice(actuallyCreated);
        }
        
        // 等待渲染完成、GC稳定和同步完成（这部分时间不计入性能测试）
        // 根据创建的图形数量动态调整等待时间（但不再拉得太长），主要用于本地统计
        const syncWaitTime = TEST_CONFIG.syncWaitBase + (shapes.length * TEST_CONFIG.syncWaitPerShape);
        await new Promise(resolve => setTimeout(resolve, Math.max(500, syncWaitTime)));
        
        // 多次采样内存值，取平均值（减少GC波动影响）
        let memorySamples = [];
        for (let i = 0; i < 3; i++) {
          if (performance.memory) {
            memorySamples.push(performance.memory.usedJSHeapSize);
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // 记录内存使用（同步等待后的内存值）
        const memoryAfter = memorySamples.length > 0 
          ? memorySamples.reduce((a, b) => a + b, 0) / memorySamples.length 
          : (performance.memory ? performance.memory.usedJSHeapSize : 0);
        
        // 使用实际创建图形的时间，不包含同步等待时间
        const duration = createDuration;
        const memoryDelta = memoryAfter - memoryBefore;
        
        iterationResults.push({
          duration,
          memoryDelta,
          shapesCreated: shapes.length,
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
            shapesPlanned: shapes.length,
          });
          console.log(`📨 已通知接收端：本轮发送完成 (size=${size}, iter=${iter + 1})，等待接收端确认...`);
          await waitForReceiverAck(roundId, 20000);
        }
        
        // 每轮之间额外等待几秒，让双方界面稳定下来
        await new Promise(resolve => setTimeout(resolve, 3000));
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
      
        // 该规模测试完成后移除进度窗（不重复显示完成态）
        const progressDiv = document.querySelector('[data-role="incremental-progress-panel"]') || document.querySelector('div[style*="tldraw 协同性能测试进度"]');
        if (progressDiv && progressDiv.parentElement) {
          progressDiv.parentElement.removeChild(progressDiv);
        }
      
      console.log(`${size} 个图形: ${avgDuration.toFixed(0)}ms, ${shapesPerSecond.toFixed(0)} 图形/秒`);
      
      // 每个测试规模完成后，等待一段时间再进行下一个规模（避免网络压力）
      if (validSizes.indexOf(size) < validSizes.length - 1) {
        const nextSize = validSizes[validSizes.indexOf(size) + 1];
        const waitTime = TEST_CONFIG.syncWaitBase + (size * TEST_CONFIG.syncWaitPerShape);
        console.log(`  准备下一个测试（${nextSize} 个图形），短暂等待 ${(waitTime/1000).toFixed(1)} 秒...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    // 输出测试结果总结
    console.log('\n\n📈 tldraw 协同性能测试结果总结');
    console.log('========================================');
    console.log('规模\t平均耗时(ms)\t图形/秒\t\t内存增量(MB)');
    console.log('----------------------------------------');
    results.forEach(r => {
      console.log(`${r.size}\t${r.avgDuration.toFixed(0)}\t\t${r.shapesPerSecond.toFixed(0)}\t\t${(r.avgMemory / 1024 / 1024).toFixed(2)}`);
    });
    
    // 创建可视化结果图表
    const resultsDiv = document.createElement('div');
    resultsDiv.setAttribute('data-role', 'incremental-results-panel');
    resultsDiv.style.cssText = 'position:fixed;bottom:20px;right:20px;background:rgba(0,0,0,0.9);color:#fff;padding:16px 18px;border-radius:8px;z-index:10000;font-family:monospace;min-width:320px;max-width:480px;max-height:70vh;overflow:auto;box-sizing:border-box;';
    resultsDiv.innerHTML = `
      <div style="font-weight:bold;font-size:16px;margin-bottom:15px;">📊 tldraw 协同性能测试结果</div>
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
    
    const editor = await waitForEditor();
    
    console.log(`📥 接收端监听已启动（ROLE=${ROLE}，INSTANCE_ID=${INSTANCE_ID}）`);
    
    let currentRound = null;
    let quietTimer = null;
    let lastShapeCount = 0;
    let shapeCountCheckTimer = null;
    const QUIET_MS = 2000; // 2 秒内没有新的 change，认为本轮接收完成
    const FALLBACK_DELAY_MS = 5000; // 备用方案：固定延迟 5 秒
    
    function scheduleAck() {
      if (!currentRound) return;
      if (!channel) return;
      
      if (quietTimer) clearTimeout(quietTimer);
      
      quietTimer = setTimeout(() => {
        channel.postMessage({
          type: 'round-received',
          from: INSTANCE_ID,
          role: 'receiver',
          roundId: currentRound.roundId,
          size: currentRound.size,
          iteration: currentRound.iteration,
        });
        console.log(`✅ 已向绘制端确认本轮接收完成 (size=${currentRound.size}, iter=${currentRound.iteration})`);
        currentRound = null;
        quietTimer = null;
        if (shapeCountCheckTimer) {
          clearInterval(shapeCountCheckTimer);
          shapeCountCheckTimer = null;
        }
      }, QUIET_MS);
    }
    
    // 备用方案：通过 DOM 变化或图形数量变化来判断接收完成
    function setupFallbackDetection() {
      if (!currentRound) return;
      
      // 记录初始图形数量
      let initialShapeCount = 0;
      if (editor) {
        try {
          initialShapeCount = editor.getCurrentPageShapes().length;
        } catch (e) {
          // 忽略错误
        }
      } else {
        // 如果没有编辑器，通过 DOM 元素数量估算
        const shapeElements = document.querySelectorAll('.tl-shape');
        initialShapeCount = shapeElements.length;
      }
      
      console.log(`📊 开始监听图形变化（初始数量: ${initialShapeCount}）`);
      
      // 定期检查图形数量
      shapeCountCheckTimer = setInterval(() => {
        let currentShapeCount = 0;
        
        if (editor) {
          try {
            currentShapeCount = editor.getCurrentPageShapes().length;
          } catch (e) {
            // 如果编辑器方法失败，使用 DOM 方法
            const shapeElements = document.querySelectorAll('.tl-shape');
            currentShapeCount = shapeElements.length;
          }
        } else {
          // 使用 DOM 方法
          const shapeElements = document.querySelectorAll('.tl-shape');
          currentShapeCount = shapeElements.length;
        }
        
        // 如果图形数量发生变化，重置计时器
        if (currentShapeCount !== lastShapeCount) {
          lastShapeCount = currentShapeCount;
          scheduleAck(); // 重新开始计时
        }
      }, 500); // 每 500ms 检查一次
      
      // 备用：固定延迟后发送确认（防止永远收不到）
      setTimeout(() => {
        if (currentRound && quietTimer) {
          console.log(`⏰ 备用方案：固定延迟 ${FALLBACK_DELAY_MS/1000} 秒后发送确认`);
          scheduleAck();
        }
      }, FALLBACK_DELAY_MS);
    }
    
    // 监听绘制端的通知
    channel.addEventListener('message', (event) => {
      const data = event.data || event;
      if (!data || data.type !== 'round-sent') return;
      // 忽略自己发出的 round-sent，只响应其他窗口的
      if (data.from === INSTANCE_ID) return;
      
      currentRound = {
        roundId: data.roundId,
        size: data.size,
        iteration: data.iteration,
      };
      
      console.log(`📨 收到绘制端通知：已发送一轮 (size=${data.size}, iter=${data.iteration})，等待本端接收完成...`);
      
      // 记录初始图形数量
      if (editor) {
        try {
          lastShapeCount = editor.getCurrentPageShapes().length;
        } catch (e) {
          const shapeElements = document.querySelectorAll('.tl-shape');
          lastShapeCount = shapeElements.length;
        }
      } else {
        const shapeElements = document.querySelectorAll('.tl-shape');
        lastShapeCount = shapeElements.length;
      }
      
      // 如果编辑器可用，使用编辑器事件监听
      if (editor && typeof editor.on === 'function') {
        console.log('✅ 使用编辑器 change 事件监听');
        // 每次收到新的 round-sent，都重新开始监听 quiet 窗口
        scheduleAck();
      } else {
        // 如果编辑器不可用，使用备用方案
        console.log('⚠️ 编辑器不可用，使用备用方案（DOM变化检测 + 固定延迟）');
        setupFallbackDetection();
      }
    });
    
    // 如果编辑器可用，通过编辑器 change 事件来判断"接收中"与"空闲"
    if (editor && typeof editor.on === 'function') {
      editor.on('change', () => {
        if (!currentRound) return;
        scheduleAck();
      });
    } else {
      console.log('⚠️ 无法使用编辑器事件，将使用备用检测方案');
    }
  }
  
  // 所有窗口都启动接收端监听（这样即便忘了设置 ROLE，也能收到 round-sent）
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
