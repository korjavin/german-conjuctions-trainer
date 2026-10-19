import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Boot smoke test: the real index.html + real dom.js + main.js.
// Every other spec mocks dom.js, so a renamed or deleted element id in
// index.html only shows up here (main.js crashes on `null.addEventListener`).

const html = readFileSync(resolve(import.meta.dirname, '../../index.html'), 'utf8');

// Scripts are imported below instead; happy-dom must not try to fetch them.
const body = html
    .match(/<body[^>]*>([\s\S]*)<\/body>/i)[1]
    .replace(/<script[\s\S]*?<\/script>/gi, '');

let dom;

beforeAll(async () => {
    document.body.innerHTML = body;
    vi.doUnmock('../dom.js');
    vi.doUnmock('../ui.js');
    // Logged-out user with an empty topic tree — the boot path every visitor takes.
    globalThis.fetch.mockImplementation(async (url) => {
        const status = String(url).includes('/auth/') ? 401 : 200;
        return new Response(JSON.stringify(status === 200 ? [] : { error: 'unauthorized' }), {
            status,
            headers: { 'Content-Type': 'application/json' },
        });
    });
    ({ dom } = await import('../dom.js'));
});

describe('app boot', () => {
    it('finds every element dom.js looks up in index.html', () => {
        const missing = Object.entries(dom)
            .filter(([, el]) => el === null)
            .map(([key]) => key);
        expect(missing).toEqual([]);
    });

    it('runs main.js without throwing', async () => {
        const errors = [];
        const onError = (e) => errors.push(e.error ?? e.reason ?? e);
        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onError);
        const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));

        await import('../main.js');
        // Let checkAuthStatus()/loadTopics() settle so their .then() runs too.
        await new Promise((r) => setTimeout(r, 50));

        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onError);
        consoleError.mockRestore();
        expect(errors).toEqual([]);
    });
});
