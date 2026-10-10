// ================= BoardFlow Mathematics module =================
import { compile as compileMathExpression, evaluate as evaluateMathExpression } from 'mathjs';
import { byId } from './dom.js';

(function () {
if (window.BF) init(window.BF); else window.addEventListener('bf-ready', () => init(window.BF));

function init(BF) {
const clamp = BF.clamp;
const el = byId;
const round2 = v => Math.round(v * 100) / 100;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

const panel = el('mathPanel');
el('btnMath').onclick = () => panel.classList.toggle('hidden');
el('mathClose').onclick = () => panel.classList.add('hidden');
const tabs = { mTabGraph: 'secGraph', mTabAlg: 'secAlg', mTabStat: 'secStat', mTabCircle: 'secCircle' };
function activateTab(id) {
    Object.keys(tabs).forEach(t => el(t).classList.toggle('active', t === id));
    Object.keys(tabs).forEach(t => el(tabs[t]).classList.toggle('on', tabs[t] === tabs[id]));
}
Object.keys(tabs).forEach(id => { const b = el(id); if (b) b.onclick = () => activateTab(id); });
function openPanel(tabId) {
    panel.classList.remove('hidden');
    activateTab(tabId);
}

el('customRow').classList.remove('hidden');

let compiled = null, compiledSrc = '';
function baseFn(kind, x, deg) {
    switch (kind) {
        case 'linear': return x;
        case 'quad': return x * x;
        case 'cubic': return x * x * x;
        case 'recip': return x === 0 ? NaN : 1 / x;
        case 'recip2': return x === 0 ? NaN : 1 / (x * x);
        case 'sqrt': return x < 0 ? NaN : Math.sqrt(x);
        case 'cbrt': return Math.cbrt(x);
        case 'abs': return Math.abs(x);
        case 'exp': return Math.exp(x);
        case 'ln': return x <= 0 ? NaN : Math.log(x);
        case 'const': return 0;
        case 'sin': return deg ? Math.sin(x * D2R) : Math.sin(x);
        case 'cos': return deg ? Math.cos(x * D2R) : Math.cos(x);
        case 'tan': { const t = deg ? Math.tan(x * D2R) : Math.tan(x); return Math.abs(t) > 60 ? NaN : t; }
        case 'custom': {
            const src = el('gCustom').value || 'x';
            if (src !== compiledSrc) { try { compiled = compileMathExpression(src); compiledSrc = src; } catch (e) { compiled = null; } }
            if (!compiled) return NaN;
            try { const v = compiled.evaluate({ x: x }); return typeof v === 'number' ? v : NaN; } catch (e) { return NaN; }
        }
    }
    return NaN;
}
function makeF(o) {
    if (o.q) return x => o.q.A * x * x + o.q.B * x + o.q.C;
    return x => o.a * baseFn(o.kind, o.b * x + o.c, o.deg) + o.d;
}
function numGrad(o, p) { const f = makeF(o); const h = 1e-4; return (f(p + h) - f(p - h)) / (2 * h); }
function numArea(o, a0, a1) {
    const f = makeF(o); const n = 200; const h = (a1 - a0) / n; let s = 0;
    for (let i = 0; i < n; i++) {
        const ya = f(a0 + i * h), yb = f(a0 + (i + 1) * h);
        if (!isFinite(ya) || !isFinite(yb)) continue;
        s += (ya + yb) / 2 * h;
    }
    return s;
}

function drawPlot(ctx, W, H, o) {
    const S = W / 320;
    const trig = o.kind === 'sin' || o.kind === 'cos' || o.kind === 'tan';
    const xMax = trig ? (o.deg ? 360 : 2 * Math.PI) : 8, xMin = -xMax;
    const yMin = -6, yMax = 6;
    const X = x => (x - xMin) / (xMax - xMin) * W;
    const Y = y => H - (y - yMin) / (yMax - yMin) * H;
    if (o.transparent) ctx.clearRect(0, 0, W, H);
    else { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); }
    ctx.strokeStyle = 'rgba(120,120,120,.30)'; ctx.lineWidth = S;
    const gx = o.deg ? 90 : 1;
    ctx.beginPath();
    for (let x = Math.ceil(xMin / gx) * gx; x <= xMax; x += gx) { ctx.moveTo(X(x), 0); ctx.lineTo(X(x), H); }
    for (let y = yMin; y <= yMax; y += 1) { ctx.moveTo(0, Y(y)); ctx.lineTo(W, Y(y)); }
    ctx.stroke();
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5 * S;
    ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), H); ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); ctx.stroke();
    ctx.fillStyle = '#666'; ctx.font = Math.round(10 * S) + 'px sans-serif';
    const lx = o.deg ? 90 : 2;
    for (let x = Math.ceil(xMin / lx) * lx; x <= xMax; x += lx) if (x) ctx.fillText(o.deg ? x + '°' : String(x), X(x) + 2 * S, Y(0) + 12 * S);
    for (let y = yMin; y <= yMax; y += 2) if (y) ctx.fillText(String(y), X(0) + 3 * S, Y(y) - 2 * S);

    if (o.mode === 'param' && o.param) {
        const xFn = compileExpression(o.param.x, 'cos(t)');
        const yFn = compileExpression(o.param.y, 'sin(t)');
        const tMin = Number(o.param.tMin) || 0, tMax = Number(o.param.tMax) || 2 * Math.PI;
        const nPoints = 800;
        ctx.strokeStyle = '#4363d8'; ctx.lineWidth = 2.5 * S;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i <= nPoints; i++) {
            const t = tMin + (tMax - tMin) * i / nPoints;
            const x = xFn(t), y = yFn(t);
            if (!isFinite(x) || !isFinite(y)) { started = false; continue; }
            const px = (x + 6) / 12 * W;
            const py = H - (y + 6) / 12 * H;
            if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
        if (o.title) { ctx.fillStyle = '#333'; ctx.font = 'bold ' + Math.round(12 * S) + 'px sans-serif'; ctx.fillText(o.title, 8 * S, 14 * S); }
        return;
    }

    if (o.mode === 'piecewise') {
        const xMinP = -8, xMaxP = 8;
        ctx.strokeStyle = '#4363d8'; ctx.lineWidth = 2.5 * S;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i <= 800; i++) {
            const x = xMinP + (xMaxP - xMinP) * i / 800;
            const y = piecewiseValue(x, o.piecewise || 'x');
            if (!isFinite(y)) { started = false; continue; }
            const px = (x - xMinP) / (xMaxP - xMinP) * W;
            const py = H - (y - yMin) / (yMax - yMin) * H;
            if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
        if (o.title) { ctx.fillStyle = '#333'; ctx.font = 'bold ' + Math.round(12 * S) + 'px sans-serif'; ctx.fillText(o.title, 8 * S, 14 * S); }
        return;
    }

    const f = makeF(o);
    if (o.derivative) {
        const derivative = x => {
            const h = 1e-3;
            const y1 = f(x - h), y2 = f(x + h);
            if (!isFinite(y1) || !isFinite(y2)) return NaN;
            return (y2 - y1) / (2 * h);
        };
        strokeCurve(ctx, derivative, xMin, xMax, Y, X, '#f58e26', 1.5 * S);
    }
    if (o.area) {
        const a0 = o.area[0], a1 = o.area[1], N = 160;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i <= N; i++) {
            const x = a0 + (a1 - a0) * i / N; const y = f(x);
            if (!isFinite(y)) { started = false; continue; }
            if (!started) { ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(y)); started = true; }
            else ctx.lineTo(X(x), Y(y));
        }
        ctx.lineTo(X(a1), Y(0)); ctx.closePath();
        ctx.fillStyle = 'rgba(67,99,216,.25)'; ctx.fill();
        if (o.trap) {
            const n = 8;
            ctx.strokeStyle = 'rgba(67,99,216,.8)'; ctx.lineWidth = S;
            ctx.beginPath();
            for (let i = 0; i <= n; i++) {
                const x = a0 + (a1 - a0) * i / n; const y = f(x);
                if (isFinite(y)) { ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(y)); }
            }
            for (let i = 0; i < n; i++) {
                const xa = a0 + (a1 - a0) * i / n, xb = a0 + (a1 - a0) * (i + 1) / n;
                const ya = f(xa), yb = f(xb);
                if (isFinite(ya) && isFinite(yb)) { ctx.moveTo(X(xa), Y(ya)); ctx.lineTo(X(xb), Y(yb)); }
            }
            ctx.stroke();
        }
    }
    strokeCurve(ctx, f, xMin, xMax, Y, X, '#4363d8', 2.5 * S);
    if (o.sec) {
        const f2 = makeF(o.sec);
        strokeCurve(ctx, f2, xMin, xMax, Y, X, '#e6194b', 2.5 * S);
        intersections(f, f2, xMin, xMax).forEach(p => {
            ctx.fillStyle = '#911eb4';
            ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 5 * S, 0, 7); ctx.fill();
            ctx.font = 'bold ' + Math.round(10 * S) + 'px sans-serif';
            ctx.fillText('(' + round2(p[0]) + ', ' + round2(p[1]) + ')', X(p[0]) + 7 * S, Y(p[1]) - 7 * S);
        });
    }
    if (o.tanP != null) {
        const p = o.tanP, m = numGrad(o, p), y0 = f(p);
        if (isFinite(m) && isFinite(y0)) {
            ctx.strokeStyle = '#f58e26'; ctx.lineWidth = 2 * S; ctx.setLineDash([6 * S, 4 * S]);
            ctx.beginPath();
            ctx.moveTo(X(xMin), Y(y0 + m * (xMin - p)));
            ctx.lineTo(X(xMax), Y(y0 + m * (xMax - p)));
            ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = '#f58e26';
            ctx.beginPath(); ctx.arc(X(p), Y(y0), 4 * S, 0, 7); ctx.fill();
            ctx.font = 'bold ' + Math.round(11 * S) + 'px sans-serif';
            ctx.fillText('gradient = ' + round2(m), X(p) + 8 * S, Y(y0) - 8 * S);
        }
    }
    if (o.roots) o.roots.forEach(r => {
        if (isFinite(r) && r >= xMin && r <= xMax) {
            ctx.fillStyle = '#3cb44b';
            ctx.beginPath(); ctx.arc(X(r), Y(0), 5 * S, 0, 7); ctx.fill();
        }
    });
    if (o.title) { ctx.fillStyle = o.transparent ? '#888' : '#333'; ctx.font = 'bold ' + Math.round(12 * S) + 'px sans-serif'; ctx.fillText(o.title, 8 * S, 14 * S); }
}
function strokeCurve(ctx, f, xMin, xMax, Y, X, col, wdt) {
    ctx.strokeStyle = col; ctx.lineWidth = wdt;
    ctx.beginPath();
    let down = false;
    const N2 = 600;
    for (let i = 0; i <= N2; i++) {
        const x = xMin + (xMax - xMin) * i / N2; const y = f(x);
        if (!isFinite(y) || Math.abs(y) > 30) { down = false; continue; }
        if (!down) { ctx.moveTo(X(x), Y(y)); down = true; } else ctx.lineTo(X(x), Y(y));
    }
    ctx.stroke();
}
function intersections(f1, f2, xMin, xMax) {
    const res = [];
    const N = 400;
    let px = xMin, pd = f1(xMin) - f2(xMin);
    for (let i = 1; i <= N; i++) {
        const x = xMin + (xMax - xMin) * i / N;
        const d = f1(x) - f2(x);
        if (isFinite(pd) && isFinite(d) && pd * d <= 0 && (Math.abs(pd) + Math.abs(d)) > 0) {
            let a = px, b = x, da = pd;
            for (let k = 0; k < 30; k++) { const m = (a + b) / 2; const dm = f1(m) - f2(m); if (da * dm <= 0) b = m; else { a = m; da = dm; } }
            const rx = (a + b) / 2, ry = f1(rx);
            if (isFinite(ry) && Math.abs(ry) < 20) res.push([rx, ry]);
        }
        px = x; pd = d;
    }
    return res.filter((p, i) => i === 0 || Math.abs(p[0] - res[i - 1][0]) > 0.01);
}
function compileExpression(expr, fallback) {
    const text = (expr || fallback || 'x').trim();
    if (!text) return () => NaN;
    return x => {
        try {
            const value = evaluateMathExpression(text, { x, t: x });
            const n = Number(value);
            return Number.isFinite(n) ? n : NaN;
        } catch (e) { return NaN; }
    };
}
function compileCondition(cond, fallback) {
    const text = (cond || fallback || 'true').trim().replace(/\s+/g, '');
    const leftOps = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '==': (a, b) => a === b, '!=': (a, b) => a !== b };
    const range = text.match(/^(-?\d*\.?\d+)\s*(<=|>=|<|>)\s*x\s*(<=|>=|<|>)\s*(-?\d*\.?\d+)$/);
    if (range) {
        const a = +range[1], op1 = range[2], op2 = range[3], b = +range[4];
        return x => leftOps[op1](a, x) && leftOps[op2](x, b);
    }
    const simple = text.match(/^x\s*(<=|>=|<|>)\s*(-?\d*\.?\d+)$/);
    if (simple) {
        const op = simple[1], v = +simple[2];
        return x => leftOps[op](x, v);
    }
    const comp = text.match(/^(-?\d*\.?\d+)\s*(<=|>=|<|>)\s*x$/);
    if (comp) {
        const op = comp[2], v = +comp[1];
        return x => leftOps[op](v, x);
    }
    return () => false;
}
function piecewiseValue(x, text) {
    const rules = (text || '').split('|').map(part => part.trim()).filter(Boolean);
    for (const rule of rules) {
        const m = rule.match(/^(.+?)\s*:\s*(.+)$/);
        if (!m) continue;
        const cond = compileCondition(m[1], 'true');
        if (cond(x)) return compileExpression(m[2], 'x')(x);
    }
    return NaN;
}
function formulaText(o) {
    if (o.q) return 'y = ' + o.q.A + 'x² + ' + o.q.B + 'x + ' + o.q.C;
    const n = v => String(Math.round(v * 10) / 10);
    if (o.mode === 'param') return 'x(t) = ' + (el('gParamX').value || 'cos(t)') + ' ; y(t) = ' + (el('gParamY').value || 'sin(t)');
    if (o.mode === 'piecewise') return 'piecewise: ' + (el('gPiecewise').value || 'x');
    const signed = value => value < 0 ? ` − ${n(Math.abs(value))}` : value > 0 ? ` + ${n(value)}` : '';
    const inner = `${n(o.b)}x${signed(o.c)}`;
    const custom = (el('gCustom').value || 'x').replace(/\bx\b/g, `(${inner})`);
    const body = {
        linear: inner,
        quad: `(${inner})²`,
        cubic: `(${inner})³`,
        recip: `1/(${inner})`,
        recip2: `1/(${inner})²`,
        sqrt: `√(${inner})`,
        cbrt: `∛(${inner})`,
        abs: `|${inner}|`,
        exp: `e^(${inner})`,
        ln: `ln(${inner})`,
        const: '1',
        sin: `sin(${inner})`,
        cos: `cos(${inner})`,
        tan: `tan(${inner})`,
        custom
    }[o.kind];
    const scaled = o.a === 1 ? body : o.a === -1 ? `−${body}` : `${n(o.a)}·${body}`;
    return `y = ${scaled}${signed(o.d)}`;
}

// ================= GRAPHS tab =================
function currentOpts() {
    const o = {
        mode: el('gMode').value,
        kind: el('gPreset').value, deg: el('gDeg').value === 'deg',
        a: +el('gA').value, b: +el('gB').value, c: +el('gC').value, d: +el('gD').value,
        tanP: el('gTan').checked ? +el('gTanP').value : null,
        area: el('gArea').checked ? [+el('gA0').value, +el('gA1').value] : null,
        trap: el('gTrap').checked, transparent: el('gTrans').checked,
        derivative: el('gDerivative').checked
    };
    if (o.mode === 'param') {
        o.param = { x: el('gParamX').value || 'cos(t)', y: el('gParamY').value || 'sin(t)', tMin: +el('gParamTMin').value || 0, tMax: +el('gParamTMax').value || 2 * Math.PI };
    }
    if (o.mode === 'piecewise') {
        o.piecewise = el('gPiecewise').value || 'x';
    }
    if (el('gSec').checked) {
        o.sec = { kind: el('gPreset2').value, deg: o.deg, a: +el('gA2').value, b: +el('gB2').value, c: +el('gC2').value, d: +el('gD2').value };
    }
    return o;
}
function refreshGraph() {
    const o = currentOpts();
    o.transparent = false;
    el('paramRow').classList.toggle('hidden', o.mode !== 'param');
    el('piecewiseRow').classList.toggle('hidden', o.mode !== 'piecewise');
    el('customRow').classList.toggle('hidden', !(el('gPreset').value === 'custom'));
    el('sec2row').classList.toggle('hidden', !el('gSec').checked);
    el('sec2row2').classList.toggle('hidden', !el('gSec').checked);
    drawPlot(el('gPreview').getContext('2d'), el('gPreview').width, el('gPreview').height, o);
    let info = formulaText(o);
    if (o.sec) info += '\nred: ' + formulaText(o.sec);
    if (o.tanP != null) info += '\ngradient at x=' + o.tanP + '  →  ' + round2(numGrad(o, o.tanP));
    if (o.area) info += '\narea ' + o.area[0] + ' → ' + o.area[1] + '  ≈  ' + round2(numArea(o, o.area[0], o.area[1])) + (o.trap ? '  (8 trapeziums shown)' : '');
    el('gInfo').textContent = info;
}
['gPreset', 'gMode', 'gDeg', 'gA', 'gB', 'gC', 'gD', 'gCustom', 'gTan', 'gTanP', 'gArea', 'gA0', 'gA1', 'gTrap', 'gTrans', 'gSec', 'gPreset2', 'gA2', 'gB2', 'gC2', 'gD2', 'gParamX', 'gParamY', 'gParamTMin', 'gParamTMax', 'gPiecewise', 'gDerivative'].forEach(id => {
    el(id).addEventListener('input', refreshGraph);
    el(id).addEventListener('change', refreshGraph);
});
el('gInsert').onclick = () => {
    const o = currentOpts();
    o.title = formulaText(o);
    const cnv = document.createElement('canvas'); cnv.width = 900; cnv.height = 600;
    drawPlot(cnv.getContext('2d'), 900, 600, o);
    BF.insertCanvas(cnv, { kind: 'graph', payload: { graphOptions: o } });
};
el('gEquation').onclick = () => {
    const graphOptions = currentOpts();
    BF.insertEquation(formulaText(graphOptions), {
        expression: graphOptions.kind === 'custom' ? el('gCustom').value : null,
        graphOptions
    });
};
el('gTable').onclick = () => {
    const o = currentOpts();
    const f = makeF(o);
    const xs = [];
    if (o.deg) { for (let x = 0; x <= 360; x += 45) xs.push(x); }
    else { for (let x = -5; x <= 5; x++) xs.push(x); }
    const cols = xs.length + 1;
    const W = 110 * cols, H = 140;
    const cnv = document.createElement('canvas'); cnv.width = W; cnv.height = H;
    const ctx = cnv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.beginPath();
    ctx.moveTo(1, 50); ctx.lineTo(W - 1, 50);
    ctx.moveTo(1, 100); ctx.lineTo(W - 1, 100);
    for (let i = 0; i <= cols; i++) { ctx.moveTo(1 + i * 110, 1); ctx.lineTo(1 + i * 110, H - 1); }
    ctx.stroke();
    ctx.fillStyle = '#333'; ctx.font = 'bold 24px sans-serif';
    ctx.fillText('x', 45, 38); ctx.fillText('y', 45, 88);
    xs.forEach((x, i) => {
        const cx0 = 110 * (i + 1);
        ctx.fillText(String(x), cx0 + 40, 38);
        const y = f(x);
        ctx.fillText(isFinite(y) ? String(round2(y)) : '–', cx0 + 30, 88);
    });
    BF.insertCanvas(cnv, {
        kind: 'data-table',
        payload: {
            pairs: xs.map(x => [x, f(x)]).filter(pair => isFinite(pair[1])),
            values: xs.map(x => f(x)).filter(isFinite),
            recommendedChart: 'scatter',
            source: formulaText(o)
        }
    });
};

// ================= ALGEBRA tab =================
el('qSolve').onclick = () => {
    const A = +el('qA').value, B = +el('qB').value, C = +el('qC').value;
    if (!A) { el('qResult').textContent = 'A must not be 0 (that is a straight line).'; return; }
    const D = B * B - 4 * A * C;
    let roots;
    if (D > 0) roots = [(-B + Math.sqrt(D)) / (2 * A), (-B - Math.sqrt(D)) / (2 * A)];
    else if (D === 0) roots = [-B / (2 * A)];
    else roots = [];
    el('qResult').textContent =
        'discriminant = ' + round2(D) +
        '\nroots: ' + (roots.length ? roots.map(round2).join(', ') : (round2(-B / (2 * A)) + ' ± ' + round2(Math.sqrt(-D) / (2 * A)) + 'i (complex)')) +
        '\nvertex: (' + round2(-B / (2 * A)) + ', ' + round2(C - B * B / (4 * A)) + ')';
};
el('qInsert').onclick = () => {
    const A = +el('qA').value, B = +el('qB').value, C = +el('qC').value;
    const D = B * B - 4 * A * C;
    const roots = D >= 0 ? [(-B + Math.sqrt(D)) / (2 * A), (-B - Math.sqrt(D)) / (2 * A)] : [];
    const o = { q: { A: A, B: B, C: C }, roots: roots, transparent: false, title: 'y = ' + A + 'x² + ' + B + 'x + ' + C };
    const cnv = document.createElement('canvas'); cnv.width = 900; cnv.height = 600;
    drawPlot(cnv.getContext('2d'), 900, 600, o);
    BF.insertCanvas(cnv, { kind: 'graph', payload: { equation: o.title } });
};
el('sSolve').onclick = () => {
    const a1 = +el('sA1').value, b1 = +el('sB1').value, c1 = +el('sC1').value;
    const a2 = +el('sA2').value, b2 = +el('sB2').value, c2 = +el('sC2').value;
    const det = a1 * b2 - a2 * b1;
    if (!det) { el('sResult').textContent = 'No unique solution (lines parallel or identical).'; return; }
    const x = (c1 * b2 - c2 * b1) / det, y = (a1 * c2 - a2 * c1) / det;
    el('sResult').textContent = a1 + 'x + ' + b1 + 'y = ' + c1 + '\n' + a2 + 'x + ' + b2 + 'y = ' + c2 + '\n→ x = ' + round2(x) + ',  y = ' + round2(y);
};
// ================= STATS tab =================
let lastStat = null;
function parseData() {
    const lines = el('stData').value.split(/[\n;]+/).map(s => s.trim()).filter(Boolean);
    const pairs = [], vals = [];
    lines.forEach(l => {
        if (l.includes(',')) { const p = l.split(',').map(parseFloat); if (isFinite(p[0]) && isFinite(p[1])) pairs.push(p); }
        else { const v = parseFloat(l); if (isFinite(v)) vals.push(v); }
    });
    return { pairs: pairs, vals: pairs.length ? pairs.map(p => p[1]) : vals };
}
function statsText(v) {
    const n = v.length;
    if (!n) return 'No numbers yet.';
    const mean = v.reduce((s, x) => s + x, 0) / n;
    const sorted = v.slice().sort((a, b) => a - b);
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const freq = {}; v.forEach(x => freq[x] = (freq[x] || 0) + 1);
    const mx = Math.max.apply(null, Object.values(freq));
    const mode = mx === 1 ? '–' : Object.keys(freq).filter(k => freq[k] === mx).join(', ');
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) * (x - mean), 0) / n);
    return 'n=' + n + '  mean=' + round2(mean) + '  median=' + round2(median) + '\nmode=' + mode + '  range=' + round2(sorted[n - 1] - sorted[0]) + '  σ=' + round2(sd);
}
function dataTableCanvas(data) {
    const rows = (data.pairs.length ? data.pairs : data.vals.map((value, index) => [index + 1, value])).slice(0, 24);
    const W = 620, rowHeight = 44, H = rowHeight * (rows.length + 1) + 2;
    const cnv = document.createElement('canvas');
    cnv.width = W;
    cnv.height = H;
    const ctx = cnv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#315ee8';
    ctx.fillRect(0, 0, W, rowHeight);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 18px sans-serif';
    ctx.fillText(data.pairs.length ? 'x' : 'Observation', 42, 29);
    ctx.fillText(data.pairs.length ? 'y' : 'Value', W / 2 + 42, 29);
    rows.forEach((row, index) => {
        const y = rowHeight * (index + 1);
        ctx.fillStyle = index % 2 ? '#f8fafc' : '#eef2ff';
        ctx.fillRect(0, y, W, rowHeight);
        ctx.fillStyle = '#172554';
        ctx.font = '17px sans-serif';
        ctx.fillText(String(round2(row[0])), 42, y + 29);
        ctx.fillText(String(round2(row[1])), W / 2 + 42, y + 29);
    });
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    for (let row = 1; row <= rows.length; row++) {
        ctx.moveTo(0, row * rowHeight);
        ctx.lineTo(W, row * rowHeight);
    }
    ctx.stroke();
    return cnv;
}
function histData(vals) {
    const n = vals.length;
    const k = Math.max(4, Math.ceil(Math.log2(n) + 1));
    const mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    const w = (mx - mn) / k || 1;
    const counts = new Array(k).fill(0);
    vals.forEach(v => counts[Math.min(k - 1, Math.floor((v - mn) / w))]++);
    return { labels: counts.map((c, i) => round2(mn + w * i) + '–' + round2(mn + w * (i + 1))), values: counts };
}
const PIE_COLORS = ['#4363d8', '#e6194b', '#3cb44b', '#f58e26', '#911eb4', '#008080', '#f032e6', '#bc7400'];
function drawChart(ctx, W, H, type, vals, pairs, fit) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    if (type === 'pie') {
        const total = vals.reduce((s, x) => s + Math.abs(x), 0) || 1;
        let a0 = -Math.PI / 2;
        const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 30;
        vals.forEach((v, i) => {
            const a1 = a0 + Math.abs(v) / total * 2 * Math.PI;
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath();
            ctx.fillStyle = PIE_COLORS[i % 8]; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            const mid = (a0 + a1) / 2;
            ctx.fillStyle = '#333'; ctx.font = Math.round(11 * W / 320) + 'px sans-serif';
            ctx.fillText(Math.round(Math.abs(v) / total * 100) + '%', cx + Math.cos(mid) * R * 0.7 - 8, cy + Math.sin(mid) * R * 0.7 + 4);
            a0 = a1;
        });
        return;
    }
    let data, labels = null;
    if (type === 'hist') { const h = histData(vals); labels = h.labels; data = h.values.map((v, i) => [i, v]); }
    else if (type === 'scatter') data = pairs;
    else data = vals.map((v, i) => [i, v]);
    if (!data.length) return;
    const xs = data.map(p => p[0]), ys = data.map(p => p[1]);
    let xMin = Math.min.apply(null, xs.concat([0])), xMax = Math.max.apply(null, xs);
    let yMin = Math.min.apply(null, ys.concat([0])), yMax = Math.max.apply(null, ys);
    if (xMax === xMin) xMax = xMin + 1;
    if (yMax === yMin) yMax = yMin + 1;
    const P = 40;
    const X = x => P + (x - xMin) / (xMax - xMin) * (W - 2 * P);
    const Y = y => H - P - (y - yMin) / (yMax - yMin) * (H - 2 * P);
    ctx.strokeStyle ='#999'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(P, H - P); ctx.lineTo(W - P, H - P); ctx.moveTo(P, H - P); ctx.lineTo(P, P); ctx.stroke();
    const S = W / 320;
    if (type === 'bar' || type === 'hist') {
        const bw = (W - 2 * P) / data.length * 0.7;
        data.forEach((p, i) => {
            ctx.fillStyle = '#4363d8';
            ctx.fillRect(X(p[0]) - bw / 2, Y(p[1]), bw, Y(0) - Y(p[1]));
            if (labels) { ctx.fillStyle = '#666'; ctx.font = Math.round(9 * S) + 'px sans-serif'; ctx.fillText(labels[i], X(p[0]) - 18 * S, H - P + 14 * S); }
        });
    } else {
        if (type === 'line') {
            ctx.strokeStyle ='#4363d8'; ctx.lineWidth = 2 * S;
            ctx.beginPath();
            data.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
            ctx.stroke();
        }
        ctx.fillStyle = type === 'scatter' ? '#e6194b' : '#4363d8';
        data.forEach(p => { ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 3.5 * S, 0, 7); ctx.fill(); });
        if (type === 'scatter' && fit && data.length > 1) {
            const n = data.length;
            const sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
            const sxy = data.reduce((a, p) => a + p[0] * p[1], 0), sxx = xs.reduce((a, b) => a + b * b, 0);
            const m = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), c0 = (sy - m * sx) / n;
            ctx.strokeStyle = '#3cb44b'; ctx.lineWidth = 2 * S;
            ctx.beginPath(); ctx.moveTo(X(xMin), Y(m * xMin + c0)); ctx.lineTo(X(xMax), Y(m * xMax + c0)); ctx.stroke();
            ctx.fillStyle = '#3cb44b'; ctx.font = Math.round(11 * S) + 'px sans-serif';
            ctx.fillText('y = ' + round2(m) + 'x + ' + round2(c0), P + 6 * S, P + 12 * S);
        }
    }
}
el('stCalc').onclick = () => {
    const d = parseData();
    el('stResult').textContent = statsText(d.vals);
    const type = el('stType').value;
    drawChart(el('stPreview').getContext('2d'), 320, 200, type, d.vals, d.pairs, true);
    lastStat = d;
};
el('stTable').onclick = () => {
    const data = parseData();
    if (!data.vals.length) {
        el('stResult').textContent = 'Add at least one valid number before inserting a table.';
        return;
    }
    BF.insertCanvas(dataTableCanvas(data), {
        kind: 'data-table',
        payload: {
            pairs: data.pairs,
            values: data.vals,
            recommendedChart: data.pairs.length ? 'scatter' : (data.vals.length >= 8 ? 'hist' : 'bar')
        }
    });
};
el('stInsert').onclick = () => {
    const d = lastStat || parseData();
    const type = el('stType').value;
    const cnv = document.createElement('canvas'); cnv.width = 900; cnv.height = 600;
    drawChart(cnv.getContext('2d'), 900, 600, type, d.vals, d.pairs, true);
    const ctx = cnv.getContext('2d');
    ctx.fillStyle = '#333'; ctx.font = 'bold 12px sans-serif';
    ctx.fillText(statsText(d.vals).replace(/\n/g, '   '), 10, 590);
    BF.insertCanvas(cnv, { kind: 'chart', payload: { type, values: d.vals, pairs: d.pairs } });
};

// ================= CIRCLES tab =================
function circleOptions() {
    return {
        radius: Math.max(0.1, +el('cRadius').value || 1),
        angle: clamp(+el('cAngle').value || 90, 1, 360),
        diameter: el('cDiameter').checked,
        sector: el('cSector').checked,
        tangent: el('cTangent').checked
    };
}
function drawCircleVisualization(ctx, W, H, options) {
    const scale = W / 320;
    const cx = W * 0.48, cy = H * 0.48;
    const radiusPx = Math.min(W, H) * 0.31;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    if (options.sector) {
        const end = -Math.PI / 2 + options.angle * Math.PI / 180;
        const gradient = ctx.createRadialGradient(cx, cy, 4, cx, cy, radiusPx);
        gradient.addColorStop(0, 'rgba(79,124,255,.38)');
        gradient.addColorStop(1, 'rgba(119,88,239,.14)');
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radiusPx, -Math.PI / 2, end);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = '#7758ef';
        ctx.lineWidth = 2 * scale;
        ctx.stroke();
        const labelAngle = -Math.PI / 2 + options.angle * Math.PI / 360;
        ctx.fillStyle = '#5b42c4';
        ctx.font = `600 ${12 * scale}px sans-serif`;
        ctx.fillText(`${round2(options.angle)}°`, cx + Math.cos(labelAngle) * radiusPx * .48 - 10 * scale, cy + Math.sin(labelAngle) * radiusPx * .48 + 4 * scale);
    }

    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.strokeStyle = '#315ee8';
    ctx.lineWidth = 3 * scale;
    ctx.stroke();
    ctx.fillStyle = '#172554';
    ctx.beginPath();
    ctx.arc(cx, cy, 4 * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#e24b62';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + radiusPx, cy);
    ctx.stroke();
    ctx.fillStyle = '#b4233c';
    ctx.font = `600 ${11 * scale}px sans-serif`;
    ctx.fillText(`r = ${round2(options.radius)}`, cx + radiusPx * .35, cy - 8 * scale);

    if (options.diameter) {
        ctx.setLineDash([6 * scale, 4 * scale]);
        ctx.strokeStyle = '#21a179';
        ctx.beginPath();
        ctx.moveTo(cx - radiusPx, cy);
        ctx.lineTo(cx + radiusPx, cy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#147a5c';
        ctx.fillText(`d = ${round2(options.radius * 2)}`, cx - 30 * scale, cy + 18 * scale);
    }
    if (options.tangent) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2 * scale;
        ctx.beginPath();
        ctx.moveTo(cx + radiusPx, cy - radiusPx * .72);
        ctx.lineTo(cx + radiusPx, cy + radiusPx * .72);
        ctx.stroke();
        ctx.fillStyle = '#9a6200';
        ctx.fillText('tangent', cx + radiusPx + 7 * scale, cy - radiusPx * .52);
    }
}
function refreshCircle() {
    const options = circleOptions();
    const preview = el('cPreview');
    drawCircleVisualization(preview.getContext('2d'), preview.width, preview.height, options);
    const circumference = 2 * Math.PI * options.radius;
    const area = Math.PI * options.radius * options.radius;
    const sectorArea = area * options.angle / 360;
    el('cInfo').textContent = `diameter = ${round2(options.radius * 2)}   circumference ≈ ${round2(circumference)}\narea ≈ ${round2(area)}   sector area ≈ ${round2(sectorArea)}`;
}
['cRadius', 'cAngle', 'cDiameter', 'cSector', 'cTangent'].forEach(id => {
    el(id).addEventListener('input', refreshCircle);
    el(id).addEventListener('change', refreshCircle);
});
el('cInsert').onclick = () => {
    const options = circleOptions();
    const cnv = document.createElement('canvas');
    cnv.width = 800;
    cnv.height = 600;
    drawCircleVisualization(cnv.getContext('2d'), cnv.width, cnv.height, options);
    BF.insertCanvas(cnv, { kind: 'circle-visualization', payload: options });
};

window.addEventListener('boardflow:math-action', event => {
    const suggestion = event.detail;
    if (suggestion.kind === 'statistics') {
        const rows = suggestion.pairs?.length ? suggestion.pairs.map(pair => pair.join(',')) : suggestion.values || [];
        el('stData').value = rows.join('\n');
        el('stType').value = suggestion.recommendedChart || (suggestion.pairs?.length ? 'scatter' : 'bar');
        openPanel('mTabStat');
        el('stCalc').click();
        return;
    }
    if (suggestion.kind === 'equation') {
        openPanel('mTabGraph');
        if (suggestion.graphOptions) {
            const options = suggestion.graphOptions;
            el('gMode').value = options.mode || 'y';
            el('gPreset').value = options.kind || 'custom';
            if (options.kind === 'custom' && suggestion.expression) el('gCustom').value = suggestion.expression;
            ['A', 'B', 'C', 'D'].forEach(key => {
                const value = options[key.toLowerCase()];
                if (value != null) el(`g${key}`).value = value;
            });
        } else {
            el('gMode').value = 'y';
            el('gPreset').value = 'custom';
            el('gCustom').value = suggestion.expression;
        }
        refreshGraph();
    }
});

refreshGraph();
refreshCircle();
panel.dataset.ready = 'true';
}
})();
