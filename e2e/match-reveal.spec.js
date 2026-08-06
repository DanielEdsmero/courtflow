import { test, expect } from '@playwright/test';
import { stubRest, stubRealtime, signIn } from './stub-supabase.js';

/* ─────────────────────────────────────────────
   MATCH REVEAL + SETTINGS
   The reveal is a ~7s full-screen overlay, so these specs mostly assert on
   TIMING and on the fact that state is committed independently of it — the
   whole design rests on the court being assigned before the animation starts.
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
// drives the assignment itself rather than racing the auto-assign effect.
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

// Queue → "Assign to court" → pick a duration on Court 1.
async function assignToCourt(page) {
  await page.getByRole('button', { name: /Assign to court/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign to court' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
}

const overlay = (page) => page.locator('[data-match-reveal]');

/* ── the sequence ───────────────────────────── */

test('assigning a court plays the reveal with all four players', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);

  await expect(overlay(page)).toBeVisible();
  await expect(overlay(page).locator('[data-reveal-card]')).toHaveCount(4);
  for (const name of ['Ann Alpha', 'Ben Bravo', 'Cal Charlie', 'Dee Delta']) {
    await expect(overlay(page).getByText(name)).toBeVisible();
  }
});

test('every player shows an avatar, not just a name', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);

  // These four have no photo_url, so each avatar is the initials disc. Either
  // way there must be exactly one avatar per card.
  const cards = overlay(page).locator('[data-reveal-card]');
  await expect(cards).toHaveCount(4);
  for (const initials of ['AA', 'BB', 'CC', 'DD']) {
    await expect(overlay(page).getByText(initials, { exact: true })).toBeVisible();
  }
});

test('the four stay on screen for at least five seconds', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  const started = Date.now();
  await assignToCourt(page);
  await expect(overlay(page)).toBeVisible();

  // Still showing all four at the 5s mark — the minimum the brief asks for.
  await page.waitForTimeout(5000 - (Date.now() - started));
  await expect(overlay(page).locator('[data-reveal-card]')).toHaveCount(4);
});

test('the court label appears during the hold phase, not at the start', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);

  // Phase 1 is the deal; "Matched!" belongs to phase 2 at the 4s mark.
  await expect(overlay(page).getByText('Matched!')).toHaveCount(0);
  await expect(overlay(page).getByText('Matched!')).toBeVisible({ timeout: 8000 });
  await expect(overlay(page).getByText('Going to Court 1')).toBeVisible();
});

test('the overlay clears itself and the court ends up in play', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(overlay(page)).toBeVisible();

  await expect(overlay(page)).toHaveCount(0, { timeout: 12_000 });
  await expect(page.getByRole('button', { name: 'FINISH MATCH' })).toBeVisible();
});

test('clicking anywhere skips the sequence', async ({ page }) => {
  await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(overlay(page)).toBeVisible();

  const skippedAt = Date.now();
  await overlay(page).click({ position: { x: 10, y: 10 } });
  await expect(overlay(page)).toHaveCount(0, { timeout: 4000 });
  // Well inside the ~7s the full sequence would have taken.
  expect(Date.now() - skippedAt).toBeLessThan(4000);
});

/* ── the assignment is not hostage to the animation ── */

test('the court is committed before the animation finishes', async ({ page }) => {
  const calls = await open(page, { animations: true, sound: false });
  await assignToCourt(page);
  await expect(overlay(page)).toBeVisible();

  // Still mid-sequence, but the session write already has the match on Court 1
  // and the queue emptied. A reload here must not lose the assignment.
  await expect
    .poll(() => calls.lastSessionWrite?.courts?.[0]?.match?.players, { timeout: 5000 })
    .toEqual(['p1', 'p2', 'p3', 'p4']);
  expect(calls.lastSessionWrite.queue).toEqual([]);
});

/* ── animations off ─────────────────────────── */

test('with animations off the court fills instantly and no overlay appears', async ({ page }) => {
  const calls = await open(page, { animations: false, sound: false });
  await assignToCourt(page);

  await expect(page.getByRole('button', { name: 'FINISH MATCH' })).toBeVisible();
  await expect(overlay(page)).toHaveCount(0);
  // The session write is debounced, so poll rather than reading it the instant
  // the button appears.
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

  // Turning sound off must leave animations alone.
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
  await expect(overlay(page).getByText('Matched!')).toBeVisible({ timeout: 8000 });
});
