import { test, expect } from '@playwright/test';
import { stubRest, stubRealtime, signIn } from './stub-supabase.js';

/* ─────────────────────────────────────────────
   PLAYER VALUE SYSTEM (spec §1, §4, §5, §6)
   The value itself is derived from the session win/loss counters, so these
   fixtures set `wins`/`losses` on the roster rows and the app computes the rest.
   Covers the parts a pure-logic test cannot reach: what is on screen, what is
   deliberately NOT on screen, and the queue replacement path.
   ───────────────────────────────────────────── */

// wins - losses/2, so the value is spelled out in each comment.
function row(id, name, wins, losses) {
  return {
    id,
    name,
    skill: 'Intermediate',
    wins,
    losses,
    total_wins: wins,
    total_losses: losses,
    total_games: wins + losses,
    photo_url: null,
    payment: 'cash',
    checked_in_at: new Date().toISOString(),
    checked_out_at: null,
  };
}

/* Fixture A — spread values, for the hidden-value and replacement tests. */
const VALUE_ROSTER = [
  row('p1', 'Ann Alpha', 4, 0), // value  4
  row('p2', 'Ben Bravo', 2, 0), // value  2   ← the one who leaves
  row('p3', 'Cal Charlie', 1, 1), // value  0.5
  row('p4', 'Dee Delta', 0, 2), // value -1
  row('p5', 'Eve Echo', 5, 0), // value  5   free
  row('p6', 'Fay Foxtrot', 2, 0), // value  2   free — the match for Ben
  row('p7', 'Gus Golf', 0, 0), // value  0   free
  row('p8', 'Hal Hotel', 0, 0), // value  0   free
];

/* Fixture B — counters and history that agree with each other, so the streak
   chips are readable off the same games that produced the W/L columns:
     g1  p1,p2 beat p3,p4      g2  p1,p3 beat p2,p4      g3  p1,p2 beat p3,p4
   → Ann 3W-0L WWW · Ben 2W-1L WLW · Cal 1W-2L LWL · Dee 0W-3L LLL
   Eve has never played and must not appear at all. */
const RANKED_ROSTER = [
  row('p1', 'Ann Alpha', 3, 0),
  row('p2', 'Ben Bravo', 2, 1),
  row('p3', 'Cal Charlie', 1, 2),
  row('p4', 'Dee Delta', 0, 3),
  row('p5', 'Eve Echo', 0, 0),
];

const decided = (id, winners, losers) => ({
  id,
  players: [...winners, ...losers],
  winners,
  losers,
  finishedAt: id,
  duration: 60_000,
});

// Auto-Filling off so the queue stays put while a test drives it by hand.
const baseSession = (history = []) => ({
  competitiveMode: true,
  autoAssign: false,
  announcement: '',
  onboarded: true,
  matchingStyle: 'balanced',
  courts: [{ id: 1, name: 'Court 1', type: 'open', match: null }],
  queue: [{ id: 'g1', players: ['p1', 'p2', 'p3', 'p4'], type: 'manual' }],
  history,
});

// Newest first, the order App.jsx keeps history in.
const RANKED_HISTORY = [
  decided(3, ['p1', 'p2'], ['p3', 'p4']),
  decided(2, ['p1', 'p3'], ['p2', 'p4']),
  decided(1, ['p1', 'p2'], ['p3', 'p4']),
];

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

async function openApp(page, opts = {}) {
  const calls = await stubRest(page, {
    players: VALUE_ROSTER,
    session: baseSession(),
    ...opts,
  });
  await stubRealtime(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  return calls;
}

// The ranking board, scoped so nothing behind the overlay can satisfy an
// assertion — the roster underneath stays in the DOM while a modal is open.
async function openRankings(page, opts = {}) {
  const calls = await openApp(page, {
    players: RANKED_ROSTER,
    session: baseSession(RANKED_HISTORY),
    ...opts,
  });
  await page.getByRole('button', { name: 'Session Rank' }).click();
  const dialog = page.getByRole('dialog', { name: 'Session Rankings' });
  await expect(dialog).toBeVisible();
  return { calls, dialog };
}

/* ── §1 the value is hidden by default ──────── */

test('the hidden value is invisible until staff reveal it', async ({ page }) => {
  await openApp(page);

  const toggle = page.getByRole('button', { name: 'Values' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  // Ann is on +4. Nothing on the roster may say so yet.
  const ann = page.locator('div').filter({ hasText: /^Ann Alpha/ }).first();
  await expect(ann).not.toContainText('+4');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTitle(/Hidden match value/).first()).toBeVisible();
  await expect(page.getByText('+4', { exact: true })).toBeVisible();
  await expect(page.getByText('-1', { exact: true })).toBeVisible();

  // And it goes away again — this is a peek, not a mode.
  await toggle.click();
  await expect(page.getByTitle(/Hidden match value/)).toHaveCount(0);
});

test('the value toggle does not survive a reload', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Values' }).click();
  await expect(page.getByTitle(/Hidden match value/).first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  await expect(page.getByTitle(/Hidden match value/)).toHaveCount(0);
});

/* ── §6 session rankings ────────────────────── */

test('Session Rankings ranks on today’s wins', async ({ page }) => {
  const { dialog } = await openRankings(page);
  const names = await dialog.locator('span.flex-1.min-w-0').allInnerTexts();
  expect(names).toEqual(['Ann Alpha', 'Ben Bravo', 'Cal Charlie', 'Dee Delta']);
});

test('Session Rankings shows each player’s streak, newest first', async ({ page }) => {
  const { dialog } = await openRankings(page);
  const streaks = await dialog.locator('span.w-28.flex').allInnerTexts();
  expect(streaks.map((s) => s.replace(/\s+/g, ''))).toEqual(['WWW', 'WLW', 'LWL', 'LLL']);
});

test('Session Rankings shows the session W/L, not the all-time totals', async ({ page }) => {
  const { dialog } = await openRankings(page);
  const records = await dialog.locator('span.w-16.font-mono').allInnerTexts();
  expect(records.map((s) => s.replace(/\s+/g, ''))).toEqual(['3—0', '2—1', '1—2', '0—3']);
});

test('Session Rankings leaves out anyone who has not played', async ({ page }) => {
  const { dialog } = await openRankings(page);
  // Eve is on 0W-0L. She is on the roster behind the modal, so this has to be
  // scoped to the dialog to mean anything.
  await expect(dialog.getByText('Eve Echo')).toHaveCount(0);
  await expect(dialog.locator('span.flex-1.min-w-0')).toHaveCount(4);
});

test('Session Rankings never shows the hidden value', async ({ page }) => {
  // Reveal values first: even with the staff peek ON, the ranking must not leak
  // them — the toggle is a roster affordance only.
  await openApp(page, { players: RANKED_ROSTER, session: baseSession(RANKED_HISTORY) });
  await page.getByRole('button', { name: 'Values' }).click();
  await page.getByRole('button', { name: 'Session Rank' }).click();
  const dialog = page.getByRole('dialog', { name: 'Session Rankings' });
  await expect(dialog).toBeVisible();

  await expect(dialog.getByTitle(/Hidden match value/)).toHaveCount(0);
  // Cal is on 0 and Dee on -1.5 — neither number may appear on this board.
  await expect(dialog.getByText('-1.5', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('+2', { exact: true })).toHaveCount(0);
});

/* ── §4 replacement by closest value ────────── */

// Free players are Eve (5), Fay (2), Gus (0), Hal (0); Ben is on 2, so Fay is
// the closest match — and deliberately not the first free player in roster
// order, so "closest" cannot be confused with "first".
async function startReplacing(page) {
  const calls = await openApp(page);
  await page.getByRole('button', { name: 'Remove Ben Bravo from queue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replace Ben Bravo?' });
  await expect(dialog).toBeVisible();
  return { calls, dialog };
}

const queueAfter = (calls) =>
  expect.poll(() => calls.lastSessionWrite?.queue?.[0]?.players, { timeout: 10_000 });

test('removing a queued player asks who takes the spot instead of deciding', async ({ page }) => {
  const { calls, dialog } = await startReplacing(page);

  // Nothing has changed yet — the group still has Ben in it.
  await expect(dialog).toContainText('group #1');
  expect(calls.lastSessionWrite?.queue?.[0]?.players).toEqual(['p1', 'p2', 'p3', 'p4']);
});

test('the closest-value stand-in is offered, and takes the same slot', async ({ page }) => {
  const { calls, dialog } = await startReplacing(page);

  await dialog.getByRole('button', { name: /Closest match — Fay Foxtrot/ }).click();
  await queueAfter(calls).toEqual(['p1', 'p6', 'p3', 'p4']);
});

test('a random draw fills the spot from anyone available', async ({ page }) => {
  const { calls, dialog } = await startReplacing(page);

  await dialog.getByRole('button', { name: /Random draw/ }).click();
  // The group is already four long, so polling on length would pass against the
  // write from BEFORE the click. Wait for Ben to actually be gone.
  await expect
    .poll(() => calls.lastSessionWrite?.queue?.[0]?.players?.[1], { timeout: 10_000 })
    .not.toBe('p2');

  const players = calls.lastSessionWrite.queue[0].players;
  // Whoever it is must have been free, and must land in Ben's slot.
  expect(['p5', 'p6', 'p7', 'p8']).toContain(players[1]);
  expect([players[0], players[2], players[3]]).toEqual(['p1', 'p3', 'p4']);
});

test('staff can pick any available player by hand', async ({ page }) => {
  const { calls, dialog } = await startReplacing(page);

  // Eve is on 5 — the furthest thing from Ben's 2, so this can only be a
  // deliberate choice overriding the suggestion.
  await dialog.getByRole('button', { name: /Eve Echo/ }).click();
  await queueAfter(calls).toEqual(['p1', 'p5', 'p3', 'p4']);
});

test('the replacement picker offers everyone free, and no values', async ({ page }) => {
  await openApp(page);
  // Turn the staff value peek ON first: it must not reach into this picker.
  await page.getByRole('button', { name: 'Values' }).click();
  await page.getByRole('button', { name: 'Remove Ben Bravo from queue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replace Ben Bravo?' });
  await expect(dialog).toBeVisible();

  // The scrolling pick list, not the shortcut buttons above it — Fay is the
  // suggestion AND a list entry, which is correct but would double-count.
  const list = dialog.locator('div.max-h-44');
  await expect(list.getByRole('button')).toHaveCount(4);
  for (const name of ['Eve Echo', 'Fay Foxtrot', 'Gus Golf', 'Hal Hotel']) {
    await expect(list.getByRole('button', { name: new RegExp(name) })).toHaveCount(1);
  }
  // Ben is leaving, so he cannot be his own replacement; the rest of his group
  // are still busy.
  await expect(dialog.getByRole('button', { name: /Ben Bravo/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /Ann Alpha/ })).toHaveCount(0);

  await expect(dialog.getByTitle(/Hidden match value/)).toHaveCount(0);
  await expect(dialog.getByText('+2', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('+5', { exact: true })).toHaveCount(0);
});

test('staff can leave the spot open', async ({ page }) => {
  const { calls, dialog } = await startReplacing(page);

  await dialog.getByRole('button', { name: 'Leave the spot open' }).click();
  await queueAfter(calls).toEqual(['p1', 'p3', 'p4']);
});

test('dismissing the picker leaves the group untouched', async ({ page }) => {
  const { calls, dialog } = await startReplacing(page);

  // The X in ModalShell's header — backing out must not be a silent "remove".
  await dialog.locator('button').first().click();

  await expect(dialog).toHaveCount(0);
  expect(calls.lastSessionWrite?.queue?.[0]?.players).toEqual(['p1', 'p2', 'p3', 'p4']);
});

test('a queued player is dropped rather than replaced when nobody is free', async ({ page }) => {
  // Only the four already queued exist, so there is no stand-in to find.
  const calls = await stubRest(page, {
    players: VALUE_ROSTER.slice(0, 4),
    session: baseSession(),
  });
  await stubRealtime(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();

  await page.getByRole('button', { name: 'Remove Ben Bravo from queue' }).click();

  await expect
    .poll(() => calls.lastSessionWrite?.queue?.[0]?.players, { timeout: 10_000 })
    .toEqual(['p1', 'p3', 'p4']);
});

/* ── §5 reset warns about values ────────────── */

test('Reset asks about values before clearing the session', async ({ page }) => {
  await openApp(page);

  const messages = [];
  page.on('dialog', (d) => {
    messages.push(d.message());
    d.dismiss();
  });
  await page.getByRole('button', { name: 'Reset' }).click();

  await expect.poll(() => messages).toEqual(['Start a new session? All player values will reset to 0.']);
});
