import { test, expect } from '@playwright/test';
import { stubRest, stubRealtime, signIn, VENUE } from './stub-supabase.js';

/* ─────────────────────────────────────────────
   MATCH ROTATION
   Two staff actions, and the split between them is the point.

   Auto-group Available builds matchups. It turns every Available player it can
   into a complete four in the QUEUE, and it never touches a court: nobody starts
   playing, no timer starts, no reveal animation runs.

   Assign to court is the only thing that starts a match, and staff do it group
   by group. Finishing a match dissolves those four back to Available — there is
   no re-queue and no RE-QUEUED state.
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
  await page.getByRole('button', { name: 'Auto-group Available' }).click();
}

// Assign the Nth queued group to a court through the real dialog.
async function assignGroup(page, index = 0) {
  await page.getByRole('button', { name: 'Assign to court' }).nth(index).click();
  const dialog = page.getByRole('dialog', { name: 'Assign to court' });
  await dialog.getByRole('button', { name: 'Open', exact: true }).first().click();
}

const busyCourts = (s) => (s?.courts ?? []).filter((c) => c.match).length;

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

test('there is one Auto action and it does not mention courts', async ({ page }) => {
  await stubRest(page, { players: ROSTER, session: midMatchSession() });
  await stubRealtime(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Auto (ON|OFF)/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Auto-group Available' })).toHaveCount(1);
  await expect(
    page.getByText('Creates all possible 4-player matchups. Staff assigns groups to open courts.')
  ).toBeVisible();
});

/* ─────────────────────────────────────────────
   THE SCREENSHOT REGRESSION
   Two courts playing, one complete group already queued, eight on the bench.
   This is the exact state that used to answer "Nothing to do — courts are busy
   and a group is already waiting".
   ───────────────────────────────────────────── */
test('Auto groups all eight benched players even with both courts busy and a group waiting', async ({ page }) => {
  const roster = Array.from({ length: 20 }, (_, i) => ({
    ...ROSTER[0],
    id: `r${String(i + 1).padStart(2, '0')}`,
    name: `R${i + 1}`,
  }));
  const session = midMatchSession();
  // Eight on court, four already queued, eight free.
  session.courts[0].match.players = ['r01', 'r02', 'r03', 'r04'];
  session.courts[1] = {
    id: 2,
    name: 'Court 2',
    type: 'open',
    match: { players: ['r05', 'r06', 'r07', 'r08'], startedAt, endsAt: null },
  };
  session.queue = [
    { id: 'existing', players: ['r09', 'r10', 'r11', 'r12'], type: 'auto', createdAt: 1 },
  ];

  const calls = await stubRest(page, { players: roster, session });
  await stubRealtime(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();

  await pressAuto(page);

  // Three complete groups: the one that was already there, plus two new ones.
  await expect.poll(() => queuedGroups(calls.lastSessionWrite).length, { timeout: 10_000 }).toBe(3);

  const s = calls.lastSessionWrite;
  expect(queuedGroups(s).every((g) => g.length === 4)).toBe(true);
  // The existing group keeps its place at the head of the queue, untouched.
  expect(s.queue[0].id).toBe('existing');
  expect(s.queue[0].players).toEqual(['r09', 'r10', 'r11', 'r12']);
  // Every one of the twenty is now either playing or queued — nobody is left.
  expect(queuedGroups(s).flat().sort()).toEqual(roster.slice(8).map((p) => p.id).sort());
  // The courts were not touched: same players, same clock.
  expect(newCourtGroups(s)).toEqual([]);
  expect(s.courts[0].match.players).toEqual(['r01', 'r02', 'r03', 'r04']);
  expect(s.courts[1].match.players).toEqual(['r05', 'r06', 'r07', 'r08']);
  // And it says what it did, without a blocking dialog.
  await expect(page.getByRole('status')).toContainText('Courts were not changed');
});

test('Auto never starts a match, even with every court free', async ({ page }) => {
  const session = midMatchSession();
  session.courts[0].match = null;
  const calls = await stubRest(page, { players: ROSTER, session });
  await stubRealtime(page);
  await page.goto('/');

  const alerts = [];
  page.on('dialog', (d) => { alerts.push(d.message()); d.dismiss(); });

  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  await pressAuto(page);

  await expect.poll(() => queuedGroups(calls.lastSessionWrite).length, { timeout: 10_000 }).toBe(2);

  const s = calls.lastSessionWrite;
  // Two groups waiting, both courts still empty, no reveal, no dialog.
  expect(queuedGroups(s).every((g) => g.length === 4)).toBe(true);
  expect(busyCourts(s)).toBe(0);
  expect(alerts).toEqual([]);
  await expect(page.getByText('Matched!')).toHaveCount(0);
});

test('Auto leaves a remainder of fewer than four on the bench and says so', async ({ page }) => {
  const session = midMatchSession();
  session.courts[0].match = null;
  const calls = await stubRest(page, { players: ROSTER.slice(0, 7), session });
  await stubRealtime(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  await pressAuto(page);

  await expect.poll(() => queuedGroups(calls.lastSessionWrite).length, { timeout: 10_000 }).toBe(1);
  expect(queuedGroups(calls.lastSessionWrite)[0]).toHaveLength(4);
  await expect(page.getByRole('status')).toContainText('3 players still Available');
});

test('Auto reports honestly when it cannot build anything', async ({ page }) => {
  const session = midMatchSession();
  session.courts[0].match = null;
  const calls = await stubRest(page, { players: ROSTER.slice(0, 3), session });
  await stubRealtime(page);
  await page.goto('/');

  const alerts = [];
  page.on('dialog', (d) => { alerts.push(d.message()); d.dismiss(); });

  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  await pressAuto(page);

  await expect(page.getByRole('status')).toContainText('No additional full groups can be created');
  expect(alerts).toEqual([]);
  expect(queuedGroups(calls.lastSessionWrite)).toEqual([]);
  expect(busyCourts(calls.lastSessionWrite)).toBe(0);
});

test('pressing Auto twice changes nothing the second time', async ({ page }) => {
  const session = midMatchSession();
  session.courts[0].match = null;
  const calls = await stubRest(page, { players: ROSTER, session });
  await stubRealtime(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  await pressAuto(page);
  await expect.poll(() => queuedGroups(calls.lastSessionWrite).length, { timeout: 10_000 }).toBe(2);
  const first = JSON.stringify(calls.lastSessionWrite.queue);

  await pressAuto(page);
  await expect(page.getByRole('status')).toContainText('No additional full groups can be created');
  expect(JSON.stringify(calls.lastSessionWrite.queue)).toBe(first);
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

  await expect.poll(() => queuedGroups(calls.lastSessionWrite).length, { timeout: 10_000 }).toBe(2);

  for (const g of calls.lastSessionWrite.queue) {
    expect(typeof g.createdAt).toBe('number');
    expect(g.createdAt).toBeGreaterThanOrEqual(before);
  }
  // A group that has only just been made reads as "Just now", never "~1347 min".
  await expect(page.getByText('Just now').first()).toBeVisible();
});

/* ─────────────────────────────────────────────
   MANUAL COURT ASSIGNMENT — the only way to start a match
   ───────────────────────────────────────────── */
test('assigning a queued group starts exactly that match and leaves the rest queued', async ({ page }) => {
  const session = midMatchSession();
  session.courts[0].match = null;
  const calls = await stubRest(page, { players: ROSTER, session });
  await stubRealtime(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();
  await pressAuto(page);
  await expect.poll(() => queuedGroups(calls.lastSessionWrite).length, { timeout: 10_000 }).toBe(2);

  const queued = queuedGroups(calls.lastSessionWrite);
  const [first, second] = queued;

  await assignGroup(page, 0);

  await expect.poll(() => busyCourts(calls.lastSessionWrite), { timeout: 10_000 }).toBe(1);
  const s = calls.lastSessionWrite;
  const playing = s.courts.find((c) => c.match).match;
  // Exactly those four, in exactly that order — no re-matching on the way out.
  expect(playing.players).toEqual(first);
  expect(typeof playing.startedAt).toBe('number');
  // The other group is untouched and still waiting.
  expect(queuedGroups(s)).toEqual([second]);
});

test('24 players group in one press and rotate through six staff-assigned rounds', async ({ page }) => {
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

  // One press turns all 24 into six waiting groups. No court moves.
  await pressAuto(page);
  await expect.poll(() => queuedGroups(calls.lastSessionWrite).length, { timeout: 10_000 }).toBe(6);
  expect(busyCourts(calls.lastSessionWrite)).toBe(0);

  const groups = new Map();
  for (const g of calls.lastSessionWrite.queue) groups.set(g.players.join('|'), g.players);

  for (let round = 0; round < 3; round++) {
    // Staff put the front two groups on the two courts, by hand.
    for (let court = 0; court < 2; court++) {
      await assignGroup(page, 0);
      await expect
        .poll(() => busyCourts(calls.lastSessionWrite), { timeout: 10_000 })
        .toBe(court + 1);
    }
    for (let court = 0; court < 2; court++) {
      await page.getByRole('button', { name: 'FINISH MATCH' }).first().click();
      await page.getByRole('button', { name: /MARK AS WINNER/ }).first().click();
      await expect
        .poll(() => calls.lastSessionWrite?.history?.length ?? 0, { timeout: 10_000 })
        .toBe(round * 2 + court + 1);
    }
  }

  // Every partnership the session produced, as an order-independent key.
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
  expect(uniquePlayers.size).toBe(24);
});

/* ─────────────────────────────────────────────
   MATCHER DIAGNOSTICS — staff only, and off by default
   The badge explains which matching rules a group had to bend. That is staff
   reasoning about hidden Values and past opponents, so it must never reach the
   Preview tab, the TV or the public club board.
   ───────────────────────────────────────────── */
async function setDiagnostics(page, on) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const row = page.getByRole('menuitemcheckbox', { name: /Matcher diagnostics/ });
  if ((await row.getAttribute('aria-checked')) !== String(on)) await row.click();
  await expect(row).toHaveAttribute('aria-checked', String(on));
  await page.keyboard.press('Escape');
}

test('matcher diagnostics are off until staff turn them on', async ({ page }) => {
  const session = midMatchSession();
  session.courts[0].match = null;
  await stubRest(page, { players: ROSTER, session });
  await stubRealtime(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();

  await pressAuto(page);
  await expect(page.getByText('Auto-grouped').first()).toBeVisible();
  // Nothing about the matcher on screen until it is asked for.
  await expect(page.getByText(/^Matcher:/)).toHaveCount(0);

  await setDiagnostics(page, true);
  await expect(page.getByText(/^Matcher:/).first()).toBeVisible();
  await expect(page.getByText('Matcher: strict — cooldown clear').first()).toBeVisible();
});

test('diagnostics never appear in Preview, and never reach the shared session', async ({ page }) => {
  const session = midMatchSession();
  session.courts[0].match = null;
  const calls = await stubRest(page, { players: ROSTER, session });
  await stubRealtime(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();

  await setDiagnostics(page, true);
  await pressAuto(page);
  await expect(page.getByText(/^Matcher:/).first()).toBeVisible();

  // Preview renders exactly what the TV and the club board render.
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText(/^Matcher:/)).toHaveCount(0);

  // And the blob that is written and broadcast carries none of it either —
  // not the badge text, not the constraint level, not the conflicting pairs.
  const blob = JSON.stringify(calls.lastSessionWrite ?? {});
  expect(blob).not.toMatch(/Matcher:/);
  expect(blob).not.toMatch(/constraintLevel/);
  expect(blob).not.toMatch(/cooldownConflictPairs/);
  expect(blob).not.toMatch(/fallbackReason/);
  // The queue groups themselves carry only what the public board needs.
  for (const g of calls.lastSessionWrite.queue ?? []) {
    expect(Object.keys(g).sort()).toEqual(['createdAt', 'id', 'players', 'preferredCourt', 'type']);
  }
});

test('a fresh group reads "Just now", never a four-digit minute count', async ({ page }) => {
  // A group carried over from a previous day used to render "1139 min"; the
  // relative-time ladder now rolls anything past an hour up.
  const session = midMatchSession();
  session.courts[0].match = null;
  session.queue = [
    {
      id: 'overnight',
      players: ['p5', 'p6', 'p7', 'p8'],
      type: 'auto',
      createdAt: Date.now() - 19 * 60 * 60 * 1000,
    },
  ];
  await stubRest(page, { players: ROSTER, session });
  await stubRealtime(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ROSTER' })).toBeVisible();

  await expect(page.getByText('19h 0m')).toBeVisible();
  await expect(page.getByText(/\d{3,} min/)).toHaveCount(0);

  await pressAuto(page);
  await expect(page.getByText('Just now').first()).toBeVisible();
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
