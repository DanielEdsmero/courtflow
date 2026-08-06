import { test, expect } from '@playwright/test';
import { stubRest, stubRealtime, signIn } from './stub-supabase.js';

/* ─────────────────────────────────────────────
   QUEUE → COURT FLIGHT + SETTINGS
   The reveal happens in place now: players appear inside their queue group
   card, the card glows, then they fly up into the court card.

   The assertions that matter most are about WHO OWNS the players at each
   moment — the flight only works because exactly one side renders a given
   layoutId at a time — and about the assignment being committed up front,
   independently of the animation.
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

const ghost = (page) => page.locator('[data-flight-ghost]');
const courtCard = (page) => page.locator('[data-court-id="1"]');
const flightItems = (page) => page.locator('[data-flight-player]');

/* ── phase 1: reveal inside the queue ───────── */

test('the four are revealed inside the queue group, not in a centre overlay', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);

  await expect(ghost(page)).toBeVisible();
  await expect(ghost(page).locator('[data-flight-player]')).toHaveCount(4);
  for (const name of ['Ann Alpha', 'Ben Bravo', 'Cal Charlie', 'Dee Delta']) {
    await expect(ghost(page).getByText(name)).toBeVisible();
  }
});

test('the ghost sits in the queue column, below the courts band', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(ghost(page)).toBeVisible();

  // The whole point of the redesign: the players start low on the page and the
  // court is up top, so the flight reads as travel.
  const from = await ghost(page).boundingBox();
  const to = await courtCard(page).boundingBox();
  expect(from.y).toBeGreaterThan(to.y);
});

/* ── the layoutId handover ──────────────────── */

test('only one side owns each player while the flight is pending', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(ghost(page)).toBeVisible();

  // Duplicated layoutIds are what break a Framer morph — during phases 1-2 the
  // court must render none of the four.
  await expect(flightItems(page)).toHaveCount(4);
  await expect(courtCard(page).locator('[data-flight-player]')).toHaveCount(0);
});

test('the court takes ownership once the flight starts', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(ghost(page)).toBeVisible();

  // Phase 3 hands the ids over: the ghost empties, the court fills.
  await expect(courtCard(page).locator('[data-flight-player]')).toHaveCount(4, { timeout: 8000 });
  await expect(ghost(page).locator('[data-flight-player]')).toHaveCount(0);
  // And still exactly four in the document — never eight.
  await expect(flightItems(page)).toHaveCount(4);
});

/* ── phase 2: hold and label ────────────────── */

test('the court label appears in the hold phase, not at the start', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);

  await expect(ghost(page).getByText('Going to Court 1')).toHaveCount(0);
  await expect(ghost(page).getByText('Going to Court 1')).toBeVisible({ timeout: 6000 });
});

test('the group card glows once it is ready to move', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);

  await expect(ghost(page)).not.toHaveClass(/border-lime-500/);
  await expect(ghost(page)).toHaveClass(/border-lime-500/, { timeout: 6000 });
});

/* ── the whole sequence ─────────────────────── */

test('the ghost clears and the court ends up in play', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(ghost(page)).toBeVisible();

  await expect(ghost(page)).toHaveCount(0, { timeout: 12_000 });
  await expect(page.getByRole('button', { name: 'FINISH MATCH' })).toBeVisible();
  await expect(courtCard(page).locator('[data-flight-player]')).toHaveCount(4);
});

test('clicking anywhere skips the sequence', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(ghost(page)).toBeVisible();

  // The skip listener arms after the click that started the sequence has
  // finished propagating, so wait past that before clicking.
  await page.waitForTimeout(600);
  const skippedAt = Date.now();
  await page.getByRole('heading', { name: 'ROSTER' }).click();

  await expect(ghost(page)).toHaveCount(0, { timeout: 4000 });
  expect(Date.now() - skippedAt).toBeLessThan(4000);
  await expect(courtCard(page).locator('[data-flight-player]')).toHaveCount(4);
});

/* ── the assignment is not hostage to the animation ── */

test('the court is committed before the animation finishes', async ({ page }) => {
  const calls = await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(ghost(page)).toBeVisible();

  // Mid-sequence the session write already has the match on Court 1 and the
  // queue emptied. A reload here must not lose the assignment.
  await expect
    .poll(() => calls.lastSessionWrite?.courts?.[0]?.match?.players, { timeout: 5000 })
    .toEqual(['p1', 'p2', 'p3', 'p4']);
  expect(calls.lastSessionWrite.queue).toEqual([]);
});

test('reloading mid-flight shows the true state, not the ghost', async ({ page }) => {
  const calls = await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(ghost(page)).toBeVisible();

  // Session writes are debounced ~600ms, so wait for the assignment to actually
  // reach the server before reloading — otherwise this measures the debounce,
  // not the ghost. Still comfortably mid-sequence.
  await expect
    .poll(() => calls.lastSessionWrite?.courts?.[0]?.match?.players, { timeout: 5000 })
    .toEqual(['p1', 'p2', 'p3', 'p4']);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  await expect(ghost(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'FINISH MATCH' })).toBeVisible();
});

/* ── animations off ─────────────────────────── */

test('with animations off the court fills instantly and no ghost appears', async ({ page }) => {
  const calls = await open(page, { animations: false, sound: false });
  await assignToCourt(page);

  await expect(page.getByRole('button', { name: 'FINISH MATCH' })).toBeVisible();
  await expect(ghost(page)).toHaveCount(0);
  await expect(courtCard(page).locator('[data-flight-player]')).toHaveCount(4);
  await expect
    .poll(() => calls.lastSessionWrite?.courts?.[0]?.match?.players, { timeout: 5000 })
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
  await expect(ghost(page)).toHaveCount(0);
});

test('sound off still plays the full animation', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(ghost(page)).toBeVisible();
  await expect(ghost(page).locator('[data-flight-player]')).toHaveCount(4);
  await expect(ghost(page).getByText('Going to Court 1')).toBeVisible({ timeout: 6000 });
});
