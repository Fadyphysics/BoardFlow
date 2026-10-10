let worker = null;
let nextRequestId = 0;
const pendingRequests = new Map();

function failWorker(error) {
    const failedWorker = worker;
    worker = null;
    failedWorker?.terminate();
    pendingRequests.forEach(request => request.reject(error));
    pendingRequests.clear();
}

function getWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./handwriting-recognition-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = event => {
        const message = event.data;
        const request = pendingRequests.get(message.id);
        if (!request) return;
        if (message.type === 'progress') {
            request.onProgress?.(message.progress);
        } else {
            pendingRequests.delete(message.id);
            if (message.type === 'result') request.resolve(message.result);
            else request.reject(new Error(message.error || 'Browser handwriting recognition failed.'));
        }
    };
    worker.onerror = event => {
        event.preventDefault();
        failWorker(new Error(event.message || 'The browser handwriting model could not start.'));
    };
    return worker;
}

export function recognizeHandwritingImage(image, onProgress) {
    return new Promise((resolve, reject) => {
        const id = ++nextRequestId;
        pendingRequests.set(id, { resolve, reject, onProgress });
        try {
            getWorker().postMessage({ type: 'recognize', id, image });
        } catch (error) {
            pendingRequests.delete(id);
            reject(error);
        }
    });
}
