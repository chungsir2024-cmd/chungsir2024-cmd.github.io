/* ==========================================================================
   tools.js - 《晨崗數學勇者‧周界篇》平面圖形繪製與三大測量工具引擎
   包含：1. 方格紙逐格計數工具  2. 軟尺圈選收緊工具  3. 繩段磁吸貼邊工具
   ========================================================================== */

const mainCanvas = document.getElementById('mainCanvas');
const mainCtx = mainCanvas.getContext('2d');

let activeTool = null;
let gridSize = 36;
let originX = 72;
let originY = 72;

// 1. 方格紙工具狀態
let gridSegments = [];
let isGridSwiping = false;
let hoverSegmentId = -1;
let floatingPlusOnes = [];

// 2. 軟尺工具狀態（圈選收緊）
let isLassoing = false;
let lassoPoints = [];
let rulerTightenState = 'idle';
let animStartLoop = [];
let animTargetHull = [];
let animProgress = 0;
let rulerFailedConcave = false;

// 3. 繩段工具狀態（自動磁吸貼邊）
let isStringTracing = false;
let densePerimeter = [];
let stringStartIdx = -1;
let stringCurrentIdx = -1;
let stringUnwrapped = 0;
let stringMinProg = 0;
let stringMaxProg = 0;
let stringComplete = false;
let pointerSnapPos = null;

function resizeAndLayoutCanvas() {
  const parent = mainCanvas.parentElement;
  if (!parent) return;
  const cw = parent.clientWidth;
  const ch = parent.clientHeight;
  if (cw === 0 || ch === 0) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  mainCanvas.width = Math.floor(cw * dpr);
  mainCanvas.height = Math.floor(ch * dpr);
  mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (typeof gameState !== 'undefined' && gameState.currentQuestion) {
    computeShapeScreenLayout(cw, ch);
    rebuildToolGeometry(true);
  }
  renderMainCanvas();
}
window.addEventListener('resize', resizeAndLayoutCanvas);

function computeShapeScreenLayout(cw, ch) {
  const q = gameState.currentQuestion;
  const xs = q.path.map(p => p.x);
  const ys = q.path.map(p => p.y);
  const wCm = Math.max(...xs) - Math.min(...xs);
  const hCm = Math.max(...ys) - Math.min(...ys);

  const marginX = Math.max(68, cw * 0.16);
  const marginY = Math.max(46, ch * 0.16);
  const rawCell = Math.floor(Math.min((cw - marginX * 2) / wCm, (ch - marginY * 2) / hCm));
  gridSize = Math.max(22, Math.min(46, rawCell));

  const shapePxW = wCm * gridSize;
  const shapePxH = hCm * gridSize;

  originX = Math.max(gridSize, Math.round(((cw - shapePxW) / 2) / gridSize) * gridSize);
  originY = Math.max(gridSize, Math.round(((ch - shapePxH) / 2) / gridSize) * gridSize);
}

function getScreenPolygonPoints() {
  const q = gameState.currentQuestion;
  return q.path.map(p => ({
    x: originX + p.x * gridSize,
    y: originY + p.y * gridSize
  }));
}

function rebuildToolGeometry(preserveGridSelection = false) {
  const q = gameState.currentQuestion;
  if (!q) return;
  const prevSel = preserveGridSelection ? gridSegments.map(s => s.selected) : [];

  gridSegments = [];
  let segIdx = 0;
  for (let i = 0; i < q.path.length; i++) {
    const p1 = q.path[i];
    const p2 = q.path[(i + 1) % q.path.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const steps = Math.round(Math.abs(dx) + Math.abs(dy));
    const sx = dx / steps;
    const sy = dy / steps;

    for (let u = 0; u < steps; u++) {
      gridSegments.push({
        id: segIdx,
        x1: originX + (p1.x + sx * u) * gridSize,
        y1: originY + (p1.y + sy * u) * gridSize,
        x2: originX + (p1.x + sx * (u + 1)) * gridSize,
        y2: originY + (p1.y + sy * (u + 1)) * gridSize,
        selected: prevSel[segIdx] || false,
        order: 0
      });
      segIdx++;
    }
  }
  renumberSelectedSegments();

  const pts = getScreenPolygonPoints();
  densePerimeter = [];
  const stepPx = 4;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const n = Math.max(1, Math.round(len / stepPx));
    for (let s = 0; s < n; s++) {
      const t = s / n;
      densePerimeter.push({
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t
      });
    }
  }
}

function renumberSelectedSegments() {
  let num = 1;
  gridSegments.forEach(s => { s.order = s.selected ? num++ : 0; });
}

/* ================= 工具切換與重置 ================= */
function toggleTool(tool) {
  if (typeof initAudio === 'function') initAudio();
  activeTool = (activeTool === tool) ? null : tool;

  document.querySelectorAll('.tool-toggle').forEach(btn => btn.classList.remove('active'));
  if (activeTool) {
    document.getElementById(`tool-${activeTool}`).classList.add('active');
  }

  resetToolOverlay();
}

function resetToolOverlay() {
  gridSegments.forEach(s => { s.selected = false; s.order = 0; });
  isGridSwiping = false;
  hoverSegmentId = -1;
  floatingPlusOnes = [];

  isLassoing = false;
  lassoPoints = [];
  rulerTightenState = 'idle';
  rulerFailedConcave = false;
  animProgress = 0;

  isStringTracing = false;
  stringStartIdx = -1;
  stringCurrentIdx = -1;
  stringUnwrapped = 0;
  stringMinProg = 0;
  stringMaxProg = 0;
  stringComplete = false;
  pointerSnapPos = null;

  updateToolUIBars();
  renderMainCanvas();
}

function updateToolUIBars() {
  const promptEl = document.getElementById('stage-prompt-text');
  const resetBtn = document.getElementById('btn-reset-tool');
  const idleHint = document.getElementById('tool-idle-hint');
  const gridPanel = document.getElementById('grid-count-panel');
  const unfoldBanner = document.getElementById('unfold-banner');

  resetBtn.classList.add('hidden');
  unfoldBanner.classList.add('hidden');
  gridPanel.classList.add('hidden');
  gridPanel.classList.remove('flex');
  idleHint.classList.remove('hidden');

  if (!activeTool) {
    promptEl.innerText = '請根據標示的尺寸計算周界（單位：cm）';
    idleHint.innerText = '點選工具可開啟方格背景、軟尺或繩段';
  } else if (activeTool === 'grid') {
    promptEl.innerText = '🏁 方格紙已開啟（1格 = 1cm）：點擊圖形邊緣可逐格高亮數數！';
    idleHint.classList.add('hidden');
    gridPanel.classList.remove('hidden');
    gridPanel.classList.add('flex');
    const count = gridSegments.filter(s => s.selected).length;
    document.getElementById('grid-count-val').innerText = `${count} cm`;
    if (count > 0) resetBtn.classList.remove('hidden');
  } else if (activeTool === 'ruler') {
    promptEl.innerText = '📏 軟尺已開啟：在圖形外圍「畫一個大圈」包圍圖形，放手後收緊！';
    idleHint.innerText = '在圖形外圍畫圈包圍（無法貼合內凹位）';
    if (rulerTightenState !== 'idle') resetBtn.classList.remove('hidden');
  } else if (activeTool === 'string') {
    promptEl.innerText = '🧶 繩段已開啟：沿圖形邊界描繪一圈，繩段會自動磁吸貼邊！';
    idleHint.innerText = '沿圖形邊緣畫一圈，完成後自動拉直測量';
    if (stringStartIdx >= 0) resetBtn.classList.remove('hidden');
  }
}

/* ================= 畫布主渲染引擎 ================= */
function renderMainCanvas() {
  const parent = mainCanvas.parentElement;
  if (!parent || typeof gameState === 'undefined' || !gameState.currentQuestion) return;
  const W = parent.clientWidth;
  const H = parent.clientHeight;
  mainCtx.clearRect(0, 0, W, H);

  const q = gameState.currentQuestion;
  const polyPts = getScreenPolygonPoints();

  if (activeTool === 'grid') {
    mainCtx.save();
    mainCtx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    mainCtx.lineWidth = 1;
    for (let x = 0; x <= W; x += gridSize) {
      mainCtx.beginPath(); mainCtx.moveTo(x, 0); mainCtx.lineTo(x, H); mainCtx.stroke();
    }
    for (let y = 0; y <= H; y += gridSize) {
      mainCtx.beginPath(); mainCtx.moveTo(0, y); mainCtx.lineTo(W, y); mainCtx.stroke();
    }

    mainCtx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    mainCtx.fillRect(10, H - 28, 134, 20);
    mainCtx.fillStyle = '#38bdf8';
    mainCtx.font = 'bold 12px "Noto Sans TC", sans-serif';
    mainCtx.fillText('📐 1 格邊長 = 1 cm', 16, H - 14);
    mainCtx.restore();
  }

  mainCtx.save();
  mainCtx.fillStyle = 'rgba(56, 189, 248, 0.24)';
  mainCtx.strokeStyle = '#38bdf8';
  mainCtx.lineWidth = 4;
  mainCtx.lineJoin = 'round';

  mainCtx.beginPath();
  mainCtx.moveTo(polyPts[0].x, polyPts[0].y);
  for (let i = 1; i < polyPts.length; i++) {
    mainCtx.lineTo(polyPts[i].x, polyPts[i].y);
  }
  mainCtx.closePath();
  mainCtx.fill();
  mainCtx.stroke();

  mainCtx.fillStyle = '#fef08a';
  polyPts.forEach(pt => {
    mainCtx.beginPath();
    mainCtx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    mainCtx.fill();
  });
  mainCtx.restore();

  if (activeTool === 'grid') {
    renderGridOverlay();
  } else if (activeTool === 'ruler') {
    renderRulerOverlay(polyPts);
  } else if (activeTool === 'string') {
    renderStringOverlay();
  }

  renderDimensionLabels(q, polyPts);
}

function renderDimensionLabels(q, polyPts) {
  mainCtx.save();
  mainCtx.font = 'bold 13px "Noto Sans TC", Arial, sans-serif';
  mainCtx.textAlign = 'center';
  mainCtx.textBaseline = 'middle';

  const placedBoxes = [];

  for (let i = 0; i < polyPts.length; i++) {
    if (!q.visibleEdges[i]) continue;

    const p1 = polyPts[i];
    const p2 = polyPts[(i + 1) % polyPts.length];
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len;
    const ny = -dx / len;

    const labelStr = `${q.edgeLengths[i]} cm`;
    const textW = mainCtx.measureText(labelStr).width;
    const boxW = textW + 10;
    const boxH = 20;

    let offsetDist = Math.abs(nx) > 0.5 ? (boxW / 2 + 10) : 17;
    let lx = mx + nx * offsetDist;
    let ly = my + ny * offsetDist;

    for (let b of placedBoxes) {
      if (Math.abs(lx - b.x) < (boxW + b.w) / 2 + 2 && Math.abs(ly - b.y) < (boxH + b.h) / 2 + 2) {
        offsetDist += 16;
        lx = mx + nx * offsetDist;
        ly = my + ny * offsetDist;
      }
    }
    placedBoxes.push({ x: lx, y: ly, w: boxW, h: boxH });

    mainCtx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    mainCtx.strokeStyle = '#fbbf24';
    mainCtx.lineWidth = 1.5;
    roundRect(mainCtx, lx - boxW / 2, ly - boxH / 2, boxW, boxH, 5);
    mainCtx.fill();
    mainCtx.stroke();

    mainCtx.fillStyle = '#fef08a';
    mainCtx.fillText(labelStr, lx, ly + 0.5);
  }
  mainCtx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function renderGridOverlay() {
  if (hoverSegmentId >= 0 && gridSegments[hoverSegmentId] && !gridSegments[hoverSegmentId].selected) {
    const h = gridSegments[hoverSegmentId];
    mainCtx.save();
    mainCtx.strokeStyle = 'rgba(16, 185, 129, 0.55)';
    mainCtx.lineWidth = 10;
    mainCtx.lineCap = 'round';
    mainCtx.beginPath();
    mainCtx.moveTo(h.x1, h.y1);
    mainCtx.lineTo(h.x2, h.y2);
    mainCtx.stroke();
    mainCtx.restore();
  }

  gridSegments.forEach(seg => {
    if (seg.selected) {
      mainCtx.save();
      mainCtx.shadowColor = '#10b981';
      mainCtx.shadowBlur = 10;
      mainCtx.strokeStyle = '#10b981';
      mainCtx.lineWidth = 8;
      mainCtx.lineCap = 'round';
      mainCtx.beginPath();
      mainCtx.moveTo(seg.x1, seg.y1);
      mainCtx.lineTo(seg.x2, seg.y2);
      mainCtx.stroke();

      mainCtx.shadowBlur = 0;
      mainCtx.strokeStyle = '#a7f3d0';
      mainCtx.lineWidth = 2.5;
      mainCtx.stroke();
      mainCtx.restore();
    }
  });

  mainCtx.save();
  gridSegments.forEach(seg => {
    mainCtx.fillStyle = seg.selected ? '#059669' : '#0f172a';
    mainCtx.strokeStyle = seg.selected ? '#ffffff' : '#38bdf8';
    mainCtx.lineWidth = 1.8;
    mainCtx.beginPath();
    mainCtx.arc(seg.x1, seg.y1, 3.5, 0, Math.PI * 2);
    mainCtx.fill();
    mainCtx.stroke();
  });
  mainCtx.restore();

  gridSegments.forEach(seg => {
    if (seg.selected && seg.order > 0) {
      const mx = (seg.x1 + seg.x2) / 2;
      const my = (seg.y1 + seg.y2) / 2;
      mainCtx.save();
      mainCtx.fillStyle = '#065f46';
      mainCtx.strokeStyle = '#ffffff';
      mainCtx.lineWidth = 1.5;
      mainCtx.beginPath();
      mainCtx.arc(mx, my, 9, 0, Math.PI * 2);
      mainCtx.fill();
      mainCtx.stroke();

      mainCtx.fillStyle = '#ffffff';
      mainCtx.font = 'bold 10px Arial';
      mainCtx.textAlign = 'center';
      mainCtx.textBaseline = 'middle';
      mainCtx.fillText(seg.order, mx, my + 0.5);
      mainCtx.restore();
    }
  });

  floatingPlusOnes.forEach(fp => {
    mainCtx.save();
    mainCtx.globalAlpha = fp.alpha;
    mainCtx.fillStyle = fp.color;
    mainCtx.font = 'bold 16px "Noto Sans TC", sans-serif';
    mainCtx.textAlign = 'center';
    mainCtx.fillText(fp.text, fp.x, fp.y + fp.offsetY);
    mainCtx.restore();
  });
}

function renderRulerOverlay(polyPts) {
  if (isLassoing && lassoPoints.length > 1) {
    drawTapeLoop(lassoPoints, false, false);
  } else if (rulerTightenState === 'animating' || rulerTightenState === 'done') {
    const ease = 1 - Math.pow(1 - animProgress, 3);
    const currentLoop = animStartLoop.map((p, idx) => ({
      x: p.x + (animTargetHull[idx].x - p.x) * ease,
      y: p.y + (animTargetHull[idx].y - p.y) * ease
    }));

    if (rulerTightenState === 'done' && rulerFailedConcave) {
      mainCtx.save();
      mainCtx.fillStyle = 'rgba(244, 63, 94, 0.32)';
      mainCtx.beginPath();
      mainCtx.moveTo(animTargetHull[0].x, animTargetHull[0].y);
      for (let i = 1; i < animTargetHull.length; i++) {
        mainCtx.lineTo(animTargetHull[i].x, animTargetHull[i].y);
      }
      mainCtx.closePath();
      mainCtx.moveTo(polyPts[0].x, polyPts[0].y);
      for (let i = 1; i < polyPts.length; i++) {
        mainCtx.lineTo(polyPts[i].x, polyPts[i].y);
      }
      mainCtx.closePath();
      mainCtx.fill('evenodd');
      mainCtx.restore();
    }

    drawTapeLoop(currentLoop, true, rulerTightenState === 'done' && rulerFailedConcave);
  }
}

function drawTapeLoop(pts, closed, isError) {
  if (pts.length < 2) return;
  mainCtx.save();
  mainCtx.strokeStyle = isError ? '#f43f5e' : '#eab308';
  mainCtx.lineWidth = 9;
  mainCtx.lineCap = 'round';
  mainCtx.lineJoin = 'round';

  mainCtx.beginPath();
  mainCtx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    mainCtx.lineTo(pts[i].x, pts[i].y);
  }
  if (closed) mainCtx.closePath();
  mainCtx.stroke();

  mainCtx.strokeStyle = isError ? '#ffe4e6' : '#fef08a';
  mainCtx.lineWidth = 4;
  mainCtx.stroke();

  mainCtx.strokeStyle = isError ? '#9f1239' : '#854d0e';
  mainCtx.lineWidth = 2;
  mainCtx.setLineDash([2, 8]);
  mainCtx.stroke();
  mainCtx.restore();
}

function renderStringOverlay() {
  if (densePerimeter.length === 0) return;
  const M = densePerimeter.length;

  if (stringStartIdx >= 0) {
    const sp = densePerimeter[stringStartIdx];
    mainCtx.save();
    mainCtx.fillStyle = '#10b981';
    mainCtx.strokeStyle = '#ffffff';
    mainCtx.lineWidth = 2.5;
    mainCtx.beginPath();
    mainCtx.arc(sp.x, sp.y, 7, 0, Math.PI * 2);
    mainCtx.fill();
    mainCtx.stroke();
    mainCtx.restore();
  }

  const span = stringMaxProg - stringMinProg;
  if (span > 0) {
    mainCtx.save();
    mainCtx.strokeStyle = '#ef4444';
    mainCtx.lineWidth = 7;
    mainCtx.lineCap = 'round';
    mainCtx.lineJoin = 'round';

    mainCtx.beginPath();
    const totalSteps = Math.min(M, span);
    for (let s = 0; s <= totalSteps; s++) {
      const idx = (((stringStartIdx + stringMinProg + s) % M) + M) % M;
      const pt = densePerimeter[idx];
      if (s === 0) mainCtx.moveTo(pt.x, pt.y);
      else mainCtx.lineTo(pt.x, pt.y);
    }
    if (stringComplete) mainCtx.closePath();
    mainCtx.stroke();

    mainCtx.strokeStyle = '#fecaca';
    mainCtx.lineWidth = 2;
    mainCtx.setLineDash([5, 5]);
    mainCtx.stroke();
    mainCtx.restore();
  }

  if (isStringTracing && pointerSnapPos && !stringComplete) {
    mainCtx.save();
    mainCtx.strokeStyle = 'rgba(248, 113, 113, 0.55)';
    mainCtx.lineWidth = 2;
    mainCtx.setLineDash([3, 3]);
    mainCtx.beginPath();
    mainCtx.moveTo(pointerSnapPos.fingerX, pointerSnapPos.fingerY);
    mainCtx.lineTo(pointerSnapPos.snapX, pointerSnapPos.snapY);
    mainCtx.stroke();

    mainCtx.setLineDash([]);
    mainCtx.fillStyle = '#ef4444';
    mainCtx.beginPath();
    mainCtx.arc(pointerSnapPos.snapX, pointerSnapPos.snapY, 6, 0, Math.PI * 2);
    mainCtx.fill();
    mainCtx.restore();
  }
}

/* ================= 畫布指標互動 ================= */
mainCanvas.addEventListener('pointerdown', (e) => {
  if (!activeTool || typeof gameState === 'undefined' || !gameState.currentQuestion) return;
  if (typeof initAudio === 'function') initAudio();
  const rect = mainCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (activeTool === 'grid') {
    const hitSeg = findNearestGridSegment(x, y, 22);
    if (hitSeg) {
      hitSeg.selected = !hitSeg.selected;
      renumberSelectedSegments();
      const count = gridSegments.filter(s => s.selected).length;
      if (hitSeg.selected) {
        if (typeof playSound === 'function') playSound('tick_add', count);
        spawnFloatingPlusOne((hitSeg.x1 + hitSeg.x2) / 2, (hitSeg.y1 + hitSeg.y2) / 2, true);
        isGridSwiping = true;
      } else {
        if (typeof playSound === 'function') playSound('tick_remove');
        spawnFloatingPlusOne((hitSeg.x1 + hitSeg.x2) / 2, (hitSeg.y1 + hitSeg.y2) / 2, false);
      }
      updateToolUIBars();
      renderMainCanvas();
    }
  } else if (activeTool === 'ruler') {
    if (rulerTightenState === 'animating') return;
    resetToolOverlay();
    isLassoing = true;
    lassoPoints = [{ x, y }];
    renderMainCanvas();
  } else if (activeTool === 'string') {
    if (stringComplete) return;
    const nearest = findNearestBoundaryPoint(x, y, 0, densePerimeter.length, true);
    if (nearest && nearest.dist <= 75) {
      isStringTracing = true;
      if (stringStartIdx === -1) {
        stringStartIdx = nearest.index;
        stringCurrentIdx = nearest.index;
        stringUnwrapped = 0;
        stringMinProg = 0;
        stringMaxProg = 0;
        if (typeof playSound === 'function') playSound('tick_add', 2);
      } else {
        const M = densePerimeter.length;
        const endIdx1 = (((stringStartIdx + stringMinProg) % M) + M) % M;
        const endIdx2 = (((stringStartIdx + stringMaxProg) % M) + M) % M;
        const d1 = Math.hypot(x - densePerimeter[endIdx1].x, y - densePerimeter[endIdx1].y);
        const d2 = Math.hypot(x - densePerimeter[endIdx2].x, y - densePerimeter[endIdx2].y);
        if (d1 < d2 && d1 <= 75) {
          stringCurrentIdx = endIdx1;
          stringUnwrapped = stringMinProg;
        } else if (d2 <= 75) {
          stringCurrentIdx = endIdx2;
          stringUnwrapped = stringMaxProg;
        } else {
          stringStartIdx = nearest.index;
          stringCurrentIdx = nearest.index;
          stringUnwrapped = 0;
          stringMinProg = 0;
          stringMaxProg = 0;
        }
      }
      pointerSnapPos = {
        fingerX: x, fingerY: y,
        snapX: densePerimeter[stringCurrentIdx].x,
        snapY: densePerimeter[stringCurrentIdx].y
      };
      updateToolUIBars();
      renderMainCanvas();
    }
  }
});

window.addEventListener('pointermove', (e) => {
  if (!activeTool || typeof gameState === 'undefined' || !gameState.currentQuestion) return;
  const rect = mainCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (activeTool === 'grid') {
    const nearSeg = findNearestGridSegment(x, y, 20);
    const newHoverId = nearSeg ? nearSeg.id : -1;
    if (newHoverId !== hoverSegmentId) {
      hoverSegmentId = newHoverId;
      renderMainCanvas();
    }
    if (isGridSwiping && nearSeg && !nearSeg.selected) {
      nearSeg.selected = true;
      renumberSelectedSegments();
      const count = gridSegments.filter(s => s.selected).length;
      if (typeof playSound === 'function') playSound('tick_add', count);
      spawnFloatingPlusOne((nearSeg.x1 + nearSeg.x2) / 2, (nearSeg.y1 + nearSeg.y2) / 2, true);
      updateToolUIBars();
      renderMainCanvas();
    }
  } else if (activeTool === 'ruler' && isLassoing) {
    const last = lassoPoints[lassoPoints.length - 1];
    if (Math.hypot(x - last.x, y - last.y) > 6) {
      lassoPoints.push({ x, y });
      renderMainCanvas();
    }
  } else if (activeTool === 'string' && isStringTracing && !stringComplete) {
    const M = densePerimeter.length;
    const nearest = findNearestBoundaryPoint(x, y, stringCurrentIdx, 30, false);
    if (nearest && nearest.dist <= 95) {
      let delta = nearest.index - stringCurrentIdx;
      if (delta > M / 2) delta -= M;
      if (delta < -M / 2) delta += M;

      stringCurrentIdx = nearest.index;
      stringUnwrapped += delta;
      if (stringUnwrapped < stringMinProg) stringMinProg = stringUnwrapped;
      if (stringUnwrapped > stringMaxProg) stringMaxProg = stringUnwrapped;

      pointerSnapPos = {
        fingerX: x, fingerY: y,
        snapX: densePerimeter[stringCurrentIdx].x,
        snapY: densePerimeter[stringCurrentIdx].y
      };

      if ((stringMaxProg - stringMinProg) >= Math.floor(M * 0.96)) {
        stringMaxProg = stringMinProg + M;
        stringComplete = true;
        isStringTracing = false;
        pointerSnapPos = null;
        if (typeof playSound === 'function') playSound('correct');
        showUnfoldedTool('string', gameState.currentQuestion.perimeter);
      }
      renderMainCanvas();
    }
  }
});

window.addEventListener('pointerup', () => {
  if (isGridSwiping) isGridSwiping = false;

  if (activeTool === 'ruler' && isLassoing) {
    isLassoing = false;
    finalizeRulerLasso();
  }

  if (isStringTracing) {
    isStringTracing = false;
    pointerSnapPos = null;
    renderMainCanvas();
  }
});

/* --- 幾何輔助函數 --- */
function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

function findNearestGridSegment(px, py, maxDist) {
  let best = null, minD = maxDist;
  for (let seg of gridSegments) {
    const d = distToSegment(px, py, seg.x1, seg.y1, seg.x2, seg.y2);
    if (d < minD) { minD = d; best = seg; }
  }
  return best;
}

function findNearestBoundaryPoint(x, y, centerIdx, radius, searchAll) {
  const M = densePerimeter.length;
  if (M === 0) return null;
  let bestIdx = -1, minDist = Infinity;
  if (searchAll) {
    for (let i = 0; i < M; i++) {
      const d = Math.hypot(x - densePerimeter[i].x, y - densePerimeter[i].y);
      if (d < minDist) { minDist = d; bestIdx = i; }
    }
  } else {
    for (let off = -radius; off <= radius; off++) {
      const i = (((centerIdx + off) % M) + M) % M;
      const d = Math.hypot(x - densePerimeter[i].x, y - densePerimeter[i].y);
      if (d < minDist) { minDist = d; bestIdx = i; }
    }
  }
  return { index: bestIdx, dist: minDist };
}

function spawnFloatingPlusOne(x, y, isAdd) {
  const item = {
    x, y: y - 8,
    text: isAdd ? '+1 cm' : '-1 cm',
    color: isAdd ? '#34d399' : '#fb7185',
    alpha: 1, offsetY: 0
  };
  floatingPlusOnes.push(item);
  const start = performance.now();
  function anim(now) {
    const t = Math.min(1, (now - start) / 500);
    item.offsetY = -20 * t;
    item.alpha = 1 - t;
    renderMainCanvas();
    if (t < 1) requestAnimationFrame(anim);
    else {
      floatingPlusOnes = floatingPlusOnes.filter(f => f !== item);
      renderMainCanvas();
    }
  }
  requestAnimationFrame(anim);
}

function computeConvexHull(points) {
  const pts = points.map(p => ({ x: p.x, y: p.y }))
    .sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  if (pts.length <= 2) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (let p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function resampleClosedLoop(points, numSamples, refAngle) {
  if (points.length < 3) return [];
  const cumLen = [0];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i], p2 = points[(i + 1) % points.length];
    total += Math.hypot(p2.x - p1.x, p2.y - p1.y);
    cumLen.push(total);
  }
  if (total === 0) return points;
  const sampled = [];
  for (let k = 0; k < numSamples; k++) {
    const targetDist = (k / numSamples) * total;
    let seg = 0;
    while (seg < points.length - 1 && cumLen[seg + 1] < targetDist) seg++;
    const d0 = cumLen[seg], d1 = cumLen[seg + 1];
    const t = d1 > d0 ? (targetDist - d0) / (d1 - d0) : 0;
    const p1 = points[seg], p2 = points[(seg + 1) % points.length];
    sampled.push({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t });
  }
  const cx = sampled.reduce((s, p) => s + p.x, 0) / numSamples;
  const cy = sampled.reduce((s, p) => s + p.y, 0) / numSamples;
  let bestIdx = 0, minDiff = Infinity;
  for (let i = 0; i < numSamples; i++) {
    const ang = Math.atan2(sampled[i].y - cy, sampled[i].x - cx);
    let diff = Math.abs(ang - refAngle);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (diff < minDiff) { minDiff = diff; bestIdx = i; }
  }
  return sampled.slice(bestIdx).concat(sampled.slice(0, bestIdx));
}

function isPointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 1e-6) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function finalizeRulerLasso() {
  if (lassoPoints.length < 10) {
    lassoPoints = [];
    renderMainCanvas();
    return;
  }
  const polyPts = getScreenPolygonPoints();
  const cx = polyPts.reduce((s, p) => s + p.x, 0) / polyPts.length;
  const cy = polyPts.reduce((s, p) => s + p.y, 0) / polyPts.length;
  const insideCount = polyPts.filter(p => isPointInPolygon(p, lassoPoints)).length;

  if (!isPointInPolygon({ x: cx, y: cy }, lassoPoints) || insideCount < polyPts.length * 0.6) {
    if (typeof playSound === 'function') playSound('encourage');
    lassoPoints = [];
    renderMainCanvas();
    return;
  }

  const hull = computeConvexHull(polyPts);
  const refAngle = Math.atan2(hull[0].y - cy, hull[0].x - cx);
  animStartLoop = resampleClosedLoop(lassoPoints, 120, refAngle);
  animTargetHull = resampleClosedLoop(hull, 120, refAngle);
  animProgress = 0;
  rulerTightenState = 'animating';
  document.getElementById('btn-reset-tool').classList.remove('hidden');
  if (typeof playSound === 'function') playSound('tighten');

  const startTime = performance.now();
  function stepAnim(now) {
    animProgress = Math.min(1, (now - startTime) / 560);
    renderMainCanvas();
    if (animProgress < 1) {
      requestAnimationFrame(stepAnim);
    } else {
      rulerTightenState = 'done';
      const q = gameState.currentQuestion;
      const isConcave = q.path.length > 4;
      if (isConcave) {
        rulerFailedConcave = true;
        if (typeof playSound === 'function') playSound('encourage');
        showUnfoldWarning('⚠️ 軟尺收緊後直接拉直跨過內凹位（量度偏短），請改用【🧶 繩段】或【🏁 方格紙】！');
      } else {
        rulerFailedConcave = false;
        if (typeof playSound === 'function') playSound('correct');
        showUnfoldedTool('ruler', q.perimeter);
      }
      renderMainCanvas();
    }
  }
  requestAnimationFrame(stepAnim);
}

function showUnfoldWarning(msg) {
  const banner = document.getElementById('unfold-banner');
  const warnEl = document.getElementById('unfold-warn-text');
  const uCanvas = document.getElementById('unfoldCanvas');
  banner.classList.remove('hidden');
  uCanvas.classList.add('hidden');
  warnEl.classList.remove('hidden');
  warnEl.innerText = msg;
}

function showUnfoldedTool(type, totalCm) {
  const banner = document.getElementById('unfold-banner');
  const warnEl = document.getElementById('unfold-warn-text');
  const uCanvas = document.getElementById('unfoldCanvas');
  banner.classList.remove('hidden');
  warnEl.classList.add('hidden');
  uCanvas.classList.remove('hidden');
  document.getElementById('btn-reset-tool').classList.remove('hidden');

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = uCanvas.clientWidth || 400;
  const ch = 38;
  uCanvas.width = cw * dpr;
  uCanvas.height = ch * dpr;
  const ctx = uCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const padL = 18, padR = 22;
  const barW = cw - padL - padR;

  if (type === 'ruler') {
    ctx.fillStyle = '#fef08a';
    ctx.strokeStyle = '#ca8a04';
    ctx.lineWidth = 1.5;
    ctx.fillRect(padL, 6, barW, 24);
    ctx.strokeRect(padL, 6, barW, 24);

    const step = barW / totalCm;
    ctx.fillStyle = '#713f12';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    for (let i = 0; i <= totalCm; i++) {
      const x = padL + i * step;
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x, i % 2 === 0 ? 15 : 11);
      ctx.stroke();
      if (i % 2 === 0 || i === totalCm) {
        ctx.fillText(i, x, 26);
      }
    }
  } else if (type === 'string') {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(padL, 26);
    ctx.lineTo(padL + barW, 26);
    ctx.stroke();

    ctx.strokeStyle = '#fecaca';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#10b981';
    ctx.beginPath(); ctx.arc(padL, 26, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b91c1c';
    ctx.beginPath(); ctx.arc(padL + barW, 26, 5, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#fef08a';
    ctx.font = 'bold 13px "Noto Sans TC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`🧶 拉直繩段總長度 = ${totalCm} cm`, cw / 2, 13);
  }
}
