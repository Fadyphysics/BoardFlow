let pdfModulePromise;

async function loadPdfModule() {
    if (!pdfModulePromise) {
        pdfModulePromise = Promise.all([
            import('pdfjs-dist/build/pdf.mjs'),
            import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        ]).then(([pdfjs, worker]) => {
            pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
            return pdfjs;
        });
    }
    return pdfModulePromise;
}

export async function loadPdfDocument(data) {
    const pdfjs = await loadPdfModule();
    return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
}
