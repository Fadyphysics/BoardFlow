const MODEL_ID = 'Xenova/trocr-small-handwritten';
const MODEL_REVISION = '2432e24d184b1d964d07ed04f5d9e21d31a59141';
let recognizerPromise;

async function loadRecognizer(requestId) {
    if (!recognizerPromise) {
        recognizerPromise = (async () => {
            const { env, pipeline } = await import('@huggingface/transformers');
            env.backends.onnx.wasm.numThreads = 1;
            const recognizer = await pipeline('image-to-text', MODEL_ID, {
                dtype: 'q8',
                revision: MODEL_REVISION,
                progress_callback: progress => {
                    self.postMessage({ type: 'progress', id: requestId, progress });
                }
            });
            self.postMessage({ type: 'progress', id: requestId, progress: { status: 'ready' } });
            return recognizer;
        })();
        recognizerPromise.catch(() => { recognizerPromise = null; });
    }
    return recognizerPromise;
}

self.onmessage = async event => {
    const { id, image } = event.data || {};
    if (event.data?.type !== 'recognize' || !id || typeof image !== 'string') return;
    try {
        const recognizer = await loadRecognizer(id);
        self.postMessage({ type: 'progress', id, progress: { status: 'inference' } });
        const output = await recognizer(image, { max_new_tokens: 64 });
        const text = output?.[0]?.generated_text?.trim() || '';
        if (!text) throw new Error('The handwriting model could not read this writing. Your ink has been kept.');
        self.postMessage({
            type: 'result',
            id,
            result: { text, alternatives: [], engine: 'TrOCR small (browser, local)', kind: 'text' }
        });
    } catch (error) {
        self.postMessage({ type: 'error', id, error: error.message || 'Browser handwriting recognition failed.' });
    }
};
