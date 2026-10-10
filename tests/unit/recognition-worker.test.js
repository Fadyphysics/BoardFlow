import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createRecognitionWorker} from '../../scripts/recognition-worker.cjs';

test('worker reuses one process and serializes independent requests', async () => {
    let launches=0;
    const launch=()=>{
        launches++;
        const child=new EventEmitter(); child.stdin=new PassThrough(); child.stdout=new PassThrough();
        child.kill=()=>{child.stdin.destroy();child.stdout.destroy();};
        child.stdin.on('data',data=>queueMicrotask(()=>child.stdout.write(JSON.stringify({id:JSON.parse(data).id})+'\n')));
        return child;
    };
    const worker=createRecognitionWorker('unused',launch);
    try {
        assert.deepEqual(await Promise.all([worker.request({id:1}),worker.request({id:2})]),[{id:1},{id:2}]);
        assert.equal(launches,1);
    } finally {worker.close();}
});
test('worker rejects pending work on crash and can restart', async () => {
    let child;
    const worker=createRecognitionWorker('unused',()=>{
        child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();
        child.kill=()=>{child.stdin.destroy();child.stdout.destroy();};return child;
    });
    try {
        const first=worker.request({id:1});
        const rejected=assert.rejects(first,/unexpectedly/);
        child.emit('exit',1);await rejected;
        const second=worker.request({id:2});child.stdout.write('{"ok":true}\n');
        assert.deepEqual(await second,{ok:true});
    } finally {worker.close();}
});
