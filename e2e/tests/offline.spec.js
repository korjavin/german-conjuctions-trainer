import { test, expect, solveExercise } from '../fixtures.js';

// sw.js precaches the app shell; offline.js stashes exercises and queues
// results. Both only work in a real browser with a real service worker.

// What a page logs while the network is gone; expected in these tests only.
const OFFLINE_NOISE = [/TypeError: Failed to fetch/, /net::ERR_INTERNET_DISCONNECTED/];

async function waitForServiceWorker(page) {
    await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
            await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
        }
    });
}

// Offline reloads can be rescued by the HTTP cache, so check the SW cache
// itself: everything the page actually loaded must have been precached.
test('every script and stylesheet the page loads is precached', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('section[data-screen="today"]')).toBeVisible();
    await waitForServiceWorker(page);

    const missing = await page.evaluate(async () => {
        const loaded = performance.getEntriesByType('resource')
            .filter((e) => ['script', 'link', 'css'].includes(e.initiatorType))
            .map((e) => new URL(e.name))
            .filter((u) => u.origin === location.origin && /\.(js|css)$/.test(u.pathname));
        const out = [];
        for (const u of loaded) {
            if (!(await caches.match(u.pathname, { ignoreSearch: true }))) out.push(u.pathname);
        }
        return out;
    });
    expect(missing).toEqual([]);
});

test('the app shell loads with no network', async ({ page, context, allowErrors }) => {
    OFFLINE_NOISE.forEach(allowErrors);
    await page.goto('/');
    await expect(page.locator('section[data-screen="today"]')).toBeVisible();
    await waitForServiceWorker(page);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('section[data-screen="today"]')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/is-offline/);
    // Styles came from the cache too: the top bar is laid out, not raw HTML.
    await expect(page.locator('.gct-topbar__nav a').first()).toHaveCSS('text-decoration-line', 'none');
});

test('a session practised offline syncs when back online', async ({ page, context, login, allowErrors }) => {
    OFFLINE_NOISE.forEach(allowErrors);
    await login();
    await page.goto('/');
    await waitForServiceWorker(page);

    // Narrow the scope to one topic, then stash it from Settings.
    await page.locator('#today-sections').getByText('Conjunctions').click();
    await expect(page.locator('#scope-slot')).toContainText('Conjunctions');
    await page.goto('/#/me');
    await page.locator('#offline-cache-btn').click();
    await expect(page.locator('#offline-cache-count')).toHaveText('12 exercises cached', { timeout: 15_000 });

    await context.setOffline(true);
    await page.goto('/#/today');
    await page.locator('#generate-btn').click();
    for (let i = 0; i < 10; i++) {
        await solveExercise(page);
        await page.locator('#next-exercise-btn').click();
    }
    await expect(page.locator('#statistics-container')).toContainText('Session done');

    const synced = page.waitForResponse((r) => r.url().endsWith('/api/exercises/complete') && r.ok());
    await context.setOffline(false);
    await synced;

    await page.goto('/#/history');
    await expect(page.locator('#history-sub')).toContainText('10 practiced');
});
