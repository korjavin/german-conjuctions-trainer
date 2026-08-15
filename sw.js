/* Service worker for offline practice sessions.
 *
 * Strategy:
 *   - shell (/, css, js modules, favicons, manifest): cache-first, precached on install
 *   - /audio_cache/*: cache-first (content-addressed + immutable), silent miss offline
 *   - /api/*: never touched — always network
 *   - CDN chart.js + Google Fonts: runtime cache-first, best effort (opaque responses)
 *
 * IMPORTANT: bump CACHE_VERSION whenever a shell file changes, otherwise
 * returning visitors keep the old cached copy until the cache is evicted.
 */
const CACHE_VERSION = 'gct-shell-v1';

const SHELL_ASSETS = [
    '/',
    '/style.css',
    '/manifest.json',
    '/favicon.svg',
    '/favicon-32x32.svg',
    '/js/main.js',
    '/js/state.js',
    '/js/dom.js',
    '/js/api.js',
    '/js/audio.js',
    '/js/auth.js',
    '/js/exercise.js',
    '/js/history.js',
    '/js/offline.js',
    '/js/session.js',
    '/js/topics.js',
    // Third-party shell dependencies — best effort, a failure here is fine.
    'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.0/chart.umd.min.js',
    'https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700;800&display=swap',
];

const RUNTIME_CACHE_HOSTS = [
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_VERSION);
        // Individual adds (not addAll) so one 404 doesn't abort the whole install.
        await Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset)));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

async function cacheFirst(request) {
    const cache = await caches.open(CACHE_VERSION);
    // ignoreSearch: index.html references style.css?v=..., and navigations can
    // carry query strings (?debug=true) that must still hit the cached shell.
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    try {
        const response = await fetch(request);
        // Only full 200s are cacheable — cache.put rejects 206 range responses.
        if (response && (response.status === 200 || response.type === 'opaque')) {
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (error) {
        if (request.mode === 'navigate') {
            const shell = await cache.match('/', { ignoreSearch: true });
            if (shell) return shell;
        }
        // Offline miss (e.g. audio that was never warmed) — fail silently.
        return Response.error();
    }
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    if (url.origin === self.location.origin) {
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
        if (url.pathname === '/sw.js') return;
        event.respondWith(cacheFirst(request));
        return;
    }

    if (RUNTIME_CACHE_HOSTS.includes(url.hostname)) {
        event.respondWith(cacheFirst(request));
    }
});
