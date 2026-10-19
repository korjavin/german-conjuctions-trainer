import { test, expect } from '../fixtures.js';

// Every screen renders without errors, for guests and signed-in users, on both
// projects (desktop + mobile). The fixture fails a test on any console error.

const SCREENS = ['today', 'topics', 'listen', 'history', 'me'];

async function expectScreen(page, name) {
    await page.goto(`/#/${name}`);
    const screen = page.locator(`section[data-screen="${name}"]`);
    await expect(screen).toBeVisible();
    await expect(page.locator('section[data-screen]:visible')).toHaveCount(1);
    // No sideways scrolling: the layout fits the viewport.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${name} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
}

test.describe('guest', () => {
    for (const name of SCREENS) {
        test(`#/${name} renders`, async ({ page }) => {
            await expectScreen(page, name);
        });
    }

    test('sees login, not the account menu or Manage', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#generate-btn')).toBeVisible();
        await expect(page.locator('#avatar-btn')).toBeHidden();
        await expect(page.locator('#manage-btn')).toBeHidden();
    });

    test('#/manage is not reachable', async ({ page }) => {
        await page.goto('/#/manage');
        await expect(page.locator('section[data-screen="manage"]')).toBeHidden();
    });
});

test.describe('signed in', () => {
    test.beforeEach(async ({ login }) => login());

    for (const name of SCREENS) {
        test(`#/${name} renders`, async ({ page }) => {
            await expectScreen(page, name);
        });
    }

    test('sees the account menu, not login or Manage', async ({ page, isMobile }) => {
        await page.goto('/');
        // Mobile swaps the avatar menu for the tab bar's Me tab.
        await expect(isMobile ? page.locator('.gct-tabbar a[href="#/me"]') : page.locator('#avatar-btn')).toBeVisible();
        await expect(page.locator('#login-btn')).toBeHidden();
        await expect(page.locator('#manage-btn')).toBeHidden();
    });
});

test.describe('admin', () => {
    test.beforeEach(async ({ login }) => login({ admin: true }));

    test('#/manage renders the topic tree', async ({ page }) => {
        await expectScreen(page, 'manage');
        await expect(page.locator('#topics-list')).toContainText('Conjunctions');
    });
});
