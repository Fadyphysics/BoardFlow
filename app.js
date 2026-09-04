const CDN_FABRIC = 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js';
const CDN_PDFJS  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const CDN_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

(function boot() {
    const missing = [];
    if (!window.fabric) missing.push(CDN_FABRIC);
    if (!window.pdfjsLib) missing.push(CDN_PDFJS);
    if (!missing.length) return startApp(false);
    let left = missing.length, failed = false;
    missing.forEach(src => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => { if (--left === 0 && !failed) startApp(true); };
        s.onerror = () => { failed = true; document.getElementById('fatal').classList.remove('hidden'); };
        document.head.appendChild(s);
    });
    document.addEventListener('pointerdown', event => {
        if (event.target.closest('#geometryToolRail, #geometryInsight')) return;
        if (selectedNatHit && !event.target.closest('canvas')) closeGeometryTools();
    });
})();

function startApp(usedCDN) {

// SELF-HEAL SHIELD: any missing button becomes an invisible dummy — wiring can never crash again
(function () {
    const real = document.getElementById.bind(document);
    const cache = {};
    document.getElementById = function (id) {
        let e = real(id);
        if (!e) {
            if (!cache[id]) {
                const d = document.createElement('button');
                d.id = id; d.style.display = 'none';
                document.body.appendChild(d);
                cache[id] = d;
            }
            e = cache[id];
        }
        return e;
    };
})();

pdfjsLib.GlobalWorkerOptions.workerSrc = usedCDN ? CDN_WORKER : 'libs/pdf.worker.min.js';
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const loadPref = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const savePref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

const canvas = new fabric.Canvas('board', { backgroundColor: '#ffffff', preserveObjectStacking: true });
fabric.Object.prototype.set({ transparentCorners: false, cornerColor: '#007acc', cornerSize: 11, borderColor: '#007acc', borderScaleFactor: 1.5, padding: 2 });

const wrap = document.getElementById('canvasWrap');
function resizeCanvas() { canvas.setWidth(wrap.clientWidth); canvas.setHeight(wrap.clientHeight); canvas.requestRenderAll(); }
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ================= Undo / Redo =================
const MAX_HISTORY = 50;
const undoStack = [], redoStack = [];
let snapshotTimer = null, suppressHistory = false, applying = false;
function annotationsJSON() {
    return JSON.stringify(canvas.getObjects().filter(o => !o.isFile).map(o => o.toJSON(['isSketch', 'isTriangle', 'angleShow'])));
}
function pushSnapshotNow() {
    const s = annotationsJSON();
    if (undoStack.length && undoStack[undoStack.length - 1] === s) return;
    undoStack.push(s);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
}
function queueSnapshot() { clearTimeout(snapshotTimer); snapshotTimer = setTimeout(() => { if (!suppressHistory) pushSnapshotNow(); }, 80); }
function resetHistory() { clearTimeout(snapshotTimer); undoStack.length = 0; redoStack.length = 0; pushSnapshotNow(); }
function applyAnnotationStateAsync(stateStr) {
    if (applying) return Promise.resolve();
    applying = true; suppressHistory = true;
    clearTimeout(snapshotTimer);
    return new Promise(resolve => {
        canvas.getObjects().filter(o => !o.isFile).forEach(o => canvas.remove(o));
        canvas.discardActiveObject();
        let arr = [];
        try { arr = JSON.parse(stateStr || '[]'); } catch (e) { arr = []; }
        const finish = () => {
            canvas.getObjects().forEach(o => { if (o.isTriangle) attachApexControl(o); });
            canvas.requestRenderAll();
            applyInteractivity();
            applyFileErasability();
            suppressHistory = false; applying = false;
            resolve();
        };
        if (!arr.length) return finish();
        fabric.util.enlivenObjects(arr, objs => { objs.forEach(o => canvas.add(o)); finish(); });
    });
}
function undo() { if (undoStack.length < 2 || applying) return; redoStack.push(undoStack.pop()); applyAnnotationStateAsync(undoStack[undoStack.length - 1]); }
function redo() { if (!redoStack.length || applying) return; const s = redoStack.pop(); undoStack.push(s); applyAnnotationStateAsync(s); }
function historyTrigger(e) { if (suppressHistory) return; if (e.target && e.target.isFile) return; queueSnapshot(); }
canvas.on('object:added', historyTrigger);
canvas.on('object:added', () => applyInteractivity());
canvas.on('object:added', () => applyInteractivity());
canvas.on('object:removed', historyTrigger);
canvas.on('object:modified', historyTrigger);
canvas.on('object:modified', e => {
    const o = e.target;
    if (o && o.type === 'textbox' && (o.scaleX !== 1 || o.scaleY !== 1)) {
        o.set({ width: o.width * o.scaleX, fontSize: o.fontSize * o.scaleY, scaleX: 1, scaleY: 1 });
    }
});
document.getElementById('btnUndo').onclick = undo;
document.getElementById('btnRedo').onclick = redo;

const pageMemory = new Map(); // "boardPage:pdfPage" -> annotations JSON
let boardPage = 0, boardPages = 1;
canvas.on('path:created', opt => {
    const p = opt.path;
    const trivial = (p.path && p.path.length <= 1) || (p.width < 2 && p.height < 2);
    if (trivial) { canvas.remove(p); canvas.requestRenderAll(); return; }
    p.isSketch = true;
});
function hasInk() { return canvas.getObjects().some(o => !o.isFile); }
function removeAnnotationsSilent() {
    canvas.getObjects().filter(o => !o.isFile).forEach(o => canvas.remove(o));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
}

// ================= Theme + Grid =================
const THEMES = { light: { bg: '#ffffff', grid: 'rgba(0,0,0,.10)' }, dark: { bg: '#202327', grid: 'rgba(255,255,255,.10)' } };
let theme = loadPref('bv-theme') || 'light';
let showGrid = loadPref('bv-grid') === '1';
const GRID_SIZE = 30;
const btnTheme = document.getElementById('btnTheme');
const btnGrid = document.getElementById('btnGrid');
function applyTheme() {
    canvas.setBackgroundColor(THEMES[theme].bg, () => canvas.requestRenderAll());
    if (!HAS_ERASER) { allEraser.color = THEMES[theme].bg; }
    btnTheme.classList.toggle('active', theme === 'dark');
    btnGrid.classList.toggle('active', showGrid);
    savePref('bv-theme', theme); savePref('bv-grid', showGrid ? '1' : '0');
}
btnTheme.onclick = () => { theme = theme === 'light' ? 'dark' : 'light'; applyTheme(); };
btnGrid.onclick = () => { showGrid = !showGrid; applyTheme(); };
canvas.on('after:render', () => {
    if (!showGrid) return;
    const ctx = canvas.contextContainer;
    const vt = canvas.viewportTransform;
    const zoom = canvas.getZoom();
    let step = GRID_SIZE;
    while (step * zoom < 14) step *= 2;
    while (step * zoom > 90) step /= 2;
    const thin = clamp(zoom, 0.3, 1);
    const inv = fabric.util.invertTransform(vt);
    const tl = fabric.util.transformPoint(new fabric.Point(0, 0), inv);
    const br = fabric.util.transformPoint(new fabric.Point(canvas.getWidth(), canvas.getHeight()), inv);
    ctx.save();
    ctx.transform(vt[0], vt[1], vt[2], vt[3], vt[4], vt[5]);
    ctx.strokeStyle = THEMES[theme].grid;
    ctx.lineWidth = thin / zoom;
    ctx.beginPath();
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) { ctx.moveTo(x, tl.y); ctx.lineTo(x, br.y); }
    for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) { ctx.moveTo(tl.x, y); ctx.lineTo(br.x, y); }
    ctx.stroke();
    ctx.restore();
});

// ================= Brushes =================
const pen = new fabric.PencilBrush(canvas);
pen.color = '#ff3333';
pen.width = 3;
const HAS_ERASER = !!fabric.EraserBrush;
let allEraser;
if (HAS_ERASER) { allEraser = new fabric.EraserBrush(canvas); }
else { allEraser = new fabric.PencilBrush(canvas); allEraser.color = THEMES[theme].bg; }
allEraser.width = 24;
let inkEraseWidth = 24;
let penWidth = 3, eraseWidth = 24;

// ================= Tools =================
let tool = 'pen';
let hlColor = '#FFE600';
const btnSelect = document.getElementById('btnSelect');
const btnPen = document.getElementById('btnPen');
const btnArrow = document.getElementById('btnArrow');
const btnText = document.getElementById('btnText');
const btnEraserInk = document.getElementById('btnEraserInk');
const btnEraserAll = document.getElementById('btnEraserAll');
const swatches = [document.getElementById('hlYellow'), document.getElementById('hlPink'), document.getElementById('hlPist')];
const toolButtons = { select: btnSelect, pen: btnPen, arrow: btnArrow, text: btnText, eraserInk: btnEraserInk, eraserAll: btnEraserAll };
function applyFileErasability() {
    canvas.forEachObject(o => {
        if (tool === 'eraserAll') o.erasable = true;
        else if (o.isFile) o.erasable = false;
        else if (tool !== 'eraserInk') o.erasable = true;
    });
}
function applyInteractivity() {
    canvas.forEachObject(o => {
        const textish = (o.type === 'i-text' || o.type === 'textbox');
        const on = (tool === 'select') || (tool === 'text' && textish);
        o.selectable = on; o.evented = on;
    });
}
function setTool(t) {
    tool = t;
    Object.entries(toolButtons).forEach(([k, b]) => b.classList.toggle('active', k === t));
    swatches.forEach(b => b.classList.toggle('active', t === 'highlight' && b.dataset.c === hlColor));
    if (t === 'select') { canvas.isDrawingMode = false; canvas.selection = true; canvas.defaultCursor = 'default'; }
    else if (t === 'text') { canvas.isDrawingMode = false; canvas.selection = false; canvas.defaultCursor = 'text'; }
    else if (t === 'arrow' || t === 'highlight' || t === 'eraserInk') { canvas.isDrawingMode = false; canvas.selection = false; canvas.defaultCursor = 'crosshair'; canvas.discardActiveObject(); }
    else { canvas.isDrawingMode = true; canvas.selection = false; canvas.freeDrawingCursor = 'crosshair'; canvas.freeDrawingBrush = (t === 'pen') ? pen : allEraser; }
    applyInteractivity();
    applyFileErasability();
    const isEraserTool = (t === 'eraserInk' || t === 'eraserAll');
    document.getElementById('inkSize').value = isEraserTool ? eraseWidth : penWidth;
    document.getElementById('sizeLabel').textContent = isEraserTool ? 'Eraser size' : 'Pen size';
    updateQuickPen();
}
btnSelect.onclick = () => setTool('select');
btnPen.onclick = () => setTool('pen');
btnArrow.onclick = () => setTool('arrow');
btnText.onclick = () => setTool('text');
btnEraserInk.onclick = () => setTool('eraserInk');
btnEraserAll.onclick = () => setTool('eraserAll');
swatches.forEach(b => b.onclick = () => { hlColor = b.dataset.c; setTool('highlight'); });
document.getElementById('inkColor').oninput = e => pen.color = e.target.value;
document.getElementById('inkSize').oninput = e => {
    const s = +e.target.value;
    if (tool === 'eraserInk' || tool === 'eraserAll') eraseWidth = s;
    else penWidth = s;
    pen.width = penWidth;
    inkEraseWidth = eraseWidth;
    allEraser.width = eraseWidth;
};
document.getElementById('btnClear').onclick = removeAnnotationsSilent;
document.getElementById('btnSaveBoard').onclick = exportPNG;

// ================= SAFE ink eraser =================
let inkErasing = false;
function sketchHit(o, pt, r) {
    const local = o.toLocalPoint(new fabric.Point(pt.x, pt.y), 'center', 'center');
    const scale = Math.max(0.001, Math.min(o.scaleX || 1, o.scaleY || 1));
    const reach = r / scale + (o.strokeWidth || 1) / 2;
    const off = o.pathOffset || { x: 0, y: 0 };
    let pts;
    if (o.type === 'line') pts = [{ x: o.x1, y: o.y1 }, { x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2 }, { x: o.x2, y: o.y2 }];
    else if (o.type === 'polygon') pts = o.points.map(p => ({ x: p.x - off.x, y: p.y - off.y }));
    else if (o.type === 'path') pts = o.path.map(seg => ({ x: seg[seg.length - 2] - off.x, y: seg[seg.length - 1] - off.y }));
    else return false;
    return pts.some(p => { const dx = p.x - local.x, dy = p.y - local.y; return dx * dx + dy * dy <= reach * reach; });
}
function strokeWorldPoints(o) {
    const m = o.calcTransformMatrix();
    const off = o.pathOffset || { x: 0, y: 0 };
    if (o.type === 'line') {
        const a = fabric.util.transformPoint({ x: o.x1, y: o.y1 }, m);
        const b = fabric.util.transformPoint({ x: o.x2, y: o.y2 }, m);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(2, Math.ceil(len / 6));
        const pts = [];
        for (let i = 0; i <= n; i++) pts.push({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n });
        return pts;
    }
    if (o.type !== 'path') return null;
    return o.path.map(seg => ({ x: seg[seg.length - 2] - off.x, y: seg[seg.length - 1] - off.y }))
        .filter(p => isFinite(p.x) && isFinite(p.y))
        .map(p => fabric.util.transformPoint(p, m));
}
function pathFromPoints(pts) { return 'M ' + pts.map(p => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' L '); }
function eraseSketchesAt(pt) {
    const r = inkEraseWidth / 2;
    let changed = false;
    canvas.getObjects().filter(o => o.isSketch).slice().forEach(o => {
        const pts = strokeWorldPoints(o);
        if (!pts) { if (sketchHit(o, pt, r)) { canvas.remove(o); changed = true; } return; }
        const inside = pts.map(p => (p.x - pt.x) * (p.x - pt.x) + (p.y - pt.y) * (p.y - pt.y) <= r * r);
        if (!inside.some(Boolean)) return;
        changed = true;
        if (inside.every(Boolean)) { canvas.remove(o); return; }
        const runs = [];
        let cur = [];
        pts.forEach((p, i) => { if (!inside[i]) cur.push(p); else { if (cur.length > 1) runs.push(cur); cur = []; } });
        if (cur.length > 1) runs.push(cur);
        canvas.remove(o);
        runs.forEach(run => {
            let obj;
            if (o.type === 'line') {
                obj = new fabric.Line([run[0].x, run[0].y, run[run.length - 1].x, run[run.length - 1].y], { stroke: o.stroke, strokeWidth: o.strokeWidth, opacity: o.opacity, strokeLineCap: o.strokeLineCap, objectCaching: false });
            } else {
                obj = new fabric.Path(pathFromPoints(run), { stroke: o.stroke, strokeWidth: o.strokeWidth, opacity: o.opacity, strokeLineCap: 'round', strokeLineJoin: 'round', fill: '', objectCaching: false });
            }
            obj.isSketch = true;
            canvas.add(obj);
        });
    });
    if (changed) canvas.requestRenderAll();
}

// Tools stay active until the user switches; the ✏️ chip is the quick way back to pen

// ================= Text tool =================
const fontFamilySel = document.getElementById('fontFamilySel');
const fontSizeSel = document.getElementById('fontSizeSel');
fontFamilySel.onchange = () => applyFontToActive('fontFamily', fontFamilySel.value);
fontSizeSel.onchange = () => applyFontToActive('fontSize', +fontSizeSel.value);
function applyFontToActive(prop, val) {
    const o = canvas.getActiveObject();
    if (o && (o.type === 'i-text' || o.type === 'textbox')) { o.set(prop, val); canvas.requestRenderAll(); queueSnapshot(); }
}
function addTextAt(e) {
    const p = canvas.getPointer(e);
    const txt = new fabric.IText('Text', { left: p.x, top: p.y, fontFamily: fontFamilySel.value, fontSize: +fontSizeSel.value, fill: pen.color, editable: true, selectable: true, evented: true });
    canvas.add(txt);
    canvas.setActiveObject(txt);
    txt.enterEditing();
    txt.selectAll();
}

// ================= Triangle engine =================
let angleHandleCache = [];
let lastAngleClick = null;
function triangleWorldPts(o) {
    const m = o.calcTransformMatrix();
    const off = o.pathOffset || { x: 0, y: 0 };
    return o.points.map(p => fabric.util.transformPoint({ x: p.x - off.x, y: p.y - off.y }, m));
}
function angleDeg(v, b, c) {
    const u1 = { x: b.x - v.x, y: b.y - v.y }, u2 = { x: c.x - v.x, y: c.y - v.y };
    const d = (u1.x * u2.x + u1.y * u2.y) / ((Math.hypot(u1.x, u1.y) * Math.hypot(u2.x, u2.y)) || 1);
    return Math.acos(clamp(d, -1, 1)) * 180 / Math.PI;
}
function recalcTriangle(target) {
    const xs = target.points.map(p => p.x), ys = target.points.map(p => p.y);
    const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const newOffset = { x: minX + w / 2, y: minY + h / 2 };
    const m = target.calcTransformMatrix();
    const shift = fabric.util.transformPoint({ x: newOffset.x - target.pathOffset.x, y: newOffset.y - target.pathOffset.y }, [m[0], m[1], m[2], m[3], 0, 0]);
    target.width = w; target.height = h; target.pathOffset = newOffset;
    target.left += shift.x; target.top += shift.y;
    target.setCoords();
    target.dirty = true;
}
function setTrianglePointWorld(target, i, worldPt) {
    const local = target.toLocalPoint(new fabric.Point(worldPt.x, worldPt.y), 'center', 'center');
    target.points[i] = { x: local.x + target.pathOffset.x, y: local.y + target.pathOffset.y };
    recalcTriangle(target);
}
function setTriangleAngle(o, i, deg) {
    const w = triangleWorldPts(o);
    const A = w[i], B = w[(i + 1) % 3], C = w[(i + 2) % 3];
    const d = Math.hypot(C.x - B.x, C.y - B.y);
    if (d < 1) return;
    const theta = clamp(deg, 1, 179) * Math.PI / 180;
    const R = d / (2 * Math.sin(theta));
    const M = { x: (B.x + C.x) / 2, y: (B.y + C.y) / 2 };
    let u = { x: -(C.y - B.y) / d, y: (C.x - B.x) / d };
    if ((A.x - M.x) * u.x + (A.y - M.y) * u.y < 0) { u.x = -u.x; u.y = -u.y; }
    const h = Math.sqrt(Math.max(R * R - d * d / 4, 0));
    const s = theta < Math.PI / 2 ? 1 : -1;
    const O = { x: M.x + u.x * h * s, y: M.y + u.y * h * s };
    const dx = A.x - O.x, dy = A.y - O.y;
    const L = Math.hypot(dx, dy) || 1;
    setTrianglePointWorld(o, i, { x: O.x + dx / L * R, y: O.y + dy / L * R });
}
function attachApexControl(poly) {
    poly.controls = Object.assign({}, poly.controls);
    [0, 1, 2].forEach(i => {
        poly.controls['v' + i] = new fabric.Control({
            positionHandler: function (dim, finalMatrix, fabricObject) {
                const p = fabricObject.points[i];
                const off = fabricObject.pathOffset;
                return fabric.util.transformPoint({ x: p.x - off.x, y: p.y - off.y }, fabricObject.calcTransformMatrix());
            },
            actionHandler: function (eventData, transform, x, y) {
                setTrianglePointWorld(transform.target, i, { x: x, y: y });
                return true;
            },
            cursorStyleHandler: function () { return 'crosshair'; },
            render: function (ctx, left, top, styleOverride, fabricObject) {
                ctx.save();
                ctx.translate(left, top);
                ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle));
                ctx.fillStyle = '#007acc';
                ctx.beginPath(); ctx.arc(0, 0, 7, 0, 2 * Math.PI); ctx.fill();
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
                ctx.restore();
            }
        });
    });
}
canvas.on('after:render', () => {
    angleHandleCache = [];
    const ctx = canvas.contextContainer;
    const vt = canvas.viewportTransform;
    canvas.getObjects().forEach(o => {
        if (!o.isTriangle) return;
        const s = triangleWorldPts(o).map(p => fabric.util.transformPoint(p, vt));
        const cx = (s[0].x + s[1].x + s[2].x) / 3, cy = (s[0].y + s[1].y + s[2].y) / 3;
        for (let i = 0; i < 3; i++) {
            const v = s[i], b = s[(i + 1) % 3], c = s[(i + 2) % 3];
            const deg = angleDeg(v, b, c);
            let ix = cx - v.x, iy = cy - v.y;
            const il = Math.hypot(ix, iy) || 1; ix /= il; iy /= il;
            const hx = v.x + ix * 20, hy = v.y + iy * 20;
            angleHandleCache.push({ obj: o, i: i, x: hx, y: hy, deg: deg });
            ctx.save();
            ctx.beginPath(); ctx.arc(hx, hy, 5, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
            ctx.strokeStyle = '#007acc'; ctx.lineWidth = 1.5; ctx.stroke();
            if (o.angleShow && o.angleShow[i]) {
                const a1 = Math.atan2(b.y - v.y, b.x - v.x);
                const a2 = Math.atan2(c.y - v.y, c.x - v.x);
                let diff = a2 - a1;
                while (diff <= -Math.PI) diff += 2 * Math.PI;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                ctx.beginPath(); ctx.arc(v.x, v.y, 14, a1, a1 + diff, diff < 0);
                ctx.strokeStyle = '#c33'; ctx.lineWidth = 1.5; ctx.stroke();
                ctx.fillStyle = '#c33'; ctx.font = '12px sans-serif';
                ctx.fillText(Math.round(deg) + '°', v.x + ix * 30 - 8, v.y + iy * 30 + 4);
            }
            ctx.restore();
        }
    });
});
function handleAngleClick(e) {
    const rect = canvas.lowerCanvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    for (const h of angleHandleCache) {
        const dx = h.x - x, dy = h.y - y;
        if (dx * dx + dy * dy <= 100) {
            const o = h.obj;
            if (!o.angleShow) o.angleShow = [false, false, false];
            const now = Date.now();
            if (lastAngleClick && now - lastAngleClick.t < 400 && lastAngleClick.o === o && lastAngleClick.i === h.i) {
                lastAngleClick = null;
                const val = parseFloat(prompt('Set angle at this vertex (1–179°):', Math.round(h.deg)));
                if (isFinite(val) && val > 0 && val < 180) {
                    setTriangleAngle(o, h.i, val);
                    o.angleShow[h.i] = true;
                    canvas.requestRenderAll();
                }
                return true;
            }
            lastAngleClick = { t: now, o: o, i: h.i };
            o.angleShow[h.i] = !o.angleShow[h.i];
            canvas.requestRenderAll();
        }
    }
    return false;
}

// ================= Angle Lens =================
let angleLens = false;
const lensHidden = new Set();
let angleHitCache = [];
let uidCounter = 0;
function uid(o) { if (!o.__uid) o.__uid = ++uidCounter; return o.__uid; }
const ANGLE_PALETTE = ['#e6194b', '#3cb44b', '#f58e26', '#4363d8', '#911eb4', '#008080', '#f032e6', '#bc7400'];
let degColorMap = {};
function colorForDeg(d) {
    const k = Math.round(d);
    if (!(k in degColorMap)) degColorMap[k] = ANGLE_PALETTE[Object.keys(degColorMap).length % ANGLE_PALETTE.length];
    return degColorMap[k];
}
const btnLens = document.getElementById('btnLens');
function lensUI() { if (btnLens) btnLens.classList.toggle('active', angleLens); }
if (btnLens) btnLens.onclick = () => { angleLens = !angleLens; lensUI(); savePref('bv-lens', angleLens ? '1' : '0'); canvas.requestRenderAll(); };
lensUI();
function lensUI() { btnLens.classList.toggle('active', angleLens); }
btnLens.onclick = () => { angleLens = !angleLens; lensUI(); savePref('bv-lens', angleLens ? '1' : '0'); canvas.requestRenderAll(); };
lensUI();
function normDir(d) { const l = Math.hypot(d.x, d.y) || 1; return { x: d.x / l, y: d.y / l }; }
function straightSegment(o) {
    const m = o.calcTransformMatrix();
    const off = o.pathOffset || { x: 0, y: 0 };
    const toW = p => fabric.util.transformPoint({ x: p.x - off.x, y: p.y - off.y }, m);
    if (o.type === 'line') return [toW({ x: o.x1, y: o.y1 }), toW({ x: o.x2, y: o.y2 })];
    if (o.type === 'polygon' && o.isSketch) return [toW(o.points[0]), toW(o.points[3])];
    if (o.type === 'path' && o.isSketch) {
        const pts = o.path.map(s => ({ x: s[s.length - 2] - off.x, y: s[s.length - 1] - off.y })).filter(p => isFinite(p.x) && isFinite(p.y));
        if (pts.length < 2) return null;
        const a = toW(pts[0]), b = toW(pts[pts.length - 1]);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 20) return null;
        let polyLen = 0;
        for (let i = 1; i < pts.length; i++) { const p = toW(pts[i - 1]), q = toW(pts[i]); polyLen += Math.hypot(q.x - p.x, q.y - p.y); }
        if (polyLen / len > 1.2) return null;
        return [a, b];
    }
    return null;
}
function segIntersect(p1, p2, p3, p4) {
    const d1 = { x: p2.x - p1.x, y: p2.y - p1.y }, d2 = { x: p4.x - p3.x, y: p4.y - p3.y };
    const den = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((p3.x - p1.x) * d2.y - (p3.y - p1.y) * d2.x) / den;
    const u = ((p3.x - p1.x) * d1.y - (p3.y - p1.y) * d1.x) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
}
function handleLensClick(e) {
    const rect = canvas.lowerCanvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    for (const h of angleHitCache) {
        const dx = h.x - x, dy = h.y - y;
        if (dx * dx + dy * dy <= 121) {
            if (lensHidden.has(h.key)) lensHidden.delete(h.key); else lensHidden.add(h.key);
            canvas.requestRenderAll();
            return true;
        }
    }
    return false;
}
canvas.on('after:render', () => {
    angleHitCache = [];
    if (!angleLens) return;
    degColorMap = {};
    const ctx = canvas.contextContainer;
    const vt = canvas.viewportTransform;
    const segs = [];
    canvas.getObjects().forEach(o => { const seg = straightSegment(o); if (seg) segs.push({ o: o, seg: seg }); });
    for (let a = 0; a < segs.length; a++) {
        for (let b = a + 1; b < segs.length; b++) {
            const P = segIntersect(segs[a].seg[0], segs[a].seg[1], segs[b].seg[0], segs[b].seg[1]);
            if (!P) continue;
            const key = uid(segs[a].o) + '_' + uid(segs[b].o);
            const sp = fabric.util.transformPoint(P, vt);
            angleHitCache.push({ x: sp.x, y: sp.y, key: key });
            if (lensHidden.has(key)) continue;
            const d1 = normDir({ x: segs[a].seg[1].x - segs[a].seg[0].x, y: segs[a].seg[1].y - segs[a].seg[0].y });
            const d2 = normDir({ x: segs[b].seg[1].x - segs[b].seg[0].x, y: segs[b].seg[1].y - segs[b].seg[0].y });
            const rays = [Math.atan2(d1.y, d1.x), Math.atan2(d2.y, d2.x), Math.atan2(-d1.y, -d1.x), Math.atan2(-d2.y, -d2.x)].sort((x, y) => x - y);
            ctx.save();
            for (let i = 0; i < 4; i++) {
                const a1 = rays[i];
                const a2 = i === 3 ? rays[0] + 2 * Math.PI : rays[i + 1];
                const deg = (a2 - a1) * 180 / Math.PI;
                if (deg < 3 || deg > 177) continue;
                const midA = (a1 + a2) / 2;
                const col = colorForDeg(deg);
                ctx.strokeStyle = col; ctx.lineWidth = 2;
                if (Math.abs(deg - 90) < 2) {
                    const s = 10;
                    ctx.beginPath();
                    ctx.moveTo(sp.x + Math.cos(a1) * s, sp.y + Math.sin(a1) * s);
                    ctx.lineTo(sp.x + Math.cos(a1) * s + Math.cos(a2) * s, sp.y + Math.sin(a1) * s + Math.sin(a2) * s);
                    ctx.lineTo(sp.x + Math.cos(a2) * s, sp.y + Math.sin(a2) * s);
                    ctx.stroke();
                } else {
                    ctx.beginPath(); ctx.arc(sp.x, sp.y, 14, a1, a2); ctx.stroke();
                }
                ctx.fillStyle = col; ctx.font = 'bold 11px sans-serif';
                ctx.fillText(Math.round(deg) + '°', sp.x + Math.cos(midA) * 26 - 8, sp.y + Math.sin(midA) * 26 + 4);
            }
            ctx.beginPath(); ctx.arc(sp.x, sp.y, 4, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
            ctx.strokeStyle = '#4363d8'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.restore();
        }
    }
});

// ================= Insertables =================
let shapeCounter = 0;
function viewCenterWorld() {
    const inv = fabric.util.invertTransform(canvas.viewportTransform);
    return fabric.util.transformPoint(new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2), inv);
}
function addToolObject(obj, autoReturnToPen) {
    const c = viewCenterWorld();
    const off = (shapeCounter++ % 5) * 24;
    const w = obj.width * (obj.scaleX || 1), h = obj.height * (obj.scaleY || 1);
    obj.set({ left: c.x - w / 2 + off, top: c.y - h / 2 + off, selectable: true, evented: true });
    obj.isFile = false;
    canvas.add(obj);
    canvas.setActiveObject(obj);
    setTool('select');
    canvas.requestRenderAll();
}
function addShape(kind) {
    const strokeW = Math.max(2, pen.width);
    const common = { fill: 'transparent', stroke: pen.color, strokeWidth: strokeW };
    let obj;
    if (kind === 'triangle') {
        obj = new fabric.Polygon([{ x: -70, y: 65 }, { x: 70, y: 65 }, { x: 0, y: -65 }], common);
        obj.isTriangle = true;
        attachApexControl(obj);
    }
    if (kind === 'square')   obj = new fabric.Rect({ ...common, width: 130, height: 130 });
    if (kind === 'circle')   obj = new fabric.Circle({ ...common, radius: 70 });
    addToolObject(obj, true);
}
document.getElementById('shapeTriangle').onclick = () => addShape('triangle');
document.getElementById('shapeSquare').onclick = () => addShape('square');
document.getElementById('shapeCircle').onclick = () => addShape('circle');
function makeRuler() {
    const cm = 40, cms = 15, W = cm * cms + 40, H = 70;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,235,130,0.30)'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(50,50,50,0.9)'; g.fillStyle = 'rgba(30,30,30,0.95)';
    g.lineWidth = 1; g.font = '11px sans-serif';
    for (let i = 0; i <= cms * 10; i++) {
        const x = 20 + i * (cm / 10);
        const len = i % 10 === 0 ? 24 : i % 5 === 0 ? 16 : 9;
        g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, len); g.stroke();
        if (i % 10 === 0) g.fillText(String(i / 10), x - 3, 38);
    }
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
    return new fabric.Image(c, { opacity: 0.9 });
}
function makeProtractor() {
    const R = 170, pad = 16;
    const W = 2 * (R + pad), H = R + 2 * pad;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const cx = W / 2, cy = H - pad;
    g.fillStyle = 'rgba(150,215,255,0.22)';
    g.beginPath(); g.arc(cx, cy, R, Math.PI, 2 * Math.PI); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(25,55,85,0.9)'; g.fillStyle = 'rgba(15,40,70,0.95)';
    g.lineWidth = 1; g.font = '10px sans-serif';
    for (let a = 0; a <= 180; a++) {
        const rad = a * Math.PI / 180;
        const len = a % 10 === 0 ? 18 : a % 5 === 0 ? 12 : 6;
        g.beginPath();
        g.moveTo(cx + Math.cos(rad) * R, cy - Math.sin(rad) * R);
        g.lineTo(cx + Math.cos(rad) * (R - len), cy - Math.sin(rad) * (R - len));
        g.stroke();
        if (a % 30 === 0) g.fillText(String(a), cx + Math.cos(rad) * (R - 32) - 7, cy - Math.sin(rad) * (R - 32) + 3);
    }
    g.beginPath(); g.moveTo(cx - R, cy + 0.5); g.lineTo(cx + R, cy + 0.5); g.stroke();
    g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fill();
    return new fabric.Image(c, { opacity: 0.9 });
}
document.getElementById('btnRuler').onclick = () => addToolObject(makeRuler(), false);
document.getElementById('btnProtractor').onclick = () => addToolObject(makeProtractor(), false);
function addSticky() {
    const c = viewCenterWorld();
    const off = (shapeCounter++ % 5) * 24;
    const note = new fabric.Textbox('Note', { left: c.x - 110 + off, top: c.y - 110 + off, width: 220, fontSize: 20, fontFamily: 'Tahoma, Verdana, sans-serif', fill: '#4a4a00', backgroundColor: '#FFF176', padding: 10, editable: true, selectable: true, evented: true });
    canvas.add(note);
    canvas.setActiveObject(note);
    setTool('select');
    note.enterEditing();
    note.selectAll();
    canvas.requestRenderAll();
}
document.getElementById('btnSticky').onclick = addSticky;

// ================= Arrow + Highlighter =================
function makeArrow(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 2) return null;
    const ux = dx / len, uy = dy / len, px = -uy, py = ux;
    const t = Math.max(0.75, pen.width / 2);
    const h = clamp(pen.width * 4, 12, 60);
    const hw = h * 0.65;
    const bx = x2 - ux * h, by = y2 - uy * h;
    const pts = [
        { x: x1 + px * t, y: y1 + py * t }, { x: bx + px * t, y: by + py * t },
        { x: bx + px * hw, y: by + py * hw }, { x: x2, y: y2 },
        { x: bx - px * hw, y: by - py * hw }, { x: bx - px * t, y: by - py * t },
        { x: x1 - px * t, y: y1 - py * t }
    ];
    const poly = new fabric.Polygon(pts, { fill: pen.color, stroke: pen.color, strokeWidth: 0.5, objectCaching: false });
    poly.isSketch = true;
    poly.isArrow = true;
    return poly;
}
function makeHighlight(x1, y1, x2, y2) {
    const line = new fabric.Line([x1, y1, x2, y2], { stroke: hlColor, strokeWidth: Math.max(12, pen.width * 6), opacity: 0.45, strokeLineCap: 'butt', objectCaching: false });
    line.isSketch = true;
    return line;
}
let arrowStart = null, tempArrow = null, hlStart = null, tempHl = null;

// ================= Zoom / pan / view chip =================
const viewChip = document.getElementById('viewChip');
const zoomLabel = document.getElementById('zoomLabel');
function updateViewChip() {
    const vt = canvas.viewportTransform;
    const changed = Math.abs(vt[0] - 1) > 0.001 || Math.abs(vt[4]) > 0.5 || Math.abs(vt[5]) > 0.5;
    viewChip.style.display = changed ? 'flex' : 'none';
    zoomLabel.textContent = Math.round(vt[0] * 100) + '%';
}
document.getElementById('btnHome').onclick = () => { canvas.setViewportTransform([1, 0, 0, 1, 0, 0]); updateViewChip(); canvas.requestRenderAll(); };
wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.lowerCanvasEl.getBoundingClientRect();
    const p = new fabric.Point(e.clientX - rect.left, e.clientY - rect.top);
    canvas.zoomToPoint(p, clamp(canvas.getZoom() * Math.pow(1.0015, -e.deltaY), 0.2, 5));
    updateViewChip();
}, { passive: false });
const activePointers = new Map();
let pinch = null, wasDrawingBeforePinch = false;
wrap.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 2) beginPinch();
}, { capture: true });
wrap.addEventListener('pointermove', e => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && activePointers.size === 2) handlePinch();
}, { capture: true, passive: false });
function onPointerEnd(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);
    if (pinch && activePointers.size < 2) endPinch();
}
wrap.addEventListener('pointerup', onPointerEnd, { capture: true });
wrap.addEventListener('pointercancel', onPointerEnd, { capture: true });
function beginPinch() {
    wasDrawingBeforePinch = canvas.isDrawingMode;
    if (wasDrawingBeforePinch) { canvas.isDrawingMode = false; canvas.upperCanvasEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }
    arrowStart = null; hlStart = null; inkErasing = false;
    if (tempArrow) { canvas.remove(tempArrow); tempArrow = null; }
    if (tempHl) { canvas.remove(tempHl); tempHl = null; }
    const [a, b] = [...activePointers.values()];
    pinch = { startDist: Math.hypot(b.x - a.x, b.y - a.y) || 1, startZoom: canvas.getZoom(), lastMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}
function handlePinch() {
    const [a, b] = [...activePointers.values()];
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const rect = canvas.lowerCanvasEl.getBoundingClientRect();
    const vt = canvas.viewportTransform;
    vt[4] += mid.x - pinch.lastMid.x;
    vt[5] += mid.y - pinch.lastMid.y;
    canvas.zoomToPoint(new fabric.Point(mid.x - rect.left, mid.y - rect.top), clamp(pinch.startZoom * (dist / pinch.startDist), 0.2, 5));
    pinch.lastMid = mid;
    updateViewChip();
}
function endPinch() { pinch = null; activePointers.clear(); if (wasDrawingBeforePinch) setTool(tool); updateViewChip(); }

// ================= HUD =================
const hud = document.getElementById('hud');
const btnMenu = document.getElementById('btnMenu');
const menu = document.getElementById('menu');
const btnPenQuick = document.getElementById('btnPenQuick');
const pager = document.getElementById('pager');
function setHudPos(pos) {
    hud.style.left = ''; hud.style.top = ''; hud.style.bottom = '';
    wrap.classList.toggle('hud-bottom', pos === 'bottom');
    savePref('bv-hud', pos);
}
setHudPos(loadPref('bv-hud') || 'top');
let hudDrag = null, suppressMenuClick = false;
btnMenu.addEventListener('pointerdown', e => { hudDrag = { x: e.clientX, y: e.clientY, moved: false }; btnMenu.setPointerCapture(e.pointerId); });
btnMenu.addEventListener('pointermove', e => {
    if (!hudDrag) return;
    if (!hudDrag.moved && Math.hypot(e.clientX - hudDrag.x, e.clientY - hudDrag.y) > 8) { hudDrag.moved = true; hideMenuNow(); }
    if (hudDrag.moved) { hud.style.left = e.clientX + 'px'; hud.style.top = e.clientY + 'px'; hud.style.bottom = 'auto'; }
});
btnMenu.addEventListener('pointerup', e => {
    if (hudDrag && hudDrag.moved) { setHudPos(e.clientY > window.innerHeight / 2 ? 'bottom' : 'top'); suppressMenuClick = true; }
    hudDrag = null;
});
btnPenQuick.onclick = () => setTool('pen');
function updateQuickPen() { btnPenQuick.classList.toggle('hidden', !(tool !== 'pen' && menu.classList.contains('hidden'))); }

// ================= Menu auto-hide =================
const HIDE_DELAY = 10000;
let hideTimer = null;
function armHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hideMenuNow, HIDE_DELAY); }
function showMenu() { menu.classList.remove('hidden'); btnMenu.classList.add('open'); updateQuickPen(); armHide(); }
function hideMenuNow() { clearTimeout(hideTimer); menu.classList.add('hidden'); btnMenu.classList.remove('open'); updateQuickPen(); }
btnMenu.onclick = () => {
    if (suppressMenuClick) { suppressMenuClick = false; return; }
    menu.classList.contains('hidden') ? showMenu() : hideMenuNow();
};
menu.addEventListener('mouseenter', () => clearTimeout(hideTimer));
menu.addEventListener('mouseleave', () => { if (!menu.classList.contains('hidden')) armHide(); });
['click', 'input', 'change'].forEach(ev => menu.addEventListener(ev, () => { if (!menu.classList.contains('hidden')) armHide(); }));
const AUTO_HIDE_IDS = ['btnSelect', 'btnPen', 'btnArrow', 'btnText', 'btnEraserInk', 'btnEraserAll',
    'shapeTriangle', 'shapeSquare', 'shapeCircle', 'btnRuler', 'btnProtractor', 'btnSticky',
    'hlYellow', 'hlPink', 'hlPist'];
menu.addEventListener('click', e => { if (AUTO_HIDE_IDS.includes(e.target.id)) setTimeout(hideMenuNow, 1000); });

// ================= Keyboard / mouse core =================
let spaceDown = false, panning = false;
window.addEventListener('keydown', e => {
    const active = canvas.getActiveObject();
    const editing = active && active.isEditing;
    if ((e.ctrlKey || e.metaKey) && !editing) {
        const k = e.key.toLowerCase();
        if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
        if (k === 'y') { e.preventDefault(); redo(); return; }
    }
    if (e.code === 'Space') {
        if (editing) return;
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT') document.activeElement.blur();
        if (spaceDown) { e.preventDefault(); return; }
        e.preventDefault();
        spaceDown = true;
        canvas.isDrawingMode = false;
        canvas.defaultCursor = 'grab';
        canvas.freeDrawingCursor = 'grab';
        return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !editing) {
        if (!active) return;
        if (active === currentFile) closeCurrentFile();
        else { canvas.remove(active); canvas.requestRenderAll(); }
    }
});
window.addEventListener('keyup', e => {
    if (e.code !== 'Space') return;
    spaceDown = false; panning = false;
    setTool(tool);
});
window.addEventListener('pointerup', () => { inkErasing = false; });
window.addEventListener('blur', () => { inkErasing = false; spaceDown = false; });

canvas.on('mouse:down', opt => {
    if (spaceDown) { panning = true; canvas.selection = false; canvas.setCursor('grabbing'); return; }
    if (angleLens && handleLensClick(opt.e)) return;
    if (natClick(opt.e)) return;
    if (selectedNatHit) closeGeometryTools();
    if (tool === 'eraserInk') { inkErasing = true; eraseSketchesAt(canvas.getPointer(opt.e)); return; }
    if (tool === 'arrow') { arrowStart = canvas.getPointer(opt.e); tempArrow = null; return; }
    if (tool === 'highlight') { hlStart = canvas.getPointer(opt.e); tempHl = null; return; }
    if (tool === 'text') {
        if (opt.target && (opt.target.type === 'i-text' || opt.target.type === 'textbox')) return;
        addTextAt(opt.e);
    }
});
canvas.on('mouse:move', opt => {
    if (panning) {
        const vt = canvas.viewportTransform;
        vt[4] += opt.e.movementX; vt[5] += opt.e.movementY;
        updateViewChip();
        canvas.requestRenderAll();
        return;
    }
    const p = canvas.getPointer(opt.e);
    if (inkErasing) { eraseSketchesAt(p); return; }
    if (arrowStart) {
        if (tempArrow) canvas.remove(tempArrow);
        tempArrow = makeArrow(arrowStart.x, arrowStart.y, p.x, p.y);
        if (tempArrow) { tempArrow.isFile = false; canvas.add(tempArrow); }
    }
    if (hlStart) {
        if (tempHl) canvas.remove(tempHl);
        tempHl = makeHighlight(hlStart.x, hlStart.y, p.x, p.y);
        if (tempHl) { tempHl.isFile = false; canvas.add(tempHl); }
    }
});
canvas.on('mouse:up', () => {
    if (panning) { panning = false; canvas.selection = (tool === 'select'); }
    inkErasing = false;
    if (arrowStart) {
        if (tempArrow && (tempArrow.width + tempArrow.height) < 14) {
            canvas.remove(tempArrow);
        } else if (tempArrow) {
            endpointLabels(tempArrow);
        }
        tempArrow = null; arrowStart = null;
    }
    if (hlStart) {
        if (tempHl && Math.hypot(tempHl.x2 - tempHl.x1, tempHl.y2 - tempHl.y1) < 6) canvas.remove(tempHl);
        tempHl = null; hlStart = null;
    }
    if (!suppressHistory && (tool === 'eraserInk' || tool === 'eraserAll')) { queueSnapshot(); }
});

// ================= File state =================
let currentFile = null, fileKind = null, pdfDoc = null, pageNum = 1;
const PDF_BASE_SCALE = 1.5;
const pageLabel = document.getElementById('pageLabel');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
function fitIfNeeded(obj) {
    const s = Math.min(1, (canvas.getWidth() - 20) / obj.width, (canvas.getHeight() - 20) / obj.height);
    obj.set({ scaleX: s, scaleY: s });
}
function focusObject(obj) { setTool('select'); canvas.setActiveObject(obj); canvas.requestRenderAll(); }
function updatePageUI() {
    const multi = !!pdfDoc && pdfDoc.numPages > 1;
    pager.style.display = multi ? 'flex' : 'none';
    btnPrev.disabled = !multi || pageNum <= 1;
    btnNext.disabled = !multi || pageNum >= pdfDoc.numPages;
    pageLabel.textContent = pdfDoc ? `${pageNum} / ${pdfDoc.numPages}` : '–';
}
function closeCurrentFile() {
    if (!currentFile) return;
    canvas.remove(currentFile);
    currentFile = null; fileKind = null;
    pdfDoc = null; pageNum = 1;
    pageMemory.clear(); boardPage = 0; boardPages = 1; updateBoardPager();
    canvas.discardActiveObject();
    updatePageUI();
    canvas.requestRenderAll();
}
function setStatus(msg) {}
async function renderPageToCanvas(n) {
    const page = await pdfDoc.getPage(n);
    const vp = page.getViewport({ scale: PDF_BASE_SCALE });
    const off = document.createElement('canvas');
    off.width = vp.width; off.height = vp.height;
    await page.render({ canvasContext: off.getContext('2d'), viewport: vp }).promise;
    return off;
}
async function showPage(n, isNewFile = false) {
    const off = await renderPageToCanvas(n);
    if (!isNewFile && currentFile && fileKind === 'pdf') {
        const { left, top, scaleX, scaleY } = currentFile;
        currentFile.setElement(off);
        currentFile.set({ left, top, scaleX, scaleY });
    } else {
        const img = new fabric.Image(off, { left: 0, top: 0 });
        img.isFile = true; img.erasable = false;
        fitIfNeeded(img);
        canvas.add(img);
        currentFile = img; fileKind = 'pdf';
        applyFileErasability();
        applyInteractivity();
        focusObject(img);
    }
    pageNum = n;
    updatePageUI();
    canvas.requestRenderAll();
}
const fileInput = document.getElementById('fileInput');
document.getElementById('btnUpload').onclick = () => fileInput.click();
fileInput.onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (/\.(boardview|json)$/i.test(file.name)) { await openBoardFile(file); return; }
    if (hasInk()) {
        const ans = await askSaveChanges();
        if (ans === 'cancel') return;
        if (ans === 'save') exportPNG();
    }
    suppressHistory = true;
    closeCurrentFile();
    removeAnnotationsSilent();
    suppressHistory = false;
    await openFile(file);
    resetHistory();
};
async function openFile(file) {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const isImg = file.type.startsWith('image/');
    if (isPdf) {
        try {
            const buf = await file.arrayBuffer();
            pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
            await showPage(1, true);
        } catch (err) {}
    } else if (isImg) {
        await new Promise(res => {
            const url = URL.createObjectURL(file);
            fabric.Image.fromURL(url, img => {
                img.set({ left: 0, top: 0 });
                img.isFile = true; img.erasable = false;
                fitIfNeeded(img);
                canvas.add(img);
                currentFile = img; fileKind = 'image';
                applyFileErasability();
                applyInteractivity();
                focusObject(img);
                URL.revokeObjectURL(url);
                res();
            });
        });
    }
}
async function openBoardFile(file) {
    let data;
    try {
        data = JSON.parse(await file.text());
        if ((data.app !== 'BoardFlow' && data.app !== 'BoardView') || !data.objects) throw new Error('bad');
    } catch (err) { return; }
    if (hasInk()) {
        const ans = await askSaveChanges();
        if (ans === 'cancel') return;
        if (ans === 'save') exportPNG();
    }
    suppressHistory = true;
    closeCurrentFile();
    removeAnnotationsSilent();
    suppressHistory = false;
    canvas.loadFromJSON(data.objects, () => {
        currentFile = canvas.getObjects().find(o => o.isFile) || null;
        fileKind = currentFile ? (data.fileKind || 'image') : null;
        pdfDoc = null;
        pageNum = data.pageNum || 1;
        pageMemory.clear();
        if (data.memory) Object.entries(data.memory).forEach(([k, v]) => pageMemory.set(k, v));
        boardPages = data.boardPages || 1;
        boardPage = data.boardPage || 0;
        pageMemory.set(memKey(boardPage, pageNum), annotationsJSON());
        updateBoardPager();
        if (data.viewport && data.viewport.length === 6) canvas.setViewportTransform(data.viewport);
        theme = data.theme || theme;
        showGrid = (data.grid === undefined) ? showGrid : !!data.grid;
        applyTheme();
        updatePageUI();
        updateViewChip();
        setTool(tool);
        resetHistory();
    });
}
btnPrev.onclick = () => flipPage(-1);
btnNext.onclick = () => flipPage(1);
function memKey(bp, pp) { return bp + ':' + pp; }
async function stashOrPrompt(keepKey) {
    if (hasInk()) {
        const ans = await askSaveChanges();
        if (ans === 'cancel') return false;
        if (ans === 'save') { exportPNG(); pageMemory.set(keepKey, annotationsJSON()); }
        else pageMemory.delete(keepKey);
    } else pageMemory.delete(keepKey);
    return true;
}
async function swapAnnotations(newKey) {
    suppressHistory = true;
    canvas.discardActiveObject();
    removeAnnotationsSilent();
    suppressHistory = false;
    const saved = pageMemory.get(newKey);
    if (saved) await applyAnnotationStateAsync(saved);
    resetHistory();
}
async function flipPage(delta) {
    if (!pdfDoc) return;
    const n = pageNum + delta;
    if (n < 1 || n > pdfDoc.numPages) return;
    if (!await stashOrPrompt(memKey(boardPage, pageNum))) return;
    await showPage(n);
    await swapAnnotations(memKey(boardPage, n));
}
function memKey(bp, pp) { return bp + ':' + pp; }
async function stashOrPrompt(keepKey) {
    if (hasInk()) {
        const ans = await askSaveChanges();
        if (ans === 'cancel') return false;
        if (ans === 'save') { exportPNG(); pageMemory.set(keepKey, annotationsJSON()); }
        else pageMemory.delete(keepKey);
    } else pageMemory.delete(keepKey);
    return true;
}
async function swapAnnotations(newKey) {
    suppressHistory = true;
    canvas.discardActiveObject();
    removeAnnotationsSilent();
    suppressHistory = false;
    const saved = pageMemory.get(newKey);
    if (saved) await applyAnnotationStateAsync(saved);
    resetHistory();
}
async function flipPage(delta) {
    if (!pdfDoc) return;
    const n = pageNum + delta;
    if (n < 1 || n > pdfDoc.numPages) return;
    if (!await stashOrPrompt(memKey(boardPage, pageNum))) return;
    await showPage(n);
    await swapAnnotations(memKey(boardPage, n));
}
async function flipBoard(delta) {
    const n = boardPage + delta;
    if (n < 0 || n >= boardPages) return;
    if (!await stashOrPrompt(memKey(boardPage, pageNum))) return;
    boardPage = n;
    updateBoardPager();
    await swapAnnotations(memKey(n, pageNum));
}
function addBoardPage() {
    (async () => {
        if (!await stashOrPrompt(memKey(boardPage, pageNum))) return;
        boardPages += 1;
        boardPage = boardPages - 1;
        updateBoardPager();
        await swapAnnotations(memKey(boardPage, pageNum));
    })();
}
function updateBoardPager() {
    const bp = document.getElementById('bpager');
    if (!bp) return;
    bp.style.display = boardPages > 1 ? 'flex' : 'none';
    document.getElementById('bpageLabel').textContent = (boardPage + 1) + ' / ' + boardPages;
    document.getElementById('btnBPrev').disabled = boardPage <= 0;
    document.getElementById('btnBNext').disabled = boardPage >= boardPages - 1;
}
const _bp1 = document.getElementById('btnBPrev'); if (_bp1) _bp1.onclick = () => flipBoard(-1);
const _bp2 = document.getElementById('btnBNext'); if (_bp2) _bp2.onclick = () => flipBoard(1);
const _bp3 = document.getElementById('btnBAdd'); if (_bp3) _bp3.onclick = addBoardPage;
const _np = document.getElementById('btnNewPage'); if (_np) _np.onclick = addBoardPage;
// ================= Export / dialog =================
function exportPNG() {
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    const a = document.createElement('a');
    a.download = 'boardflow-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png';
    a.href = canvas.toDataURL({ format: 'png' });
    a.click();
}
const dlg = document.getElementById('dialog');
function askSaveChanges() {
    return new Promise(resolve => {
        clearTimeout(hideTimer);
        dlg.classList.remove('hidden');
        const done = v => { dlg.classList.add('hidden'); if (!menu.classList.contains('hidden')) armHide(); resolve(v); };
        document.getElementById('dlgSave').onclick = () => done('save');
        document.getElementById('dlgDont').onclick = () => done('discard');
        document.getElementById('dlgCancel').onclick = () => done('cancel');
    });
}

// ================= Natural Angle Recognition (NAT) Module =================
let natHits = [];
let natRevealed = new Set();
const natEndpointLabels = new Map();
const natCrossingLabels = new Map();
let natLessonVisible = false;
const natActive = true;
let natIdCounter = 0;
const natPalette = ['#e6194b','#3cb44b','#f58e26','#4363d8','#911eb4','#008080','#f032e6','#bc7400'];
const natLetters = 'abcdefghijklmnopqrstuvwxyz';
let natEndpointCounter = 0;
let natCrossingCounter = 0;
const btnAngles = document.getElementById('btnAngles');
const geometryToolRail = document.getElementById('geometryToolRail');
const geometryInsight = document.getElementById('geometryInsight');
let selectedNatHit = null;
function setGeometryToolRailVisible(visible) {
    geometryToolRail.classList.toggle('hidden', !visible);
    if (!visible) geometryInsight.classList.add('hidden');
}
function closeGeometryTools() {
    selectedNatHit = null;
    natRevealed.clear();
    setGeometryToolRailVisible(false);
    geometryToolRail.querySelectorAll('button.active').forEach(button => button.classList.remove('active'));
    canvas.requestRenderAll();
}
function showGeometryInsight(title, text) {
    geometryInsight.querySelector('h4').textContent = title;
    geometryInsight.querySelector('p').textContent = text;
    geometryInsight.classList.remove('hidden');
}
function runGeometryTool(tool, button) {
    if (!selectedNatHit) return;
    geometryToolRail.querySelectorAll('button.active').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    const angle = Math.round(selectedNatHit.deg);
    const results = {
        pairs: ['Angle relationships', `Selected angle: ${angle}°\nSupplementary: ${180 - angle}°\nComplementary: ${Math.max(0, 90 - angle)}°`],
        vertical: ['Vertically opposite', `The opposite angle is also ${angle}°.`],
        parallel: ['Parallel-line relationships', `Selected angle: ${angle}°\nSelect another crossing to compare corresponding angles.`],
        triangle: ['Triangle angle sum', `Remaining triangle angles total ${180 - angle}°.`],
        exercise: ['Missing-angle exercise', `180° − ${angle}° = ${180 - angle}°`],
        trig: ['Trigonometry', `sin ${angle}° = ${Math.sin(angle * Math.PI / 180).toFixed(3)}\ncos ${angle}° = ${Math.cos(angle * Math.PI / 180).toFixed(3)}\ntan ${angle}° = ${Math.tan(angle * Math.PI / 180).toFixed(3)}`],
        pythagoras: ['Pythagoras theorem', 'Select two sides of a right triangle to calculate the missing side.'],
        area: ['Perimeter and area', 'Select a closed shape to calculate its perimeter and area.'],
        measure: ['Angle measurement', `Measured angle: ${angle}°`]
    };
    const result = results[tool];
    if (result) showGeometryInsight(result[0], result[1]);
}
geometryToolRail.querySelectorAll('[data-geometry-tool]').forEach(button => {
    button.addEventListener('click', event => {
        event.stopPropagation();
        runGeometryTool(button.dataset.geometryTool, button);
    });
});
function updateAngleButton() {
    const hasArrows = canvas.getObjects().some(o => o.isArrow);
    btnAngles.classList.toggle('hidden', !hasArrows);
    btnAngles.classList.toggle('active', natLessonVisible);
}
btnAngles.onclick = () => {
    natLessonVisible = !natLessonVisible;
    natRevealed.clear();
    selectedNatHit = null;
    setGeometryToolRailVisible(false);
    canvas.requestRenderAll();
    updateAngleButton();
};
function nextNatLetter() {
    const index = natEndpointCounter++;
    if (index < natLetters.length) return natLetters[index].toUpperCase();
    return (natLetters[Math.floor(index / natLetters.length) - 1] + natLetters[index % natLetters.length]).toUpperCase();
}
function endpointLabels(o) {
    const id = uid(o);
    if (!natEndpointLabels.has(id)) natEndpointLabels.set(id, [nextNatLetter(), nextNatLetter()]);
    return natEndpointLabels.get(id);
}
function assignArrowLabels() {
    let labelIndex = 0;
    canvas.getObjects().forEach(o => {
        if (!o.isArrow) return;
        const labels = [String.fromCharCode(65 + labelIndex), String.fromCharCode(66 + labelIndex)];
        labelIndex += 2;
        natEndpointLabels.set(uid(o), labels);
    });
    natEndpointCounter = labelIndex;
}
function crossingLabel(key) {
    if (!natCrossingLabels.has(key)) {
        const index = natCrossingCounter++;
        natCrossingLabels.set(key, index < 26 ? String.fromCharCode(90 - index) : 'X' + (index + 1));
    }
    return natCrossingLabels.get(key);
}
function crossingPointKey(point) {
    return Math.round(point.x * 10) + '_' + Math.round(point.y * 10);
}

function natStraight(o) {
    const segment = straightSegment(o);
    return segment ? { p1: segment[0], p2: segment[1] } : null;
}

function natClick(e) {
    const rect = canvas.lowerCanvasEl.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const hit of natHits) {
        const dist = Math.sqrt((hit.x - clickX)**2 + (hit.y - clickY)**2);
        if (dist <= 18 && dist < nearestDistance) {
            nearest = hit;
            nearestDistance = dist;
        }
    }
    if (!nearest) return false;
    selectedNatHit = nearest;
    natRevealed.clear();
    natRevealed.add(nearest.key);
    setGeometryToolRailVisible(true);
    geometryInsight.classList.add('hidden');
    canvas.requestRenderAll();
    return true;
}

canvas.on('after:render', () => {
    natHits = [];
    if (!natActive) return;
    assignArrowLabels();
    updateAngleButton();
    if (!natLessonVisible) return;
    natCrossingLabels.clear();
    natCrossingCounter = 0;
    const ctx = canvas.contextContainer;
    if (!ctx) return;
    ctx.save();

    // 1. Collect all straight segments
    const natSegments = [];
    canvas.getObjects().forEach(o => {
        const ends = natStraight(o);
        if (ends) {
            const p1 = fabric.util.transformPoint(ends.p1, canvas.viewportTransform);
            const p2 = fabric.util.transformPoint(ends.p2, canvas.viewportTransform);
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            let angle = Math.atan2(dy, dx) * 180 / Math.PI;
            if (angle < 0) angle += 180; // mod 180
            natSegments.push({ o, p1, p2, angle });
        }
    });

    // 2. Parallel groups
    const natGroups = [];
    natSegments.forEach(seg => {
        let matched = false;
        for (const g of natGroups) {
            let diff = Math.abs(g.angle - seg.angle);
            if (diff > 90) diff = 180 - diff;
            if (diff <= 2) {
                g.members.push(seg);
                matched = true;
                break;
            }
        }
        if (!matched) {
            natGroups.push({ angle: seg.angle, members: [seg] });
        }
    });

    natGroups.forEach((g, groupIndex) => {
        const color = natPalette[groupIndex % natPalette.length];
        g.members.forEach((seg) => {
            // Chevron marks at midpoint
            if (g.members.length >= 2) {
                const mx = (seg.p1.x + seg.p2.x) / 2;
                const my = (seg.p1.y + seg.p2.y) / 2;
                const chevrons = Math.min(g.members.length, 3);
                const dx = seg.p2.x - seg.p1.x;
                const dy = seg.p2.y - seg.p1.y;
                const len = Math.sqrt(dx*dx + dy*dy) || 1;
                const ux = dx / len, uy = dy / len;
                const nx = -uy, ny = ux;
                const spacing = 6;
                ctx.save();
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                for (let c = 0; c < chevrons; c++) {
                    const offset = (c - (chevrons - 1) / 2) * spacing;
                    const cx = mx + nx * offset;
                    const cy = my + ny * offset;
                    const size = 8;
                    ctx.beginPath();
                    ctx.moveTo(cx - ux * size + nx * size * 0.5, cy - uy * size + ny * size * 0.5);
                    ctx.lineTo(cx, cy);
                    ctx.lineTo(cx - ux * size - nx * size * 0.5, cy - uy * size - ny * size * 0.5);
                    ctx.stroke();
                }
                ctx.restore();
            }
        });
    });

    // 3. Crossings
        const crossingPositions = new Map();
        for (let i = 0; i < natSegments.length; i++) {
            for (let j = i + 1; j < natSegments.length; j++) {
                const point = segIntersect(natSegments[i].p1, natSegments[i].p2, natSegments[j].p1, natSegments[j].p2);
                if (point) crossingPositions.set(crossingPointKey(point), point);
            }
        }
        [...crossingPositions.values()]
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .forEach((point, index) => {
                natCrossingLabels.set(
                    crossingPointKey(point),
                    index < 26 ? String.fromCharCode(90 - index) : 'X' + (index + 1)
                );
            });
        for (let i = 0; i < natSegments.length; i++) {
        for (let j = i + 1; j < natSegments.length; j++) {
            const s1 = natSegments[i];
            const s2 = natSegments[j];
            
            // Segment-segment intersection
            const x1 = s1.p1.x, y1 = s1.p1.y, x2 = s1.p2.x, y2 = s1.p2.y;
            const x3 = s2.p1.x, y3 = s2.p1.y, x4 = s2.p2.x, y4 = s2.p2.y;
            const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
            if (denom === 0) continue;
            const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
            const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
            
            if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
                const pt = { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
                const firstLabels = endpointLabels(s1.o);
                const secondLabels = endpointLabels(s2.o);
                const rays = [
                    { angle: Math.atan2(s1.p2.y - s1.p1.y, s1.p2.x - s1.p1.x) * 180 / Math.PI, label: firstLabels[1] },
                    { angle: Math.atan2(s1.p1.y - s1.p2.y, s1.p1.x - s1.p2.x) * 180 / Math.PI, label: firstLabels[0] },
                    { angle: Math.atan2(s2.p2.y - s2.p1.y, s2.p2.x - s2.p1.x) * 180 / Math.PI, label: secondLabels[1] },
                    { angle: Math.atan2(s2.p1.y - s2.p2.y, s2.p1.x - s2.p2.x) * 180 / Math.PI, label: secondLabels[0] }
                ].sort((a, b) => a.angle - b.angle);
                const ids = [uid(s1.o), uid(s2.o)].sort();
                const vertex = crossingLabel(crossingPointKey(pt));
                
                for (let k = 0; k < 4; k++) {
                    let diff = rays[(k + 1) % 4].angle - rays[k].angle;
                    if (diff < 0) diff += 360;
                    
                    if (diff >= 3 && diff <= 177) {
                        const ids = [uid(s1.o), uid(s2.o)].sort();
                        const key = `${ids[0]}_${ids[1]}_${k}`;
                        const midRay = (rays[k].angle + diff / 2) % 360;
                        const circle = {
                            x: pt.x + Math.cos(midRay * Math.PI / 180) * 26,
                            y: pt.y + Math.sin(midRay * Math.PI / 180) * 26
                        };
                        const col = colorForDeg(diff);
                         
                        const angleName = rays[k].label + vertex + rays[(k + 1) % 4].label;
                        natHits.push({ x: circle.x, y: circle.y, key, deg: diff, midRay, angleName, segments: [s1, s2] });
                        
                        ctx.save();
                        ctx.translate(circle.x, circle.y);
                        ctx.fillStyle = selectedNatHit && selectedNatHit.key === key ? col : 'rgba(255,255,255,0.95)';
                        ctx.strokeStyle = col;
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.arc(0, 0, 6, 0, 2 * Math.PI);
                        ctx.fill();
                        ctx.stroke();
                        ctx.fillStyle = '#000';
                        ctx.font = 'bold 11px sans-serif';
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(angleName, 10, 0);
                        
                        if (natRevealed.has(key)) {
                            ctx.fillStyle = '#4363d8';
                            ctx.font = '12px sans-serif';
                            ctx.fillText(Math.round(diff) + '°', 12, 18);
                        }
                        ctx.restore();
                    }
                }
            }
        }
    }

    const labeledSegments = new Map();
    natSegments.forEach(seg => {
        labeledSegments.set(uid(seg.o), seg);
    });
    labeledSegments.forEach(seg => {
        const labels = endpointLabels(seg.o);
        ctx.save();
        ctx.fillStyle = '#000';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 4;
        [seg.p1, seg.p2].forEach((point, index) => {
            const dx = point.x - (seg.p1.x + seg.p2.x) / 2;
            const dy = point.y - (seg.p1.y + seg.p2.y) / 2;
            const length = Math.hypot(dx, dy) || 1;
            const offset = 14;
            const labelX = point.x + (dx / length) * offset;
            const labelY = point.y + (dy / length) * offset;
            ctx.strokeText(labels[index], labelX, labelY);
            ctx.fillText(labels[index], labelX, labelY);
        });
        ctx.restore();
    });

    // 4. Triangles
    canvas.getObjects().forEach(o => {
        if (o.isTriangle) {
            const sWorld = triangleWorldPts(o);
            if (!sWorld || sWorld.length < 3) return;
            const s = sWorld.map(pt => fabric.util.transformPoint(pt, canvas.viewportTransform));
            
            const centroid = {
                x: (s[0].x + s[1].x + s[2].x) / 3,
                y: (s[0].y + s[1].y + s[2].y) / 3
            };
            
            const pushOut = (pt, r) => {
                const dx = pt.x - centroid.x;
                const dy = pt.y - centroid.y;
                const dist = Math.sqrt(dx*dx + dy*dy) || 1;
                return { x: pt.x + (dx/dist)*r, y: pt.y + (dy/dist)*r };
            };
            
            const corners = ['A', 'B', 'C'];
            s.forEach((pt, i) => {
                const labelPt = pushOut(pt, 20);
                ctx.save();
                ctx.fillStyle = '#000';
                ctx.font = 'bold 16px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(corners[i], labelPt.x, labelPt.y);
                ctx.restore();
            });
            
            const sides = [
                { pts: [s[1], s[2]], label: 'a' },
                { pts: [s[2], s[0]], label: 'b' },
                { pts: [s[0], s[1]], label: 'c' }
            ];
            
            sides.forEach(side => {
                const mid = { x: (side.pts[0].x + side.pts[1].x)/2, y: (side.pts[0].y + side.pts[1].y)/2 };
                const labelPt = pushOut(mid, 20);
                ctx.save();
                ctx.fillStyle = '#000';
                ctx.font = 'italic 16px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(side.label, labelPt.x, labelPt.y);
                ctx.restore();
            });
        }
    });

    ctx.restore();
});
// ================= Bridge for the Mathematics module =================
// ================= Bridge for the Mathematics module =================
window.BF = {
    canvas: canvas,
    fabric: fabric,
    clamp: clamp,
    viewCenterWorld: viewCenterWorld,
    penColor: () => pen.color,
    insertCanvas: function (cnv) {
        const img = new fabric.Image(cnv, {});
        const c = viewCenterWorld();
        const z = canvas.getZoom();
        const maxW = (canvas.getWidth() / z) * 0.8;
        const s = Math.min(1, maxW / cnv.width);
        img.set({ left: c.x - (cnv.width * s) / 2, top: c.y - (cnv.height * s) / 2, scaleX: s, scaleY: s, selectable: true, evented: true });
        img.isFile = false;
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
    }
};

// ================= Init =================
updatePageUI();
updateViewChip();
applyTheme();
setTool('pen');
showMenu();
resetHistory();
window.dispatchEvent(new Event('bf-ready'));

} // end startApp