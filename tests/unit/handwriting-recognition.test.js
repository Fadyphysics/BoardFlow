import assert from 'node:assert/strict';
import test from 'node:test';
import { recognizeHandwritingFromStrokes } from '../../src/renderer/handwriting-recognition.js';
import { canAutoConvert } from '../../src/renderer/recognition-input.js';

function stroke(points) {
    return {
        points,
        bbox: { left: 0, top: 0, width: 20, height: 30 },
        pathLength: 40
    };
}

test('native text recognition receives every point from a multi-stroke word', async () => {
    let request;
    const result = {
        text: 'H',
        alternatives: ['H', 'A'],
        engine: 'Windows Ink',
        kind: 'text',
        status: 'recognized',
        confidenceLevel: 'Strong'
    };
    const recognition = await recognizeHandwritingFromStrokes([
        stroke([{ x: 10, y: 10 }, { x: 10, y: 40 }]),
        stroke([{ x: 30, y: 10 }, { x: 30, y: 40 }])
    ], {
        recognizeInk: async value => {
            request = value;
            return result;
        }
    });

    assert.deepEqual(request, {
        strokes: [
            [{ x: 10, y: 10, t: 0 }, { x: 10, y: 40, t: 16 }],
            [{ x: 30, y: 10, t: 0 }, { x: 30, y: 40, t: 16 }]
        ],
        mode: 'writing',
        recognitionType: 'text',
        language: 'en-US'
    });
    assert.equal(recognition.text, 'H');
    assert.equal(canAutoConvert(recognition, 'writing'), true);
});

test('platform handwriting results without confidence can be auto-converted when writing is enabled', () => {
    assert.equal(canAutoConvert({
        text: 'Hello',
        kind: 'text',
        engine: 'Platform handwriting recognizer'
    }, 'writing'), true);
    assert.equal(canAutoConvert({
        text: 'Hello',
        kind: 'text',
        engine: 'TrOCR small (browser, local)'
    }, 'writing'), true);
});
