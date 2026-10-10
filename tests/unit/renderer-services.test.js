import assert from 'node:assert/strict';
import test from 'node:test';

test('date labels include the correct ordinal suffix', async () => {
    const { updateDateLabel } = await import('../../src/renderer/date.js');
    const elements = Object.fromEntries(['month', 'day', 'ordinal', 'year'].map(key => [key, { textContent: '' }]));

    updateDateLabel(elements, new Date('2026-09-21T12:00:00Z'));

    assert.equal(elements.month.textContent, 'SEP');
    assert.equal(elements.day.textContent, 21);
    assert.equal(elements.ordinal.textContent, 'st');
    assert.equal(elements.year.textContent, 2026);
});

test('byId rejects missing required UI elements', async () => {
    const originalDocument = globalThis.document;
    globalThis.document = { getElementById: () => null };
    const { byId } = await import('../../src/renderer/dom.js');

    assert.throws(() => byId('missing'), /Required UI element #missing is missing/);
    globalThis.document = originalDocument;
});

test('subject storage rejects malformed and non-array data', async () => {
    const values = new Map();
    const originalLocalStorage = globalThis.localStorage;
    const originalConsoleError = console.error;
    console.error = () => {};
    globalThis.localStorage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value)
    };
    const { readSubjects, writeSubjects } = await import('../../src/renderer/persistence.js');

    values.set('boardflow-subjects', '{bad json');
    assert.deepEqual(readSubjects(), []);
    values.set('boardflow-subjects', '{}');
    assert.deepEqual(readSubjects(), []);
    writeSubjects([{ id: 'math', name: 'Math' }]);
    assert.deepEqual(readSubjects(), [{ id: 'math', name: 'Math' }]);
    globalThis.localStorage = originalLocalStorage;
    console.error = originalConsoleError;
});

test('checkpoint writes wait for IndexedDB commit and reject transaction aborts', async () => {
    const originalIndexedDB = globalThis.indexedDB;
    const database = {
        objectStoreNames: { contains: () => true },
        transaction() {
            const transaction = {};
            transaction.objectStore = () => ({
                put(_value, key) {
                    const request = {};
                    setImmediate(() => {
                        request.result = key;
                        request.onsuccess?.();
                        setImmediate(() => {
                            if (key === 'abort-after-request') transaction.onabort?.();
                            else transaction.oncomplete?.();
                        });
                    });
                    return request;
                }
            });
            return transaction;
        },
        close() {}
    };
    globalThis.indexedDB = {
        open() {
            const request = {};
            setImmediate(() => {
                request.result = database;
                request.onsuccess?.();
            });
            return request;
        }
    };
    try {
        const { putCheckpoint } = await import('../../src/renderer/persistence.js');
        assert.equal(await putCheckpoint('committed', { value: 1 }), 'committed');
        await assert.rejects(putCheckpoint('abort-after-request', {}), /transaction aborted/);
    } finally {
        globalThis.indexedDB = originalIndexedDB;
    }
});

test('deletion PINs are stored as deterministic hashes', async () => {
    const { hashDeletePin } = await import('../../src/renderer/security.js');
    assert.equal(
        await hashDeletePin('1234'),
        '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'
    );
});

test('math intelligence recognizes graphable equations', async () => {
    const { parseEquation } = await import('../../src/renderer/math-intelligence.js');

    assert.deepEqual(parseEquation('y = 2x² − 3'), { label: 'y = 2x^2 - 3', expression: '2x^2 - 3' });
    assert.deepEqual(parseEquation('f(x)=sin(x)'), { label: 'f(x)=sin(x)', expression: 'sin(x)' });
    assert.equal(parseEquation('answer = 42'), null);
});

test('math intelligence recognizes series and coordinate tables', async () => {
    const { parseDataTable } = await import('../../src/renderer/math-intelligence.js');

    assert.deepEqual(parseDataTable('1\n2\n3\n4'), {
        pairs: [],
        values: [1, 2, 3, 4],
        recommendedChart: 'bar'
    });
    assert.deepEqual(parseDataTable('x,y\n1,4\n2,7\n3,9'), {
        pairs: [[1, 4], [2, 7], [3, 9]],
        values: [4, 7, 9],
        recommendedChart: 'scatter'
    });
    assert.equal(parseDataTable('1\n2'), null);
});
