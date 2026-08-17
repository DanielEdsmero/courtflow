import { test, expect } from '@playwright/test';
import { stubRest, stubRealtime, signIn } from './stub-supabase.js';

/* ─────────────────────────────────────────────
   FULL-SCREEN MATCH REVEAL + SETTINGS
   The reveal covers the whole viewport and is portalled to <body>, so no
   panel's width, stacking context or overflow box can confine it. An earlier
   version rendered inside the queue panel and was squeezed into a column —
   `is portalled to body, not trapped in a panel` and `covers the whole
   viewport` are the regression cover for exactly that.
   ───────────────────────────────────────────── */

function row(id, name) {
  return {
    id,
    name,
    skill: 'Intermediate',
    wins: 0,
    losses: 0,
    total_wins: 0,
    total_losses: 0,
    total_games: 0,
    photo_url: null,
    payment: 'cash',
    checked_in_at: new Date().toISOString(),
    checked_out_at: null,
  };
}

const ROSTER = [
  row('p1', 'Ann Alpha'),
  row('p2', 'Ben Bravo'),
  row('p3', 'Cal Charlie'),
  row('p4', 'Dee Delta'),
];

// Auto-Filling off, one free court, one complete group waiting — so the test
// drives the assignment rather than racing the auto-assign effect.
const readyToAssign = () => ({
  competitiveMode: true,
  autoAssign: false,
  announcement: '',
  onboarded: true,
  matchingStyle: 'balanced',
  courts: [{ id: 1, name: 'Court 1', type: 'open', match: null }],
  queue: [{ id: 'g1', players: ['p1', 'p2', 'p3', 'p4'], type: 'manual' }],
  history: [],
});

async function open(page, prefs) {
  await signIn(page, prefs);
  const calls = await stubRest(page, { players: ROSTER, session: readyToAssign() });
  await stubRealtime(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  return calls;
}

async function assignToCourt(page) {
  await page.getByRole('button', { name: /Assign to court/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign to court' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
}

const overlay = (page) => page.locator('[data-match-reveal]');
const courtCard = (page) => page.locator('[data-court-id="1"]');
const flightItems = (page) => page.locator('[data-flight-player]');

/* ── it is a real full-screen overlay ───────── */

test('is portalled to body, not trapped inside a panel', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(overlay(page)).toBeVisible();

  // The regression: rendered as a child of the queue section, the overlay
  // inherited that column's width and overflow box.
  const parentIsBody = await overlay(page).evaluate(el => el.parentElement === document.body);
  expect(parentIsBody).toBe(true);

  const insideQueuePanel = await overlay(page).evaluate(el => !!el.closest('section'));
  expect(insideQueuePanel).toBe(false);
});

test('covers the whole viewport', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(overlay(page)).toBeVisible();

  const viewport = page.viewportSize();
  const box = await overlay(page).boundingBox();
  expect(box.x).toBe(0);
  expect(box.y).toBe(0);
  expect(box.width).toBe(viewport.width);
  expect(box.height).toBe(viewport.height);
});

test('sits above the courts, the roster and the toolbar', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(overlay(page)).toBeVisible();

  // Whatever is at the middle of the screen must be the overlay or part of it.
  const viewport = page.viewportSize();
  const onTop = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return !!el?.closest('[data-match-reveal]');
  }, [Math.floor(viewport.width / 2), Math.floor(viewport.height / 2)]);
  expect(onTop).toBe(true);
});

/* ── the reveal ─────────────────────────────── */

test('deals four cards horizontally across the centre', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);

  const cards = overlay(page).locator('[data-reveal-card]');
  await expect(cards).toHaveCount(4);
  for (const name of ['Ann Alpha', 'Ben Bravo', 'Cal Charlie', 'Dee Delta']) {
    await expect(overlay(page).getByText(name)).toBeVisible();
  }

  // Measure only once the deal has settled — mid-spring the cards are still
  // dropping in from different heights and every y would differ.
  await expect(overlay(page).getByText('Matched!')).toBeVisible({ timeout: 6000 });

  // Horizontal, not the vertical column the old in-queue version produced:
  // four distinct x positions, all sharing one row.
  const boxes = await cards.evaluateAll(els => els.map(e => e.getBoundingClientRect()));
  expect(new Set(boxes.map(b => Math.round(b.x))).size).toBe(4);
  const ys = boxes.map(b => b.y);
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(2);
});

test('player names are legible against the dark backdrop', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(overlay(page).getByText('Ann Alpha')).toBeVisible();

  // The regression this guards: the overlay portals to document.body, which is
  // outside the app wrapper that sets the text colour, so an unstyled name
  // inherited the document default and rendered black on a black backdrop.
  const colours = await overlay(page)
    .locator('[data-reveal-card] span.font-display')
    .evaluateAll(els => els.map(e => getComputedStyle(e).color));

  expect(colours).toHaveLength(4);
  for (const colour of colours) {
    const [r, g, b] = colour.match(/\d+/g).map(Number);
    // Green, and bright enough to read.
    expect(g).toBeGreaterThan(150);
    expect(g).toBeGreaterThan(b);
    expect(r + g + b).toBeGreaterThan(200);
  }
});

test('every card shows an avatar', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(overlay(page).locator('[data-reveal-card]')).toHaveCount(4);

  // No photo_url on these four, so each avatar is the initials disc.
  for (const initials of ['AA', 'BB', 'CC', 'DD']) {
    await expect(overlay(page).getByText(initials, { exact: true })).toBeVisible();
  }
});

test('holds the four on screen for at least five seconds', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  const started = Date.now();
  await assignToCourt(page);
  await expect(overlay(page)).toBeVisible();

  await page.waitForTimeout(Math.max(0, 5000 - (Date.now() - started)));
  await expect(overlay(page).locator('[data-reveal-card]')).toHaveCount(4);
});

test('the Matched! label arrives after the cards, not with them', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);

  await expect(overlay(page).getByText('Matched!')).toHaveCount(0);
  await expect(overlay(page).getByText('Matched!')).toBeVisible({ timeout: 6000 });
  await expect(overlay(page).getByText('Going to Court 1')).toBeVisible();
});

/* ── the layoutId handover ──────────────────── */

test('only one side owns each player while the overlay is up', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(overlay(page)).toBeVisible();

  // Duplicated layoutIds are what break a Framer morph.
  await expect(flightItems(page)).toHaveCount(4);
  await expect(courtCard(page).locator('[data-flight-player]')).toHaveCount(0);
});

test('the court takes ownership once the cards fly', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(overlay(page)).toBeVisible();

  await expect(courtCard(page).locator('[data-flight-player]')).toHaveCount(4, { timeout: 12_000 });
  // Never eight — the overlay has let go by the time the court holds them.
  await expect(flightItems(page)).toHaveCount(4);
});

test('the overlay clears itself and the court ends up in play', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(overlay(page)).toBeVisible();

  await expect(overlay(page)).toHaveCount(0, { timeout: 14_000 });
  await expect(page.getByRole('button', { name: 'FINISH MATCH' })).toBeVisible();
  await expect(courtCard(page).locator('[data-flight-player]')).toHaveCount(4);
});

test('clicking anywhere on the overlay skips it', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(overlay(page)).toBeVisible();

  const skippedAt = Date.now();
  await overlay(page).click({ position: { x: 12, y: 12 } });

  await expect(overlay(page)).toHaveCount(0, { timeout: 4000 });
  expect(Date.now() - skippedAt).toBeLessThan(4000);
  await expect(courtCard(page).locator('[data-flight-player]')).toHaveCount(4);
});

/* ── the assignment is not hostage to the animation ── */

test('the court is committed before the animation finishes', async ({ page }) => {
  const calls = await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(overlay(page)).toBeVisible();

  await expect
    // The four are asserted as a SET: staff-assigning a group runs the same snake
    // draft Auto does (spec §3, §5), so the stored order is the team order the
    // engine chose, not the order the group happened to be built in.
    .poll(() => [...(calls.lastSessionWrite?.courts?.[0]?.match?.players ?? [])].sort())
    .toEqual(['p1', 'p2', 'p3', 'p4']);
  expect(calls.lastSessionWrite.queue).toEqual([]);
});

test('reloading mid-sequence shows the true state, not the overlay', async ({ page }) => {
  const calls = await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(overlay(page)).toBeVisible();

  // Session writes are debounced ~600ms, so wait for the assignment to reach
  // the server before reloading — otherwise this measures the debounce. Still
  // comfortably mid-sequence.
  await expect
    // The four are asserted as a SET: staff-assigning a group runs the same snake
    // draft Auto does (spec §3, §5), so the stored order is the team order the
    // engine chose, not the order the group happened to be built in.
    .poll(() => [...(calls.lastSessionWrite?.courts?.[0]?.match?.players ?? [])].sort())
    .toEqual(['p1', 'p2', 'p3', 'p4']);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'FINISH MATCH' })).toBeVisible();
});

/* ── animations off ─────────────────────────── */

test('with animations off the court fills instantly and no overlay appears', async ({ page }) => {
  const calls = await open(page, { animations: false, sound: false });
  await assignToCourt(page);

  await expect(page.getByRole('button', { name: 'FINISH MATCH' })).toBeVisible();
  await expect(overlay(page)).toHaveCount(0);
  await expect(courtCard(page).locator('[data-flight-player]')).toHaveCount(4);
  await expect
    // The four are asserted as a SET: staff-assigning a group runs the same snake
    // draft Auto does (spec §3, §5), so the stored order is the team order the
    // engine chose, not the order the group happened to be built in.
    .poll(() => [...(calls.lastSessionWrite?.courts?.[0]?.match?.players ?? [])].sort())
    .toEqual(['p1', 'p2', 'p3', 'p4']);
});

/* ── the settings menu ──────────────────────── */

test('the gear menu exposes both toggles independently', async ({ page }) => {
  await open(page, { animations: true, sound: true });
  await page.getByRole('button', { name: 'Settings' }).click();

  const animations = page.getByRole('menuitemcheckbox', { name: /Animations/ });
  const sound = page.getByRole('menuitemcheckbox', { name: /Sound effects/ });
  await expect(animations).toHaveAttribute('aria-checked', 'true');
  await expect(sound).toHaveAttribute('aria-checked', 'true');

  await sound.click();
  await expect(sound).toHaveAttribute('aria-checked', 'false');
  await expect(animations).toHaveAttribute('aria-checked', 'true');
});

test('toggles persist across a reload', async ({ page }) => {
  await open(page, { animations: true, sound: true });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitemcheckbox', { name: /Animations/ }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: /Animations/ }))
    .toHaveAttribute('aria-checked', 'false');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: /Animations/ }))
    .toHaveAttribute('aria-checked', 'false');
});

test('animations switched off in the menu take effect immediately', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitemcheckbox', { name: /Animations/ }).click();
  await page.keyboard.press('Escape');

  await assignToCourt(page);
  await expect(page.getByRole('button', { name: 'FINISH MATCH' })).toBeVisible();
  await expect(overlay(page)).toHaveCount(0);
});

test('sound off still plays the full animation', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(overlay(page)).toBeVisible();
  await expect(overlay(page).locator('[data-reveal-card]')).toHaveCount(4);
  await expect(overlay(page).getByText('Matched!')).toBeVisible({ timeout: 6000 });
});
