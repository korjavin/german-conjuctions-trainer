import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { env, PORT } from './env.js';

// The sentences e2e/seed puts in every topic, keyed by their English hint.
const sentences = JSON.parse(readFileSync(new URL('./seed/sentences.json', import.meta.url), 'utf8'));
const germanFor = new Map(sentences.map((s) => [s.en, s.de]));

// 0.1 s of 8 kHz 8-bit mono silence: a real, playable file for the audio paths.
function silentWav() {
    const samples = 800;
    const buf = Buffer.alloc(44 + samples, 128);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
    buf.write('data', 36); buf.writeUInt32LE(samples, 40);
    return buf;
}
const SILENCE = `data:audio/wav;base64,${silentWav().toString('base64')}`;

export const test = base.extend({
    // Fails the test on any uncaught page error, console.error or 5xx response.
    // A test that expects one calls allowErrors(/pattern/).
    allowErrors: [async ({ page }, use) => {
        // Each picked word's audio cuts off the previous one; audio.js logs the
        // resulting play() AbortError. Harmless, and real users trigger it too.
        const allowed = [/Error playing audio: AbortError/];
        const errors = [];
        page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
        page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
        await use((re) => allowed.push(re));
        expect(errors.filter((e) => !allowed.some((re) => re.test(e))), 'unexpected page errors').toEqual([]);
    }, { auto: true }],

    // No ElevenLabs key in e2e: answer /api/tts with a silent clip so the
    // audio code runs for real instead of logging 503s. A data: URL, because
    // Chromium will not play media from a route-fulfilled response.
    page: async ({ page }, use) => {
        await page.route('**/api/tts', (route) => route.fulfill({ json: { filePath: SILENCE } }));
        await use(page);
    },

    // login() signs the browser context in as a brand-new user (fresh SRS state);
    // login({ admin: true }) as the GOOGLE_ADMIN_ID user.
    login: async ({ context }, use) => {
        await use(async ({ admin = false } = {}) => {
            const googleId = admin ? env.GOOGLE_ADMIN_ID : `e2e-${randomUUID()}`;
            const value = execFileSync('e2e/.tmp/seed', ['user', env.E2E_DB, googleId], { env: { ...process.env, ...env }, stdio: 'pipe' }).toString();
            await context.addCookies([{ name: 'user-session', value, url: `http://localhost:${PORT}` }]);
        });
    },
});

export { expect };

// The German sentence on the practice card, and its words in order.
export async function currentSentence(page) {
    const hint = await page.locator('#english-hint').textContent();
    const german = germanFor.get(hint);
    expect(german, `seeded sentence for hint "${hint}"`).toBeTruthy();
    return { german, words: german.match(/[\p{L}\p{N}']+/gu) };
}

export const chip = (page, word) =>
    page.locator(`#scrambled-words-container .btn-word:not(.word-collected)[data-word="${word}"]`).first();

// Builds the sentence on screen by clicking its chips in order.
export async function solveExercise(page) {
    const { german, words } = await currentSentence(page);
    for (const word of words) await chip(page, word).click();
    await expect(page.locator('#exercise-controls')).toBeVisible();
    return german;
}

// The first chip that is not the next correct word.
export async function wrongChip(page) {
    const { words } = await currentSentence(page);
    return page.locator(`#scrambled-words-container .btn-word:not([data-word="${words[0]}"])`).first();
}

export async function startPractice(page) {
    await page.goto('/');
    await page.locator('#generate-btn').click();
    await expect(page).toHaveURL(/#\/practice/);
    await expect(page.locator('#english-hint')).not.toBeEmpty();
}
