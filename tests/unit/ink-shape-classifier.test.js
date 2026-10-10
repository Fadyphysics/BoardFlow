import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyNormalizedStroke } from '../../src/renderer/ink-shape-recognition.js';

function normalized(points) {
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const pathLength = points.slice(1).reduce((length, point, index) =>
        length + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const width = Math.max(...xs) - left;
    const height = Math.max(...ys) - top;
    return { points, pathLength, bbox: { left, top, width, height } };
}

test('recognizes a closed triangle and rectangle as one confident shape', () => {
    const triangle = classifyNormalizedStroke(normalized([
        { x: 20, y: 100 }, { x: 100, y: 15 }, { x: 180, y: 100 }, { x: 20, y: 100 }
    ]));
    const rectangle = classifyNormalizedStroke(normalized([
        { x: 20, y: 20 }, { x: 180, y: 20 }, { x: 180, y: 100 },
        { x: 20, y: 100 }, { x: 20, y: 20 }
    ]));

    assert.equal(triangle.shapeType, 'triangle');
    assert.ok(triangle.confidence >= 0.75);
    assert.equal(rectangle.shapeType, 'rectangle');
    assert.ok(rectangle.confidence >= 0.75);
});

test('keeps a straight stroke as a line and rejects an angular open scribble', () => {
    const line = classifyNormalizedStroke(normalized([
        { x: 30, y: 50 }, { x: 70, y: 51 }, { x: 110, y: 50 }, { x: 150, y: 49 }
    ]));
    const scribble = classifyNormalizedStroke(normalized([
        { x: 10, y: 10 }, { x: 100, y: 100 }, { x: 10, y: 100 }, { x: 100, y: 10 }
    ]));

    assert.equal(line.shapeType, 'line');
    assert.equal(scribble.shapeType, 'none');
});

test('does not mistake a sharp closed star for a circle', () => {
    const star = Array.from({ length: 11 }, (_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / 10;
        const radius = index % 2 === 0 ? 90 : 36;
        return { x: 100 + Math.cos(angle) * radius, y: 100 + Math.sin(angle) * radius };
    });
    const result = classifyNormalizedStroke(normalized(star));

    assert.equal(result.shapeType, 'none');
});

test('distinguishes sharp alternating zigzags from smooth waves', () => {
    const zigzag = classifyNormalizedStroke(normalized([
        { x: 10, y: 60 }, { x: 40, y: 15 }, { x: 75, y: 62 },
        { x: 110, y: 14 }, { x: 145, y: 61 }, { x: 180, y: 16 }
    ]));
    const wave = classifyNormalizedStroke(normalized(Array.from({ length: 41 }, (_, index) => ({
        x: 10 + index * 5,
        y: 60 + Math.sin(index / 40 * Math.PI * 6) * 28
    }))));

    assert.equal(zigzag.shapeType, 'zigzag');
    assert.equal(wave.shapeType, 'wave');
});
