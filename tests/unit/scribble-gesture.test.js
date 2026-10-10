import test from 'node:test';
import assert from 'node:assert/strict';
import { isScratchOut, denseScratchPoints, scratchPasses } from '../../src/renderer/scribble-gesture.js';

test('scratch-out requires repeated major-axis reversals, not a wave or circle', () => {
    const scratch = Array.from({length:9}, (_, i) => ({x:i%2?100:0,y:i*2}));
    assert.equal(isScratchOut(scratch),true);
    assert.equal(isScratchOut(scratch.map(p=>({x:p.y,y:p.x}))),true);
    assert.equal(isScratchOut(Array.from({length:100},(_,i)=>({x:i*2,y:Math.sin(i/5)*20}))),false);
    assert.equal(isScratchOut(Array.from({length:10},(_,i)=>({x:i*20,y:i%2?20:0}))),false);
    assert.equal(isScratchOut(Array.from({length:101},(_,i)=>({x:50*Math.cos(i*Math.PI/50),y:50*Math.sin(i*Math.PI/50)}))),false);
    assert.equal(isScratchOut(scratch.slice(0,4)),false);
    assert.equal(scratchPasses(denseScratchPoints(scratch,2),{left:30,top:0,width:20,height:20}),8);
});

test('short narrow scratches work even wholly inside a target, at different zooms', () => {
    const scratch = [0,20,0,20,0].map(x=>({x,y:10}));
    assert.equal(isScratchOut(scratch),true);
    assert.equal(isScratchOut(scratch.map(p=>({x:p.x/2,y:p.y/2})),2),true);
    assert.equal(scratchPasses(denseScratchPoints(scratch,1),{left:-10,top:0,width:40,height:30}),4);
    assert.equal(scratchPasses(denseScratchPoints(scratch,1),{left:30,top:0,width:10,height:30}),0);
    assert.equal(isScratchOut(scratch.slice(0,3)),false);
    assert.equal(isScratchOut([0,1,0,1,0].map(x=>({x,y:0}))),false);
});
