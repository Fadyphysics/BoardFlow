import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBoardLessonData } from '../../src/renderer/modules/board-file-format.js';

const themes = { light: {}, dark: {} };
const layers = ['lesson', 'teacher', 'student', 'answers'];

test('validates board lesson data and normalizes a legacy object array', () => {
    const data = {
        app: 'BoardFlow',
        objects: [{ type: 'rect', left: 10, top: 20, boardflowLayer: 'teacher' }],
        theme: 'light',
        grid: true,
        viewport: [1, 0, 0, 1, 0, 0],
        pageNum: 2
    };

    assert.deepEqual(validateBoardLessonData(data, 100, themes, layers), {
        objects: data.objects
    });
});

test('rejects unsafe object values, unsupported layers, and invalid viewport matrices', () => {
    const base = { app: 'BoardView', objects: [] };

    assert.equal(validateBoardLessonData({ ...base, objects: [{ type: 'rect', left: Infinity }] }, 100, themes, layers), false);
    assert.equal(validateBoardLessonData({ ...base, objects: [{ type: 'rect', boardflowLayer: 'unknown' }] }, 100, themes, layers), false);
    assert.equal(validateBoardLessonData({ ...base, viewport: [1, 0, 0, 0, 0, 0] }, 100, themes, layers), false);
    assert.equal(validateBoardLessonData(base, 25 * 1024 * 1024 + 1, themes, layers), false);
});

test('rejects malformed nested objects and objects beyond the safety limit', () => {
    const base = { app: 'BoardFlow', objects: [] };
    const tooManyObjects = Array.from({ length: 5001 }, () => ({ type: 'rect' }));
    const invalidChild = { type: 'group', objects: [null] };

    assert.equal(validateBoardLessonData({ ...base, objects: tooManyObjects }, 100, themes, layers), false);
    assert.equal(validateBoardLessonData({ ...base, objects: [invalidChild] }, 100, themes, layers), false);
});
