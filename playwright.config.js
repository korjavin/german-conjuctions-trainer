import { defineConfig, devices } from '@playwright/test';
import { env, PORT } from './e2e/env.js';

// End-to-end suite: real Chromium against the real Go server (e2e/server.sh)
// on a fresh seeded SQLite DB. Vitest (js/__tests__) covers modules in isolation;
// this covers what only shows up when they run together in a browser.

export default defineConfig({
    testDir: 'e2e/tests',
    outputDir: 'test-results',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: process.env.CI ? 2 : undefined,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }], ['list']] : 'list',
    timeout: 20_000,
    expect: { timeout: 5_000 },
    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        locale: 'en-US',
        timezoneId: 'Europe/Berlin',
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
        { name: 'mobile', use: { ...devices['Pixel 7'] } },
    ],
    webServer: {
        command: 'e2e/server.sh',
        url: `http://localhost:${PORT}/health`,
        env,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
