import { test, expect } from '@playwright/test';
import { stubRest, stubRealtime, signIn, VENUE } from './stub-supabase.js';

/* ─────────────────────────────────────────────
   MATCH ROTATION
   Group formation is manual only (spec §2, §8, §12.11). Finishing a match
   dissolves its four players to the back of Available and stops there — no
   re-queue, no auto-assign, no RE-QUEUED state. Nothing moves until staff press
   the single Auto button in the Queue panel, and when they do it fills every
   court it legally can and parks at most one waiting group behind them.
   ───────────────────────────────────────────── */

// Eight players, all the same skill so nothing but the matcher decides:
// p1-p4 are mid-match on Court 1, p5-p8 are free and have not played.
const ROSTER = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((id, i) => ({
  id,
  name: `Player ${i + 1}`,
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
}));

// Stamped fresh per session so "is this the match that was already running?"
// has an unambiguous answer below.
let startedAt = 0;

const midMatchSession = () => {
  startedAt = Date.now() - 10 * 60_000;
  return {
    competitiveMode: true,
    announcement: '',
    onboarded: true,
    matchingStyle: 'balanced',
    courts: [
      {
        id: 1,
        name: 'Court 1',
        type: 'open',
        match: { players: ['p1', 'p2', 'p3', 'p4'], startedAt, endsAt: null },
      },
      { id: 2, name: 'Court 2', type: 'open', match: null },
    ],
    queue: [],
    history: [],
  };
};

/* Read the staff app's own session writes rather than scraping the DOM.
   A court match counts as NEW only when its startedAt differs from the one that
   was already running when the fixture loaded. */
const newCourtGroups = (s) =>
  (s?.courts ?? [])
    .filter((c) => c.match?.players?.length === 4 && c.match.startedAt !== startedAt)
    .map((c) => c.match.players);

const queuedGroups = (s) => (s?.queue ?? []).map((g) => g.players ?? []);

// The Auto button deliberately pauses for ~550ms before it commits, so every
// click has to be followed by a wait on the outcome rather than on the click.
async function pressAuto(page) {
  await page.getByRole('button', { name: 'Auto', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('finishing a match dissolves the four to the roster instead of re-queueing them', async ({ page }) => {
  const calls = await stubRest(page, { players: ROSTER, session: midMatchSession() });
  await stubRealtime(page);
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'FINISH MATCH' })).toBeVisible();
  await page.getByRole('button', { name: 'FINISH MATCH' }).click();
  await page.getByRole('button', { name: /MARK AS WINNER/ }).first().click();

  // The result lands...
  await expect
    .poll(() => calls.lastSessionWrite?.history?.length ?? 0, { timeout: 10_000 })
    .toBe(1);

  // ...and nothing else happens. Both courts are empty and the queue is bare.
  const s = calls.lastSessionWrite;
  expect(queuedGroups(s)).toEqual([]);
  expect(newCourtGroups(s)).toEqual([]);
  expect(s.courts.every((c) => !c.match)).toBe(true);
});

test('there is no Auto ON/OFF switch in the toolbar any more', async ({ page }) => {
  await stubRest(page, { players: ROSTER, session: midMatchSession() });
  await stubRealtime(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Auto (ON|OFF)/ })).toHaveCount(0);
  // Exactly one Auto button, and it lives in the Queue panel.
  await expect(page.getByRole('button', { name: 'Auto', exact: true })).toHaveCount(1);
});

test('Auto fills the free court and parks one waiting group behind it', async ({ page }) => {
  // Court 1 is mid-match with players who are not on the roster, Court 2 is
  // free, and eight are on the bench: four for the court, four to wait.
  const session = midMatchSession();
  session.courts[0].match.players = ['x1', 'x2', 'x3', 'x4'];
  const calls = await stubRest(page, { players: ROSTER, session });
  await stubRealtime(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  await pressAuto(page);

  await expect
    .poll(() => newCourtGroups(calls.lastSessionWrite).length, { timeout: 10_000 })
    .toBe(1);

  const s = calls.lastSessionWrite;
  const onCourt = newCourtGroups(s)[0];
  const waiting = queuedGroups(s);
  expect(onCourt).toHaveLength(4);
  expect(waiting).toHaveLength(1);
  expect(waiting[0]).toHaveLength(4);
  // Every one of the eight is accounted for exactly once.
  expect([...onCourt, ...waiting[0]].sort()).toEqual(
    ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']
  );
});

test('every group Auto creates carries its own formation timestamp', async ({ page }) => {
  const session = midMatchSession();
  session.courts[0].match.players = ['x1', 'x2', 'x3', 'x4'];
  const calls = await stubRest(page, { players: ROSTER, session });
  await stubRealtime(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  const before = Date.now();
  await pressAuto(page);

  await expect
    .poll(() => queuedGroups(calls.lastSessionWrite).length, { timeout: 10_000 })
    .toBe(1);

  const group = calls.lastSessionWrite.queue[0];
  expect(typeof group.createdAt).toBe('number');
  expect(group.createdAt).toBeGreaterThanOrEqual(before);
  // A group that has only just been made reads as "Just now", never "~1347 min".
  await expect(page.getByText('Just now').first()).toBeVisible();
});

test('Auto never puts fewer than four players on a court', async ({ page }) => {
  // Five free players, two empty courts: one court fills, the other waits.
  const session = midMatchSession();
  session.courts[0].match = null;
  const calls = await stubRest(page, { players: ROSTER.slice(0, 5), session });
  await stubRealtime(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  await pressAuto(page);

  await expect
    .poll(() => (calls.lastSessionWrite?.courts ?? []).filter((c) => c.match).length, {
      timeout: 10_000,
    })
    .toBe(1);

  const s = calls.lastSessionWrite;
  expect(s.courts.filter((c) => c.match).every((c) => c.match.players.length === 4)).toBe(true);
  expect(queuedGroups(s)).toEqual([]);
});

test('Auto refuses to group at all with fewer than four players', async ({ page }) => {
  const session = midMatchSession();
  session.courts[0].match = null;
  const calls = await stubRest(page, { players: ROSTER.slice(0, 3), session });
  await stubRealtime(page);
  await page.goto('/');

  const alerts = [];
  page.on('dialog', (d) => { alerts.push(d.message()); d.dismiss(); });

  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  await pressAuto(page);

  await expect.poll(() => alerts.length, { timeout: 10_000 }).toBe(1);
  expect(alerts[0]).toContain('4 players');
  const s = calls.lastSessionWrite;
  expect(queuedGroups(s)).toEqual([]);
  expect((s?.courts ?? []).every((c) => !c.match)).toBe(true);
});

test('24 players rotate through six Auto passes without repeating a partnership', async ({ page }) => {
  const roster = Array.from({ length: 24 }, (_, i) => ({
    ...ROSTER[0],
    id: `q${String(i + 1).padStart(2, '0')}`,
    name: `Q${i + 1}`,
    skill: ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Pro'][i % 5],
  }));
  const session = midMatchSession();
  session.courts[0].match = null;
  session.courts[1].match = null;

  const calls = await stubRest(page, { players: roster, session });
  await stubRealtime(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();

  const groups = new Map();
  const record = (s) => {
    for (const g of s?.queue ?? []) {
      if (g.players?.length === 4) groups.set(g.players.join('|'), g.players);
    }
    for (const c of s?.courts ?? []) {
      if (c.match?.players?.length === 4) groups.set(c.match.players.join('|'), c.match.players);
    }
  };

  for (let round = 0; round < 6; round++) {
    await pressAuto(page);
    await expect
      .poll(() => (calls.lastSessionWrite?.courts ?? []).filter((c) => c.match).length, {
        timeout: 10_000,
      })
      .toBe(2);
    record(calls.lastSessionWrite);

    // Finish both matches so the floor turns over.
    for (let court = 0; court < 2; court++) {
      await page.getByRole('button', { name: 'FINISH MATCH' }).first().click();
      await page.getByRole('button', { name: /MARK AS WINNER/ }).first().click();
      await expect
        .poll(() => calls.lastSessionWrite?.history?.length ?? 0, { timeout: 10_000 })
        .toBe(round * 2 + court + 1);
    }
  }

  const seen = new Set();
  let repeats = 0;
  const uniquePlayers = new Set();
  for (const g of groups.values()) {
    for (const pair of [[g[0], g[1]], [g[2], g[3]]]) {
      const key = [...pair].sort().join('|');
      if (seen.has(key)) repeats += 1;
      seen.add(key);
    }
    g.forEach((id) => uniquePlayers.add(id));
  }

  expect(repeats).toBe(0);
  expect(uniquePlayers.size).toBeGreaterThanOrEqual(12);
});

/* ─────────────────────────────────────────────
   FAILURE VISIBILITY
   Both of these used to fail silently, which is what made them read as missing
   features rather than an out-of-date database.
   ───────────────────────────────────────────── */

test('a rejected win/loss write is surfaced instead of being swallowed', async ({ page }) => {
  const calls = await stubRest(page, { players: ROSTER, session: midMatchSession() });
  calls.state.failRpc = 'record_match_result';
  await stubRealtime(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'FINISH MATCH' }).click();
  await page.getByRole('button', { name: /MARK AS WINNER/ }).first().click();

  await expect(page.getByText('Win/loss results aren’t being saved.')).toBeVisible();
  await expect(page.getByText(/schema\.sql/)).toBeVisible();

  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByText('Win/loss results aren’t being saved.')).toBeHidden();
});

test('a venue with no slug explains the missing QR instead of hiding it', async ({ page }) => {
  await stubRest(page, {
    players: ROSTER,
    session: midMatchSession(),
    venue: { ...VENUE, slug: null },
  });
  await stubRealtime(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Display Link' }).click();
  await expect(page.getByText('No printable QR code yet.')).toBeVisible();
  await expect(page.getByText(/schema\.sql/)).toBeVisible();
});

test('a venue with a slug still shows the printable QR poster', async ({ page }) => {
  await stubRest(page, { players: ROSTER, session: midMatchSession() });
  await stubRealtime(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Display Link' }).click();
  await expect(page.getByText('SCAN FOR THE LIVE QUEUE')).toBeVisible();
  await expect(page.locator('.cf-print svg').first()).toBeVisible();
  await expect(page.getByText('No printable QR code yet.')).toHaveCount(0);
});
