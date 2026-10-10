// Fabric pencil paths contain Bezier control points, not recorded pen samples.
// Evaluate each curve before passing its shape to an ink recognizer.
export function sampleInkPath(path) {
    const points = [];
    let current = { x: 0, y: 0 }, start = current;
    for (const command of path || []) {
        const [type, ...v] = command;
        if (type === 'M' || type === 'L') {
            current = { x: v[0], y: v[1] };
            if (type === 'M') start = current;
            points.push(current);
        } else if (type === 'Q' || type === 'C') {
            const origin = current;
            const end = { x: v.at(-2), y: v.at(-1) };
            const length = Math.hypot(v[0] - origin.x, v[1] - origin.y) + Math.hypot(end.x - v[0], end.y - v[1]);
            const steps = Math.min(64, Math.max(4, Math.ceil(length / 4)));
            for (let i = 1; i <= steps; i++) {
                const t = i / steps, u = 1 - t;
                points.push(type === 'Q' ? {
                    x: u*u*origin.x + 2*u*t*v[0] + t*t*end.x,
                    y: u*u*origin.y + 2*u*t*v[1] + t*t*end.y
                } : {
                    x: u*u*u*origin.x + 3*u*u*t*v[0] + 3*u*t*t*v[2] + t*t*t*end.x,
                    y: u*u*u*origin.y + 3*u*u*t*v[1] + 3*u*t*t*v[3] + t*t*t*end.y
                });
            }
            current = end;
        } else if (type === 'Z') {
            points.push(start);
            current = start;
        }
    }
    return points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
}

export function canAutoConvert(result, mode) {
    if (!result?.text || !/[\p{L}\p{N}]/u.test(result.text)) return false;
    if (result.error) return false;
    if (mode === 'writing' && result.kind === 'text'
        && result.engine === 'Platform handwriting recognizer' && result.text.trim()) return true;
    if (mode === 'writing' && result.kind === 'text'
        && result.engine === 'TrOCR small (browser, local)' && result.text.trim()) return true;
    // Native recognition supplies a math result, not a confidence score. Conversion is
    // user-enabled and remains undoable; do not mislabel this as high confidence.
    if (mode === 'equations' && result.kind === 'math' && result.engine === 'Native recognition'
        && result.status === 'recognized' && result.latex?.trim()) return true;
    if (mode === 'writing' && result.kind === 'text' && result.engine === 'Native recognition'
        && result.status === 'recognized') return true;
    const readableWindowsText = mode === 'writing' && result.kind === 'text' && result.confidenceLevel === 'Intermediate';
    const confident = readableWindowsText || result.confidenceLevel === 'Strong' || (Number.isFinite(result.confidence) && result.confidence >= 0.8);
    if (!confident) return false;
    // A text recognizer cannot interpret fraction/exponent layout as mathematics.
    return mode !== 'equations' || result.kind === 'math';
}

export function recognizedTextLines(entries) {
    const rows = [];
    for (const entry of [...entries].sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)) {
        const center = entry.box.top + entry.box.height / 2;
        const row = rows.find(r => Math.abs(r.center - center) <= Math.max(r.height, entry.box.height) * 0.45);
        if (row) row.entries.push(entry);
        else rows.push({ center, height: entry.box.height, entries: [entry] });
    }
    return rows.map(row => row.entries.sort((a, b) => a.box.left - b.box.left)
        .map(entry => entry.text.trim().replace(/\r\n?/g, '\n')).join(' ')).join('\n');
}
