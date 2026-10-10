import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeMath, recognizeText } from '../../scripts/myscript-bridge.cjs';
import { recognizeHandwritingFromStrokes } from '../../src/renderer/handwriting-recognition.js';
import { canAutoConvert } from '../../src/renderer/recognition-input.js';

test('recognized native math can be converted, but failures cannot', () => {
    const result = { text: 'x²', latex: 'x^{2}', kind: 'math', engine: 'Native recognition', status: 'recognized' };
    assert.equal(canAutoConvert(result, 'equations'), true);
    assert.equal(canAutoConvert(result, 'writing'), false);
    assert.equal(canAutoConvert({ ...result, error: 'failed' }, 'equations'), false);
    assert.equal(canAutoConvert({ ...result, status: 'failed' }, 'equations'), false);
});

test('recognized native text can be converted without accepting failed results', () => {
    const result = { text: 'Hello', kind: 'text', engine: 'Native recognition', status: 'recognized' };
    assert.equal(canAutoConvert(result, 'writing'), true);
    assert.equal(canAutoConvert(result, 'equations'), false);
    assert.equal(canAutoConvert({ ...result, error: 'failed' }, 'writing'), false);
});

test('empty native recognition results stay unconverted', async () => {
    const error = { text: '', error: 'No model' };
    const stroke = { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };
    assert.equal(await recognizeHandwritingFromStrokes(
        [stroke],
        { recognizeInk: async () => error }
    ), null);
});

test('unused MyScript bridge reports that its native recognizer is unavailable', async () => {
    for (const recognize of [recognizeMath, recognizeText]) {
        const result = await recognize([], '.');
        assert.equal(result.text, '');
        assert.match(result.error, /coming soon/i);
    }
});
