import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryManager } from '../../src/renderer/modules/history-manager.js';

function createCanvas() {
    const canvas = {
        objects: [],
        getObjects() {
            return this.objects;
        },
        add(object) {
            this.objects.push(object);
        },
        remove(object) {
            this.objects = this.objects.filter(candidate => candidate !== object);
        },
        discardActiveObject() {},
        requestRenderAll() {}
    };
    return canvas;
}

function createHistory(canvas, onCheckpoint = () => {}) {
    const elements = new Map();
    const byId = id => {
        if (!elements.has(id)) elements.set(id, { disabled: false, classList: { toggle() {} } });
        return elements.get(id);
    };
    return createHistoryManager({
        canvas,
        fabric: { util: { enlivenObjects: async objects => objects } },
        customObjectProperties: ['name'],
        currentFileVisualState: () => null,
        restoreCurrentFileVisualState: async () => {},
        layerCanEdit: () => true,
        scheduleCheckpoint: onCheckpoint,
        attachApexControl: () => {},
        attachArrowControls: () => {},
        rebuildEraseMask: () => {},
        applyInteractivity: () => {},
        applyFileErasability: () => {},
        cancelInkRecognition: () => {},
        byId
    });
}

test('history snapshots exclude files and transient objects', () => {
    const canvas = createCanvas();
    canvas.add({ isFile: true, toObject: () => ({ type: 'image' }) });
    canvas.add({ boardflowTransient: true, toObject: () => ({ type: 'path' }) });
    canvas.add({ name: 'saved ink', toObject: () => ({ type: 'path', name: 'saved ink' }) });
    const history = createHistory(canvas);

    assert.deepEqual(JSON.parse(history.annotationsJSON()), [{ type: 'path', name: 'saved ink' }]);
});

test('undo and redo restore annotation snapshots and schedule checkpoints', async () => {
    const canvas = createCanvas();
    let checkpoints = 0;
    const history = createHistory(canvas, () => { checkpoints++; });
    history.resetHistory();
    canvas.add({ name: 'ink', toObject: () => ({ type: 'path', name: 'ink' }) });
    history.pushSnapshotNow();

    history.undo();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(canvas.getObjects(), []);

    history.redo();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(canvas.getObjects(), [{ type: 'path', name: 'ink' }]);
    assert.equal(checkpoints, 2);
});
