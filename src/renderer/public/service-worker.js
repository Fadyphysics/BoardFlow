const CACHE_NAME = 'boardflow-shell-v1';
const baseUrl = new URL('./', self.registration.scope);
const indexUrl = new URL('index.html', baseUrl);
const coreUrls = [
    new URL('manifest.webmanifest', baseUrl).href,
    new URL('icons/app-192.png', baseUrl).href,
    new URL('icons/app-512.png', baseUrl).href
];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const response = await fetch(indexUrl);
        if (!response.ok) throw new Error(`Could not cache the BoardFlow app shell (${response.status}).`);
        const html = await response.clone().text();
        const entryAssets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:m?js|css)(?:\?[^"']*)?)["']/g)]
            .map((match) => new URL(match[1], baseUrl).href);
        const cache = await caches.open(CACHE_NAME);
        await cache.put(indexUrl, response);
        await cache.addAll([...coreUrls, ...entryAssets]);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames
            .filter(name => name.startsWith('boardflow-shell-') && name !== CACHE_NAME)
            .map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/classroom/')) return;

    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                if (response.ok) {
                    const cache = await caches.open(CACHE_NAME);
                    await cache.put(request, response.clone());
                }
                return response;
            } catch {
                return (await caches.match(request)) || (await caches.match(indexUrl));
            }
        })());
        return;
    }

    event.respondWith((async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            event.waitUntil(cache.put(request, response.clone()).catch(error => {
                console.warn('Could not cache BoardFlow asset for offline use', error);
            }));
        }
        return response;
    })());
});
