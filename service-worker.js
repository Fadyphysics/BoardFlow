const CACHE_NAME = 'boardflow-shell-v1';
const SHELL_FILES = [
    './',
    './index.html',
    './app.js',
    './math.js',
    './libs/fabric.min.js',
    './libs/pdf.min.js',
    './libs/pdf.worker.min.js',
    './libs/math.min.js',
    './libs/jspdf.umd.min.js',
    './icon.png',
    './manifest.webmanifest'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
        ))
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
            return response;
        }))
    );
});
