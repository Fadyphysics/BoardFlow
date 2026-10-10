import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyNormalizedStroke } from '../../src/renderer/ink-shape-recognition.js';
import { textToLatex } from '../../src/renderer/handwriting-recognition.js';

function normalized(points) {
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const pathLength = points.slice(1).reduce((length, point, index) =>
        length + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return {
        points,
        pathLength,
        bbox: { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
    };
}

test('recognizes a hand-drawn closed rectangle', () => {
    const result = classifyNormalizedStroke(normalized([
        { x: 10, y: 10 }, { x: 110, y: 12 }, { x: 108, y: 70 },
        { x: 12, y: 68 }, { x: 10, y: 10 }
    ]));
    assert.equal(result.shapeType, 'rectangle');
});

test('recognizes a straight stroke as an editable line', () => {
    const result = classifyNormalizedStroke(normalized([
        { x: 10, y: 20 }, { x: 50, y: 21 }, { x: 100, y: 20 }
    ]));
    assert.equal(result.shapeType, 'line');
});

test('converts common recognized math characters to LaTeX', () => {
    assert.equal(textToLatex('x² + a/b ≥ π'), 'x^{2} + \\frac{a}{b} \\ge  \\pi ');
});
