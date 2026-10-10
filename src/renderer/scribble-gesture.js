// Scratch-out reverses along its major axis; normal waves progress along it.
export function isScratchOut(points, zoom = 1) {
    if (points.length < 5) return false;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
    const span = Math.max(width, height);
    if (span * zoom < 8) return false;
    const axis = width >= height ? 'x' : 'y';
    let pivot = points[0][axis], direction = 0, turns = 0, length = 0;
    for (let i = 1; i < points.length; i++) {
        length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
        const delta = points[i][axis] - pivot;
        if (direction && delta * direction > 0) pivot = points[i][axis];
        else if (Math.abs(delta) >= span * 0.35) {
            if (direction) turns++;
            direction = Math.sign(delta);
            pivot = points[i][axis];
        }
    }
    return turns >= 3 && length >= Math.hypot(width, height) * 3;
}

export function scratchPasses(points, box) {
    if (!points.length || box.width <= 0 || box.height <= 0) return 0;
    // Count passes through the centre of the overlap. A scratch need not leave
    // a large letter's bounds to count as repeated crossing.
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
    const horizontal = x2 - x1 >= y2 - y1;
    const start = Math.max(horizontal ? x1 : y1, horizontal ? box.left : box.top);
    const end = Math.min(horizontal ? x2 : y2, horizontal ? box.left + box.width : box.top + box.height);
    if (end <= start) return 0;
    box = horizontal ? { ...box, left: start + (end - start) * .4, width: (end - start) * .2 }
        : { ...box, top: start + (end - start) * .4, height: (end - start) * .2 };
    let passes = 0, inside = false;
    for (const p of points) {
        const hit = p.x >= box.left && p.x <= box.left + box.width && p.y >= box.top && p.y <= box.top + box.height;
        if (hit && !inside) passes++;
        inside = hit;
    }
    return passes;
}

export function denseScratchPoints(points, step) {
    const result = points.slice(0, 1);
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
        for (let j = 1; j <= count; j++) result.push({ x: a.x + (b.x - a.x) * j / count, y: a.y + (b.y - a.y) * j / count });
    }
    return result;
}
