import { test, expect, solveExercise, startPractice } from '../fixtures.js';

// Signed-in practice: what the learner does must reach the server and come
// back on History and Today after a reload. Each test is a brand-new user.

test.beforeEach(async ({ login }) => login());

const pill = (page, filter) => page.locator(`#history-filters [data-filter="${filter}"] .gct-pill__count`);

// Resolves once the session's completions reached the server.
const saved = (page) => page.waitForResponse((r) => r.url().endsWith('/api/exercises/complete') && r.ok());

async function openHistory(page) {
    await page.goto('/#/history');
    await expect(page.locator('#history-body')).toBeVisible();
}

test('a finished session is saved and shows on History and Today', async ({ page }) => {
    await startPractice(page);
    for (let i = 0; i < 9; i++) {
        await solveExercise(page);
        await page.locator('#next-exercise-btn').click();
    }
    await solveExercise(page);
    await Promise.all([saved(page), page.locator('#next-exercise-btn').click()]);
    await expect(page.locator('#statistics-container')).toContainText('Next reviews:');

    await page.reload(); // from the server, not in-memory state
    await openHistory(page);
    await expect(page.locator('#history-sub')).toContainText('10 practiced');
    await expect(pill(page, 'training')).toHaveText('10');
    await expect(pill(page, 'due')).toHaveText('0');

    await page.goto('/#/today');
    await expect(page.locator('#today-week')).toContainText('10 sentences');
});

test('ending a session early keeps the finished sentences', async ({ page }) => {
    await startPractice(page);
    await solveExercise(page);
    await page.locator('#next-exercise-btn').click();
    await solveExercise(page);
    await page.locator('#practice-close').click();
    await Promise.all([saved(page), page.locator('#confirm-dialog').getByRole('button', { name: 'End session' }).click()]);
    await expect(page).toHaveURL(/#\/today/);

    await page.reload();
    await openHistory(page);
    await expect(page.locator('#history-sub')).toContainText('2 practiced');
});

test('a favorite survives a reload', async ({ page }) => {
    await startPractice(page);
    const german = await solveExercise(page);
    const star = page.locator('#toggle-favorite-btn');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await openHistory(page);
    await expect(pill(page, 'fav')).toHaveText('1');
    await page.locator('#history-filters [data-filter="fav"]').click();
    await expect(page.locator('#history-content')).toContainText(german);
});

test('"Never show again" moves the sentence to Ignored', async ({ page }) => {
    await startPractice(page);
    const english = await page.locator('#english-hint').textContent();
    await page.locator('#skip-exercise-btn').click();
    await page.locator('#confirm-dialog').getByRole('button', { name: 'Never show again' }).click();
    await expect(page.locator('#english-hint')).not.toHaveText(english);

    await openHistory(page);
    await expect(pill(page, 'ignored')).toHaveText('1');
    await page.locator('#history-filters [data-filter="ignored"]').click();
    await expect(page.locator('#history-content')).toContainText(english);
});
