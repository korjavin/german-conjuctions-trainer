import { test, expect } from '../fixtures.js';
import { randomUUID } from 'node:crypto';

// Admin screens. Tests share one database, so created topics get unique names.

test.beforeEach(async ({ login, page }) => {
    await login({ admin: true });
    await page.goto('/#/manage');
    await expect(page.locator('#topics-list')).toContainText('Conjunctions');
});

test('a new topic is saved and offered to learners', async ({ page, browser }) => {
    const name = `E2E topic ${randomUUID().slice(0, 8)}`;
    await page.locator('#add-topic-btn').click();
    await page.locator('#topic-name-input').fill(name);
    await page.locator('#prompt-textarea').fill('Topic: "trotzdem" and "deshalb". Write B1 sentences that use them.');
    await page.locator('#save-prompt-btn').click();
    await expect(page.locator('#topics-list')).toContainText(name);

    // A guest in a separate browser sees it in the Topics browser.
    const guest = await browser.newPage();
    await guest.goto('/#/topics');
    await expect(guest.locator('#topics-body')).toContainText(name);
    await guest.close();
});

test('Database tab shows the seeded counts', async ({ page }) => {
    await page.locator('[data-manage-tab="db"]').click();
    await expect(page.locator('#db-stat-exercises')).toHaveText(/^\d+$/);
    expect(Number(await page.locator('#db-stat-exercises').textContent())).toBeGreaterThanOrEqual(24);
});

test('CLI access issues a token', async ({ page }) => {
    await page.locator('[data-manage-tab="cli"]').click();
    await page.locator('#cli-token-label').fill('e2e');
    await page.locator('#cli-token-generate-btn').click();
    await expect(page.locator('#cli-token-result')).toBeVisible();
    await expect(page.locator('#cli-token-value')).toHaveValue(/.{20,}/);
});
