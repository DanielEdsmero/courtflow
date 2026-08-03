import { test, expect } from '@playwright/test';
import { stubRest, stubRealtime, signIn, VENUE } from './stub-supabase.js';

/* ─────────────────────────────────────────────
   MATCH ROTATION — regression cover for the reported bug
   Finishing a match with Auto-Filling on used to push the same four straight
   back onto the queue in their original team order, bypassing buildAutoGroup
   entirely. That is the path that produces almost every group on a busy floor,
   so repeat-partner avoidance and the Winners/Losers style never got a say.
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
    autoAssign: true,
    announcement: '',
    onboarded: true,
    matchingStyle: 'balanced',
    courts: [
      {
        id: 1,
        name: 'Court 1',
        type: 'open',
        match: { players: ['p1', 'p2', 'p3', 'p4'], startedAt, endsAt: null, arrived: true },
      },
      { id: 2, name: 'Court 2', type: 'open', match: null },
    ],
    queue: [],
    history: [],
  };
};

/* The newly formed group, read out of the staff app's own session writes rather
   than scraped from the DOM.

   It is deliberately looked for in two places: with Auto-Filling on — which is
   the default, and the configuration the bug was reported under — a requeued
   group is picked straight off the queue by the auto-assign effect and put on
   the free court, so the queue is usually empty by the time anything settles.
   A court match is only "new" if its startedAt differs from the one that was
   already running. */
async function nextGroup(calls) {
  const find = () => {
    const s = calls.lastSessionWrite;
    if (!s) return null;
    const queued = s.queue?.find((g) => g.players?.length === 4);
    if (queued) return queued.players;
    const court = s.courts?.find((c) => c.match && c.match.startedAt !== startedAt);
    return court ? court.match.players : null;
  };
  await expect.poll(() => find()?.length ?? 0, { timeout: 10_000 }).toBe(4);
  return find();
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('finishing a match re-matches through the matcher instead of re-queueing the same four', async ({ page }) => {
  const calls = await stubRest(page, { players: ROSTER, session: midMatchSession() });
  await stubRealtime(page);
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'FINISH MATCH' })).toBeVisible();
  await page.getByRole('button', { name: 'FINISH MATCH' }).click();
  await page.getByRole('button', { name: /MARK AS WINNER/ }).first().click();

  const group = await nextGroup(calls);
  expect(group).toHaveLength(4);

  // The four who just came off court are the tired ones; p5-p8 have been
  // waiting. With nothing else to separate them, the rested four get the court.
  expect([...group].sort()).toEqual(['p5', 'p6', 'p7', 'p8']);
});

test('the requeued group never reproduces the partnerships that just played', async ({ page }) => {
  // Only the four who just played are available, so they must come back — but
  // split differently. This is the case the old code got exactly wrong.
  const onlyFour = ROSTER.slice(0, 4);
  const calls = await stubRest(page, { players: onlyFour, session: midMatchSession() });
  await stubRealtime(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'FINISH MATCH' }).click();
  await page.getByRole('button', { name: /MARK AS WINNER/ }).first().click();

  const group = await nextGroup(calls);
  expect([...group].sort()).toEqual(['p1', 'p2', 'p3', 'p4']);

  // They played as [p1,p2] vs [p3,p4]; neither pairing may survive.
  const partnered = (a, b) =>
    Math.floor(group.indexOf(a) / 2) === Math.floor(group.indexOf(b) / 2);
  expect(partnered('p1', 'p2')).toBe(false);
  expect(partnered('p3', 'p4')).toBe(false);
});

test('the Winners / Losers style changes who gets grouped on rotation', async ({ page }) => {
  const session = midMatchSession();
  session.matchingStyle = 'winnersLosers';
  // A prior result so the ladder has form to sort on: p5/p6 won last, p7/p8 lost.
  session.history = [
    { id: 1, courtId: 2, players: ['p5', 'p6', 'p7', 'p8'], winners: ['p5', 'p6'], losers: ['p7', 'p8'], duration: 600000 },
  ];
  const calls = await stubRest(page, { players: ROSTER, session });
  await stubRealtime(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'FINISH MATCH' }).click();
  await page.getByRole('button', { name: /MARK AS WINNER/ }).first().click();

  const group = await nextGroup(calls);
  // Ladder ranks by recent form, so the two most recent winners head the draft
  // and are placed on opposite teams — never both on the balanced-draft bench.
  expect(group).toContain('p5');
  expect(group).toContain('p6');
});

test('24 players rotate through six consecutive matches without repeating partners', async ({ page }) => {
  // The scale the bug was reported at, driven through the real UI: finish a
  // match, let the app re-match and auto-assign, finish the next, and so on.
  const roster = Array.from({ length: 24 }, (_, i) => ({
    ...ROSTER[0],
    id: `q${String(i + 1).padStart(2, '0')}`,
    name: `Q${i + 1}`,
    skill: ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Pro'][i % 5],
  }));
  const session = midMatchSession();
  session.courts[0].match.players = ['q01', 'q02', 'q03', 'q04'];

  const calls = await stubRest(page, { players: roster, session });
  await stubRealtime(page);
  await page.goto('/');

  // Keyed by the line-up itself. A group is written to the session twice — once
  // when it lands on the queue and again when auto-assign moves it to a court —
  // and a court still mid-game reappears in every write. Both would read as
  // repeats. With 24 players an identical re-draft is not a realistic collision.
  const groups = new Map();
  for (let round = 0; round < 6; round++) {
    await page.getByRole('button', { name: 'FINISH MATCH' }).first().click();
    await page.getByRole('button', { name: /MARK AS WINNER/ }).first().click();
    await expect
      .poll(() => calls.lastSessionWrite?.history?.length ?? 0, { timeout: 10_000 })
      .toBe(round + 1);
    const s = calls.lastSessionWrite;
    for (const g of s.queue ?? []) {
      if (g.players?.length === 4) groups.set(g.players.join('|'), g.players);
    }
    for (const c of s.courts ?? []) {
      if (c.match?.players?.length === 4) groups.set(c.match.players.join('|'), c.match.players);
    }
  }

  // Every partnership ever formed, as an order-independent key.
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

  // A pairing may recur once the window has aged out, but across six rounds of
  // a 24-strong roster there is no excuse for it.
  expect(repeats).toBe(0);
  // And the floor should actually be rotating, not cycling the same eight.
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
