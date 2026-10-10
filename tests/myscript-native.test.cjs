const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { recognizeMath, recognizeText } = require('../scripts/myscript-bridge.cjs');
const root = path.resolve(__dirname, '..');
const line = (x1, y1, x2, y2) => Array.from({ length: 21 }, (_, i) => ({ x: x1 + (x2-x1)*i/20, y: y1 + (y2-y1)*i/20 }));
const native = { skip: process.env.BOARDFLOW_TEST_MYSCRIPT !== '1' };
test.after(() => require('../scripts/myscript-bridge.cjs').closeRecognitionWorkers());
test('native MyScript text recognizes a handwritten H', native, async () => {
    const result = await recognizeText([line(10,10,10,60), line(10,35,50,35), line(50,10,50,60)], root);
    assert.equal(result.error, undefined);
    assert.equal(result.text, 'H');
    assert.equal(result.kind, 'text');
});
test('native MyScript text recognizes a handwritten word', native, async () => {
    const strokes = [line(10,10,10,60), line(10,35,50,35), line(50,10,50,60),
        line(80,10,80,60), line(80,10,115,10), line(80,35,110,35), line(80,60,115,60),
        [...line(140,10,140,60), ...line(140,60,175,60)],
        [...line(200,10,200,60), ...line(200,60,235,60)],
        Array.from({length:65}, (_, i) => ({x:270+20*Math.cos(i*Math.PI/32), y:35+25*Math.sin(i*Math.PI/32)}))];
    const result = await recognizeText(strokes, root);
    assert.equal(result.error, undefined);
    assert.equal(result.text.toUpperCase(), 'HELLO');
    const mixed = await require('../scripts/myscript-bridge.cjs').recognizeSmart(strokes, root);
    assert.equal(mixed.entries.length, 1);
    assert.equal(mixed.entries[0].result.kind, 'text');
    assert.equal(mixed.entries[0].result.text.toUpperCase(), 'HELLO');
});
test('native MyScript recognizes crossed strokes as X', native, async () => {
    const result = await recognizeMath([line(10,10,60,60), line(60,10,10,60)], root);
    assert.equal(result.error, undefined);
    assert.match(result.latex, /^[xX]$/);
});
test('native MyScript recognizes a stacked fraction', native, async () => {
    const result = await recognizeMath([line(40,10,40,45), line(10,60,75,60), line(40,75,40,110)], root);
    assert.equal(result.error, undefined);
    assert.match(result.latex, /\\frac\s*\{1\}\s*\{1\}/);
});
test('native Smart Ink classifies a fraction without an equation-mode hint', native, async () => {
    const { recognizeSmart } = require('../scripts/myscript-bridge.cjs');
    const result = await recognizeSmart([line(40,10,40,45),line(10,60,75,60),line(40,75,40,110)],root);
    assert.equal(result.error,undefined);
    assert.equal(result.entries.length,1);
    assert.deepEqual(result.entries[0].indices,[0,1,2]);
    assert.equal(result.entries[0].result.kind,'math');
    assert.match(result.entries[0].result.latex,/\\frac/);
});
test('native MyScript recognizes a superscript', native, async () => {
    const two = [[60,20],[64,14],[72,12],[80,16],[80,22],[75,28],[61,40],[82,40]].map(([x,y]) => ({x,y}));
    const result = await recognizeMath([line(10,45,50,85), line(50,45,10,85), two], root);
    assert.equal(result.error, undefined);
    assert.match(result.latex, /[xX]\s*\^\s*\{?2/);
});
