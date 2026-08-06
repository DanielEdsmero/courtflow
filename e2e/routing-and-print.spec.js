import { test, expect } from '@playwright/test';
import { stubRest, stubRealtime, signIn, VENUE } from './stub-supabase.js';

/* ─────────────────────────────────────────────
   ROUTING
   main.jsx puts the two public routes in the OUTER <Routes> on purpose: the
   inner one ends in path="*" → <Navigate to="/">, which would otherwise eat
   every unauthenticated visitor to the club board. That trap is the whole point
   of this block.
   ───────────────────────────────────────────── */
test.describe('routing', () => {
  test('the club board is reachable signed out and is not swallowed by the catch-all', async ({ page }) => {
    await stubRest(page);
    await stubRealtime(page);
    await page.goto('/queue/demo-club');

    await expect(page).toHaveURL('http://localhost:5199/queue/demo-club');
    await expect(page.getByRole('heading', { name: 'Court 1' })).toBeVisible();
    // Neither the staff app nor the login screen.
    await expect(page.getByRole('link', { name: 'Back' })).toHaveCount(0);
  });

  test('an invalid slug still stays on its own route rather than redirecting', async ({ page }) => {
    await stubRest(page);
    await page.goto('/queue/Bad--Slug');
    await expect(page).toHaveURL('http://localhost:5199/queue/Bad--Slug');
    await expect(page.getByText('Club not found')).toBeVisible();
  });

  test('the TV display route still resolves after the new route was added above it', async ({ page }) => {
    await stubRest(page);
    await stubRealtime(page);
    await page.goto(`/d/${VENUE.display_token}`);
    await expect(page).toHaveURL(`http://localhost:5199/d/${VENUE.display_token}`);
    await expect(page.getByRole('heading', { name: 'Court 1' })).toBeVisible();
  });

  test('/leaderboard is guarded — signed out it redirects to login', async ({ page }) => {
    await stubRest(page);
    await page.goto('/leaderboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('an unknown route still redirects into the staff app', async ({ page }) => {
    await stubRest(page);
    await stubRealtime(page);
    await signIn(page);
    await page.goto('/does-not-exist');
    await expect(page).toHaveURL('http://localhost:5199/');
  });
});

/* ─────────────────────────────────────────────
   PRINT STYLESHEET
   The app is dark-only; a printed QR has to be black on white or it scans badly
   and wastes toner. Driven through the real poster in the staff app rather than
   injected markup, so the CSS is proved against the classes the component
   actually ships.
   ───────────────────────────────────────────── */
test.describe('print stylesheet', () => {
  test.beforeEach(async ({ page }) => {
    await stubRest(page);
    await stubRealtime(page);
    await signIn(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Display Link' }).click();
    await expect(page.getByText('SCAN FOR THE LIVE QUEUE')).toBeVisible();
  });

  // The modal has its own "Copy link" for the TV token as well as the poster's,
  // so poster assertions are scoped rather than page-wide.
  const posterBtn = (page, name) => page.locator('.cf-print').getByRole('button', { name });

  test('on screen the poster keeps its buttons and dark styling', async ({ page }) => {
    await expect(posterBtn(page, 'Print poster')).toBeVisible();
    await expect(posterBtn(page, 'Copy link')).toBeVisible();
  });

  test('printing hides the poster’s own buttons', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    await expect(posterBtn(page, 'Print poster')).toBeHidden();
    await expect(posterBtn(page, 'Copy link')).toBeHidden();
  });

  test('printing turns the poster black on white', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });

    const poster = page.locator('.cf-print');
    await expect(poster).toBeVisible();

    const bg = await poster.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(255, 255, 255)');

    // The club name is lime/zinc on screen; on paper it has to be solid black.
    const nameColor = await page
      .locator('.cf-print')
      .getByText(VENUE.name)
      .evaluate((el) => getComputedStyle(el).color);
    expect(nameColor).toBe('rgb(0, 0, 0)');

    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBg).toBe('rgb(255, 255, 255)');
  });

  test('printing hides everything outside the poster', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    // The staff header wordmark is the clearest "rest of the app" marker.
    await expect(page.locator('header').getByText('COURTFLOW')).toBeHidden();
    // …while the poster's own content stays visible.
    await expect(page.getByText('SCAN FOR THE LIVE QUEUE')).toBeVisible();
  });

  test('the QR code itself survives printing', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    const qr = page.locator('.cf-print svg').first();
    await expect(qr).toBeVisible();
    const box = await qr.boundingBox();
    expect(box.width).toBeGreaterThan(50);
  });
});
