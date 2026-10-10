import assert from 'node:assert/strict';
import test from 'node:test';
import { recognizeInkEquation } from '../../src/renderer/equation-recognition.js';

function stroke(left, top, width, height, start, end) {
    const points = [
        { x: left + start[0], y: top + start[1] },
        { x: left + end[0], y: top + end[1] }
    ];
    return {
        points,
        bbox: { left, top, width, height }
    };
}

test('recognizes two parallel horizontal strokes as equals', () => {
    const result = recognizeInkEquation([
        stroke(10, 10, 44, 2, [0, 0], [44, 0]),
        stroke(11, 22, 42, 2, [0, 0], [42, 0])
    ]);
    assert.equal(result.text, '=');
    assert.ok(result.confidence > 0.85);
});

test('recognizes crossing horizontal and vertical strokes as plus', () => {
    const result = recognizeInkEquation([
        stroke(10, 28, 44, 2, [0, 0], [44, 0]),
        stroke(31, 10, 2, 40, [0, 0], [0, 40])
    ]);
    assert.equal(result.text, '+');
});

test('ignores non-sketch objects', () => {
    assert.deepEqual(recognizeInkEquation([{ isSketch: false }]), { text: '', confidence: 0, symbols: [] });
});
