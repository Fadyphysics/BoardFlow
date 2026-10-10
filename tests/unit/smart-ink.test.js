import test from 'node:test';
import assert from 'node:assert/strict';
import { graphExpression } from '../../src/renderer/smart-graph.js';
import { mixedBlocks } from '../../scripts/mixed-ink.cjs';

test('graphable LaTeX supports fractions, powers, roots and safe functions', () => {
    assert.equal(graphExpression('y=\\frac{6}{x}').evaluate(2), 3);
    assert.equal(graphExpression('y=3-x^{2}').evaluate(2), -1);
    assert.equal(graphExpression('y=\\sqrt{x}').evaluate(9), 3);
    assert.equal(graphExpression('y=\\sin(x)').evaluate(0), 0);
    assert.equal(graphExpression('y=\\frac{1}{\\frac{2}{x}}').evaluate(4), 2);
    assert.ok(Number.isNaN(graphExpression('y=1/x').evaluate(0)));
    for (const value of ['x=2', 'y=import(x)', 'y=a=2', 'y=[1,2]', 'y=999!', 'y=x.foo', 'y=\\frac{1}{', 'y=range(1,10000)']) assert.equal(graphExpression(value), null, value);
});

test('uses native Interactive Ink item IDs when JIIX ranges are absent', () => {
    const jiix = { elements: [
        { type:'Text', items:[{type:'stroke',id:'a'},{type:'stroke',id:'b'}] },
        { type:'Math', expressions:[{items:[{type:'stroke',id:'b'},{type:'stroke',id:'c'}]}] }
    ] };
    assert.deepEqual(mixedBlocks(JSON.stringify(jiix),3,['a','b','c']),[
        {mode:'equations',indices:[1,2]}
    ]);
});
test('mixed content consumes only whole disjoint recognized stroke ranges', () => {
    const block = (type,from,to) => ({type,range:[{from:{stroke:from},to:{stroke:to}}]});
    assert.deepEqual(mixedBlocks(JSON.stringify({elements:[block('Text',0,2),block('Math',3,5),block('Drawing',6,6)]}),7),[
        {mode:'writing',indices:[0,1,2]}, {mode:'equations',indices:[3,4,5]}
    ]);
    assert.deepEqual(mixedBlocks(JSON.stringify({elements:[block('Text',0,3),block('Math',3,4)]}),5),[]);
    assert.deepEqual(mixedBlocks(JSON.stringify({elements:[block('Text',0,9)]}),5),[]);
    const partial=block('Math',0,1); partial.range[0].from.point=2;
    assert.deepEqual(mixedBlocks(JSON.stringify({elements:[partial]}),2),[]);
});
