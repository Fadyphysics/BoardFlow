import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleInkPath, canAutoConvert, recognizedTextLines } from '../../src/renderer/recognition-input.js';

test('recognized words are ordered into lines despite handwriting baseline differences', () => {
    assert.equal(recognizedTextLines([
        {text:'wife',box:{left:100,top:200,width:80,height:40}},
        {text:'my',box:{left:250,top:106,width:50,height:40}},
        {text:'I love',box:{left:100,top:100,width:100,height:40}}
    ]), 'I love my\nwife');
});

test('recognition samples the drawn curve rather than its off-curve control points', () => {
    const points = sampleInkPath([['M', 0, 0], ['Q', 50, 100, 100, 0]]);
    assert.ok(points.length > 5);
    assert.ok(Math.max(...points.map(p => p.y)) <= 50);
    assert.deepEqual(points.at(-1), { x: 100, y: 0 });
});
test('automatic recognition rejects missing confidence and punctuation guesses from the recordings', () => {
    for (const text of ['=', '.', ',', '-', 'Hello']) {
        assert.equal(canAutoConvert({ text }, 'writing'), false);
    }
    for (const text of ['=', '.', ',', '-']) {
        assert.equal(canAutoConvert({ text, confidence: 0.99 }, 'equations'), false);
    }
    assert.equal(canAutoConvert({ text: 'Hello', confidence: 0.5 }, 'writing'), false);
    assert.equal(canAutoConvert({ text: 'Hello', confidence: 0.99 }, 'writing'), true);
    assert.equal(canAutoConvert({ text: 'H', kind: 'text', confidenceLevel: 'Intermediate' }, 'writing'), true);
    assert.equal(canAutoConvert({ text: 'H', kind: 'text', confidenceLevel: 'Poor' }, 'writing'), false);
});
test('a general text model or symbol fallback cannot authorize automatic equation replacement', () => {
    assert.equal(canAutoConvert({text: 'y = x', confidence: 0.99}, 'equations'), false);
    assert.equal(canAutoConvert({text: 'y = x', confidence: 0.99, kind: 'math'}, 'equations'), true);
});
