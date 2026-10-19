import { test, expect, solveExercise, wrongChip, startPractice, currentSentence, chip } from '../fixtures.js';

// The practice card as a guest: build sentences, make mistakes, use hints,
// skip, and finish a whole session.

test.beforeEach(async ({ page }) => startPractice(page));

test('building the sentence word by word completes it', async ({ page }) => {
    const german = await solveExercise(page);
    // One element per token, so compare the text without whitespace.
    const built = await page.locator('#constructed-sentence').textContent();
    expect(built.replace(/\s+/g, '')).toBe(german.replace(/\s+/g, ''));
    await expect(page.locator('#completion-status-indicator')).not.toBeEmpty();
    await expect(page.locator('#scrambled-words-header')).toBeHidden();
});

test('a wrong word counts a mistake and is not taken', async ({ page }) => {
    const chip = await wrongChip(page);
    await chip.click();
    await expect(chip).toHaveClass(/gct-chip--wrong/);
    await expect(chip).not.toHaveClass(/word-collected/);
    await expect(page.locator('#practice-status')).toContainText('1 mistake');
    await solveExercise(page);
    await expect(page.locator('#answer-area')).toHaveClass(/is-mistakes/);
});

test('Hint highlights the next word', async ({ page }) => {
    await page.locator('#hint-btn').click();
    await expect(page.locator('#scrambled-words-container .hint-word')).toHaveCount(1);
    await expect(page.locator('#practice-status')).toContainText('1 hint');
});

test('Next moves on to the following sentence', async ({ page }) => {
    await expect(page.locator('#exercise-counter')).toHaveText('1 of 10');
    const first = await page.locator('#english-hint').textContent();
    await solveExercise(page);
    await page.locator('#next-exercise-btn').click();
    await expect(page.locator('#exercise-counter')).toHaveText('2 of 10');
    await expect(page.locator('#english-hint')).not.toHaveText(first);
});

test('number keys pick words and Enter moves on', async ({ page, isMobile }) => {
    test.skip(isMobile, 'hotkeys are a keyboard feature');
    const { words } = await currentSentence(page);
    for (const word of words) await page.keyboard.press(await chip(page, word).getAttribute('data-hotkey'));
    await expect(page.locator('#exercise-controls')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('#exercise-counter')).toHaveText('2 of 10');
});

test('Skip asks first, in a centered dialog', async ({ page }) => {
    await page.locator('#skip-exercise-btn').click();
    const dialog = page.locator('#confirm-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Skip this sentence?');

    // Regression (#133): the dialog was pinned to the left edge.
    const box = await dialog.boundingBox();
    const width = page.viewportSize().width;
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#exercise-counter')).toHaveText('1 of 10');

    await page.locator('#skip-exercise-btn').click();
    await dialog.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.locator('#exercise-counter')).toHaveText(/^\d+ of \d+$/);
    await expect(page.locator('#exercise-counter')).not.toHaveText('1 of 10');
});

test('a full session ends on the summary', async ({ page }) => {
    const wrong = await wrongChip(page);
    await wrong.click(); // one mistake → one sentence "worth another look"
    for (let i = 0; i < 10; i++) {
        await solveExercise(page);
        await page.locator('#next-exercise-btn').click();
    }
    await expect(page).toHaveURL(/#\/summary/);
    const summary = page.locator('#statistics-container');
    await expect(summary).toContainText('Session done');
    await expect(summary.locator('.gct-summary__score')).toHaveText('9/10');
    await expect(summary.locator('.gct-summary__row')).toHaveCount(1);
});

test('the X in the practice bar ends the session after confirming', async ({ page }) => {
    await solveExercise(page);
    await page.locator('#practice-close').click();
    const dialog = page.locator('#confirm-dialog');
    await expect(dialog).toContainText('End this session?');
    await dialog.getByRole('button', { name: 'End session' }).click();
    await expect(page).toHaveURL(/#\/today/);
    await expect(page.locator('section[data-screen="today"]')).toBeVisible();
});
