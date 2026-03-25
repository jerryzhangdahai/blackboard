/**
 * tldraw hitTest 性能测试脚本（浏览器控制台）
 * 
 * 测试目标：验证原生 tldraw 协同白板的命中检测（hitTest）性能
 * - 大量重叠图形的点击选择性能
 * - 不同堆叠深度的响应时间
 * - 内存使用情况
 * 
 * 使用方法:
 *   1. 启动前端和后端服务（npm run dev）
 *   2. 在浏览器中打开白板页面（http://localhost:5173）
 *   3. 打开浏览器控制台（F12）
 *   4. 复制此脚本内容到控制台执行
 *   5. 观察控制台输出的性能数据
 * 
 * 测试场景：
 * - 创建大量重叠图形（不同堆叠深度：10、50、100、200 个图形/位置）
 * - 随机点击测试 hitTest 性能（100 次点击）
 * - 测量选择操作的响应时间（平均、最小、最大、P95）
 * - 测量内存使用情况（创建图形和 hitTest 测试的内存增量）
 * 
 * 注意：此脚本针对原生 tldraw 开发的协同白板进行测试
 */

(function() {
  'use strict';
  
  console.log('🎯 hitTest 性能测试脚本');
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
    stackDepths: [10, 50, 100, 200], // 每个位置堆叠的图形数
    // 测试位置数量
    testPositions: 20, // 在画布上创建20个堆叠区域
    // 每个测试的点击次数
    clickTests: 100,
    // 画布尺寸
    canvasWidth: 2000,
    canvasHeight: 1500,
    // 图形大小（重叠区域）
    shapeSize: 100,
    // 可视化开关：关闭可以让测试更接近纯性能（避免 DOM 操作干扰测量）
    visual: true,
    // 命中测试预热次数（避免首次调用抖动）
    warmup: 10,
  };
  
  // 等待 tldraw 编辑器准备就绪
  function waitForEditor() {
    return new Promise((resolve) => {
      const checkEditor = setInterval(() => {
        let editor = null;
        
        if (window.__tldrawEditor) {
          editor = window.__tldrawEditor;
        } else if (document.querySelector('[data-tldraw]')) {
          const container = document.querySelector('.tl-container');
          if (container && container.__editor) {
            editor = container.__editor;
          }
        }
        
        if (editor && 
            typeof editor.getCurrentPageShapes === 'function' &&
            typeof editor.createShapes === 'function') {
          clearInterval(checkEditor);
          resolve(editor);
        }
      }, 200);
      
      setTimeout(() => {
        clearInterval(checkEditor);
        console.warn('⚠️ 无法自动获取编辑器');
        resolve(null);
      }, 15000);
    });
  }
  
  // 生成堆叠图形
  function generateStackedShapes(editor, centerX, centerY, count, index) {
    const shapes = [];
    const colors = ['black', 'blue', 'green', 'red', 'yellow', 'orange', 'violet'];
    
    for (let i = 0; i < count; i++) {
      const offset = (i * 2); // 轻微偏移，确保重叠
      const color = colors[i % colors.length];
      
      shapes.push({
        id: `shape:stack-${index}-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        typeName: 'shape',
        type: 'geo',
        x: centerX - TEST_CONFIG.shapeSize / 2 + offset,
        y: centerY - TEST_CONFIG.shapeSize / 2 + offset,
        rotation: Math.random() * Math.PI * 2, // 随机旋转增加复杂度
        isLocked: false,
        opacity: 0.5 + Math.random() * 0.5, // 随机透明度
        props: {
          w: TEST_CONFIG.shapeSize,
          h: TEST_CONFIG.shapeSize,
          geo: i % 2 === 0 ? 'rectangle' : 'ellipse', // 混合矩形和圆形
          color,
          size: 'm',
          dash: 'draw',
          fill: Math.random() > 0.7 ? (Math.random() > 0.5 ? 'solid' : 'semi') : 'none', // 30%概率填充（solid 或 semi）
        },
      });
    }
    
    return shapes;
  }
  
  // 执行 hitTest 性能测试
  async function runHitTestPerformanceTest() {
    const editor = await waitForEditor();
    
    if (!editor) {
      console.error('❌ 无法找到 tldraw 编辑器');
      return;
    }
    
    // 测试前清空画布
    console.log('🧹 清空画布...');
    console.log('   使用的 API（tldraw 原生方法）：');
    console.log('   - editor.getCurrentPageShapes() - 获取当前页面的所有图形');
    console.log('   - editor.deleteShapes(shapeIds) - 批量删除指定的图形');
    
    const currentShapes = editor.getCurrentPageShapes();
    if (currentShapes.length > 0) {
      const shapeIds = currentShapes.map(s => s.id);
      console.log(`   发现 ${currentShapes.length} 个图形，正在删除...`);
      editor.deleteShapes(shapeIds);
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('   ✅ 画布已清空');
    } else {
      console.log('   ℹ️ 画布已经是空的');
    }
    console.log('');
    
    const results = [];
    
    // 为每个堆叠深度创建测试
    for (const stackDepth of TEST_CONFIG.stackDepths) {
      console.log(`\n📊 测试堆叠深度: ${stackDepth} 个图形/位置`);
      console.log('----------------------------------------');
      
      // 清空画布
      const existingShapes = editor.getCurrentPageShapes();
      if (existingShapes.length > 0) {
        editor.deleteShapes(existingShapes.map(s => s.id));
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // 创建堆叠区域
      const allShapes = [];
      const stackCenters = [];
      
      for (let i = 0; i < TEST_CONFIG.testPositions; i++) {
        const centerX = (Math.random() * (TEST_CONFIG.canvasWidth - TEST_CONFIG.shapeSize)) + TEST_CONFIG.shapeSize / 2;
        const centerY = (Math.random() * (TEST_CONFIG.canvasHeight - TEST_CONFIG.shapeSize)) + TEST_CONFIG.shapeSize / 2;
        
        stackCenters.push({ x: centerX, y: centerY });
        const stackedShapes = generateStackedShapes(editor, centerX, centerY, stackDepth, i);
        allShapes.push(...stackedShapes);
      }
      
      console.log(`创建 ${allShapes.length} 个图形（${TEST_CONFIG.testPositions} 个堆叠区域，每个 ${stackDepth} 个图形）...`);
      
      // 创建可视化进度显示
      // 清理上一轮面板（如果用户没手动关闭）
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
      
      // 内存测量：等待GC稳定后再测量（借鉴 test-incremental-drawing.js 的采样逻辑）
      await new Promise(resolve => setTimeout(resolve, 200));
      const memoryBefore = performance.memory ? performance.memory.usedJSHeapSize : 0;
      
      // 记录创建图形的开始时间（只计算实际创建时间，不包含等待时间）
      const createStartTime = performance.now();
      
      // 批量创建图形
      const batchSize = 200;
      let createdCount = 0;
      for (let i = 0; i < allShapes.length; i += batchSize) {
        const batch = allShapes.slice(i, i + batchSize);
        editor.createShapes(batch);
        createdCount += batch.length;
        
        // 更新进度
        const percent = Math.round((createdCount / allShapes.length) * 100);
        if (createProgressEl) createProgressEl.textContent = String(percent);
        if (createProgressBarEl) createProgressBarEl.style.width = percent + '%';
        
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      // 记录创建图形的结束时间（在等待之前，只计算实际创建时间）
      const createEndTime = performance.now();
      const createDuration = createEndTime - createStartTime;
      
      // 等待渲染完成（这部分时间不计入性能测试）
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 多次采样内存值，取平均值（减少GC波动影响，借鉴 test-incremental-drawing.js）
      let memorySamples = [];
      for (let i = 0; i < 3; i++) {
        if (performance.memory) {
          memorySamples.push(performance.memory.usedJSHeapSize);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // 记录内存使用（创建后的内存值）
      const memoryAfter = memorySamples.length > 0 
        ? memorySamples.reduce((a, b) => a + b, 0) / memorySamples.length 
        : (performance.memory ? performance.memory.usedJSHeapSize : 0);
      
      const memoryDelta = memoryAfter - memoryBefore;
      
      // 在堆叠区域周围添加标记（可视化堆叠位置）
      if (TEST_CONFIG.visual && editor.pageToScreen) {
        // 清理上轮残留
        document.querySelectorAll('[data-stack-id]').forEach(el => el.remove());
        stackCenters.forEach((center, idx) => {
          try {
            const tl = editor.pageToScreen({ x: center.x - TEST_CONFIG.shapeSize / 2, y: center.y - TEST_CONFIG.shapeSize / 2 });
            const br = editor.pageToScreen({ x: center.x + TEST_CONFIG.shapeSize / 2, y: center.y + TEST_CONFIG.shapeSize / 2 });
            const marker = document.createElement('div');
            marker.style.cssText = `
              position: fixed;
              left: ${Math.min(tl.x, br.x)}px;
              top: ${Math.min(tl.y, br.y)}px;
              width: ${Math.abs(br.x - tl.x)}px;
              height: ${Math.abs(br.y - tl.y)}px;
              border: 2px dashed rgba(255, 165, 0, 0.6);
              background: rgba(255, 165, 0, 0.08);
              pointer-events: none;
              z-index: 9999;
              border-radius: 6px;
            `;
            marker.setAttribute('data-stack-id', idx);
            document.body.appendChild(marker);
          } catch (e) {
            // ignore
          }
        });
      }
      
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
      const canHitTest = typeof editor.getShapeAtPoint === 'function';
      if (!canHitTest) {
        console.warn('⚠️ 当前 tldraw 版本没有 getShapeAtPoint，脚本将测量空调用开销（结果不具参考性）。');
      }
      
      // 预热（避免首次调用带来抖动）
      for (let i = 0; i < TEST_CONFIG.warmup; i++) {
        const c = stackCenters[i % stackCenters.length];
        const px = c.x + (Math.random() - 0.5) * TEST_CONFIG.shapeSize;
        const py = c.y + (Math.random() - 0.5) * TEST_CONFIG.shapeSize;
        try { if (canHitTest) editor.getShapeAtPoint({ x: px, y: py }); } catch (e) {}
      }
      
      // 记录 hitTest 测试开始前的内存（用于计算 hitTest 测试的内存开销）
      await new Promise(resolve => setTimeout(resolve, 100));
      const hitTestMemoryBefore = performance.memory ? performance.memory.usedJSHeapSize : 0;
      
      // 记录 hitTest 测试的开始时间
      const hitTestStartTime = performance.now();
      
      for (let i = 0; i < TEST_CONFIG.clickTests; i++) {
        // 随机选择一个堆叠中心进行点击
        const stackCenter = stackCenters[Math.floor(Math.random() * stackCenters.length)];
        
        // 在堆叠区域内随机偏移
        const clickX = stackCenter.x + (Math.random() - 0.5) * TEST_CONFIG.shapeSize;
        const clickY = stackCenter.y + (Math.random() - 0.5) * TEST_CONFIG.shapeSize;
        
        // 纯 hitTest 计时（避免 DOM 可视化干扰测量）
        const startTime = performance.now();
        try {
          if (canHitTest) editor.getShapeAtPoint({ x: clickX, y: clickY });
        } catch (e) {
          // ignore
        }
        const endTime = performance.now();
        clickTimes.push(endTime - startTime);
        
        // 可视化点击位置（短暂高亮）——放到计时之后
        if (TEST_CONFIG.visual && editor.pageToScreen) {
          try {
            // 确保样式已添加（只添加一次）
            if (!document.getElementById('hittest-animation-style')) {
              const style = document.createElement('style');
              style.id = 'hittest-animation-style';
              style.textContent = `
                @keyframes hittestFadeOut {
                  to { opacity: 0; transform: translate(-50%, -50%) scale(2); }
                }
              `;
              document.head.appendChild(style);
            }
            const sp = editor.pageToScreen({ x: clickX, y: clickY });
            const highlight = document.createElement('div');
            highlight.style.cssText = `
              position: fixed;
              left: ${sp.x}px;
              top: ${sp.y}px;
              width: 10px;
              height: 10px;
              background: rgba(255, 0, 0, 0.85);
              border: 2px solid rgba(255, 255, 255, 0.75);
              border-radius: 50%;
              pointer-events: none;
              z-index: 10001;
              transform: translate(-50%, -50%);
              animation: hittestFadeOut 0.6s forwards;
            `;
            document.body.appendChild(highlight);
            setTimeout(() => highlight.remove(), 600);
          } catch (e) {}
        }
        
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
      
      // 记录 hitTest 测试的结束时间
      const hitTestEndTime = performance.now();
      const hitTestDuration = hitTestEndTime - hitTestStartTime;
      
      // 多次采样内存值，取平均值（减少GC波动影响）
      let hitTestMemorySamples = [];
      for (let i = 0; i < 3; i++) {
        if (performance.memory) {
          hitTestMemorySamples.push(performance.memory.usedJSHeapSize);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const hitTestMemoryAfter = hitTestMemorySamples.length > 0 
        ? hitTestMemorySamples.reduce((a, b) => a + b, 0) / hitTestMemorySamples.length 
        : (performance.memory ? performance.memory.usedJSHeapSize : 0);
      
      const hitTestMemoryDelta = hitTestMemoryAfter - hitTestMemoryBefore;
      
      // 移除堆叠区域标记
      document.querySelectorAll('[data-stack-id]').forEach(el => el.remove());
      
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
        createDuration, // 创建图形耗时（不包含等待时间）
        hitTestDuration, // hitTest 测试总耗时
        memoryDelta, // 创建图形的内存增量
        hitTestMemoryDelta, // hitTest 测试的内存增量
      });
      
      // 更新最终结果显示（复用进度面板，不再在每轮都新建别的面板）
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
            <div style="margin-top:5px;border-top:1px solid #555;padding-top:5px;">
              <div>创建耗时: ${createDuration.toFixed(2)}ms</div>
              <div>hitTest总耗时: ${hitTestDuration.toFixed(2)}ms</div>
              <div>内存增量: ${(memoryDelta / 1024 / 1024).toFixed(2)}MB</div>
            </div>
          </div>
        `;
        makePanelDraggableAndClosable(finalDiv);
      }
      
      console.log(`  平均响应时间: ${avgTime.toFixed(2)}ms`);
      console.log(`  最小: ${minTime.toFixed(2)}ms, 最大: ${maxTime.toFixed(2)}ms`);
      console.log(`  P95: ${p95Time.toFixed(2)}ms`);
      console.log(`  创建耗时: ${createDuration.toFixed(2)}ms`);
      console.log(`  hitTest总耗时: ${hitTestDuration.toFixed(2)}ms`);
      console.log(`  内存增量: ${(memoryDelta / 1024 / 1024).toFixed(2)}MB`);
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
    // 清理旧结果面板（如果用户没手动关闭）
    document.querySelectorAll('[data-role="hittest-results-panel"]').forEach(el => el.remove());
    const resultsDiv = document.createElement('div');
    resultsDiv.setAttribute('data-role', 'hittest-results-panel');
    resultsDiv.style.cssText = 'position:fixed;bottom:20px;right:20px;background:rgba(0,0,0,0.9);color:#fff;padding:16px 18px;border-radius:8px;z-index:10000;font-family:monospace;min-width:360px;max-width:520px;max-height:70vh;overflow:auto;box-sizing:border-box;';
    resultsDiv.innerHTML = `
      <div style="font-weight:bold;font-size:16px;margin-bottom:15px;">🎯 hitTest 性能测试结果</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
          <tr style="border-bottom:1px solid #555;">
            <th style="text-align:left;padding:5px;">堆叠深度</th>
            <th style="text-align:right;padding:5px;">总图形数</th>
            <th style="text-align:right;padding:5px;">平均(ms)</th>
            <th style="text-align:right;padding:5px;">最小(ms)</th>
            <th style="text-align:right;padding:5px;">最大(ms)</th>
            <th style="text-align:right;padding:5px;">P95(ms)</th>
            <th style="text-align:right;padding:5px;">创建耗时(ms)</th>
            <th style="text-align:right;padding:5px;">hitTest总耗时(ms)</th>
            <th style="text-align:right;padding:5px;">内存增量(MB)</th>
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
        <td style="text-align:right;padding:5px;color:#2196F3">${r.createDuration ? r.createDuration.toFixed(2) : '-'}</td>
        <td style="text-align:right;padding:5px;color:#2196F3">${r.hitTestDuration ? r.hitTestDuration.toFixed(2) : '-'}</td>
        <td style="text-align:right;padding:5px;color:#9C27B0">${r.memoryDelta ? (r.memoryDelta / 1024 / 1024).toFixed(2) : '-'}</td>
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
