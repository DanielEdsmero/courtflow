import { test, expect } from '@playwright/test';
import {
  stubRest,
  signIn,
  PLAYERS,
  MATCH_HISTORY_COUNT,
  PLAYER_GAMES_SUM,
} from './stub-supabase.js';

/* ─────────────────────────────────────────────
   /leaderboard — all-time rankings (spec §F3)
   ───────────────────────────────────────────── */

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// The stat cards. Matched on a text substring rather than an anchored regex:
// each label renders as "{icon} TOTAL GAMES", so the text starts with a space.
const statCard = (page, label) => page.locator('.rounded-xl').filter({ hasText: label }).first();

// The heading and both stat cards paint before the fetch resolves, so anything
// asserting on loaded data has to wait for the data itself.
const loaded = (page) => expect(page.getByText('Ben Franklin')).toBeVisible();

test.describe('stat cards', () => {
  test('Total Games comes from match_history, not the per-player sum', async ({ page }) => {
    await stubRest(page);
    await page.goto('/leaderboard');
    await loaded(page);

    const card = statCard(page, 'TOTAL GAMES');
    await expect(card).toContainText(String(MATCH_HISTORY_COUNT)); // 21 venue matches
    // The bug this guards: allTimeLeaderboard().totalGames sums player-games and
    // reads ~4x higher for doubles. 67 must never appear here.
    await expect(card).not.toContainText(String(PLAYER_GAMES_SUM));
  });

  test('Total Players counts everyone on the roster, including the never-played', async ({ page }) => {
    await stubRest(page);
    await page.goto('/leaderboard');
    await loaded(page);
    await expect(statCard(page, 'TOTAL PLAYERS')).toContainText(String(PLAYERS.length)); // 5, incl. Eve
  });

  test('reads each endpoint exactly once per load', async ({ page }) => {
    const calls = await stubRest(page);
    await page.goto('/leaderboard');
    await loaded(page);
    expect(calls.matchCount).toBe(1);
    expect(calls.players).toBe(1);
  });
});

test.describe('ranked list', () => {
  test('orders by win rate, breaking a tie on games played', async ({ page }) => {
    await stubRest(page);
    await page.goto('/leaderboard');
    await expect(page.getByText('Ada Lovelace')).toBeVisible();

    // Ben and Ada are both 75%; Ben has 40 games to Ada's 12, so he ranks first.
    const names = await page.locator('.font-semibold').allTextContents();
    const ranked = names.filter((n) => ['Ada Lovelace', 'Ben Franklin', 'Cleo Patra'].includes(n));
    expect(ranked).toEqual(['Ben Franklin', 'Ada Lovelace', 'Cleo Patra']);
  });

  test('shows the win rate as a whole percentage', async ({ page }) => {
    await stubRest(page);
    await page.goto('/leaderboard');
    await expect(page.getByText('75%').first()).toBeVisible();
    await expect(page.getByText('50%')).toBeVisible();
  });

  test('shows the W / L / games line from the all-time totals', async ({ page }) => {
    await stubRest(page);
    await page.goto('/leaderboard');
    await expect(page.getByText('30W 10L · 40 games')).toBeVisible(); // Ben
    await expect(page.getByText('9W 3L · 12 games')).toBeVisible(); // Ada
  });

  test('crowns first place and numbers the rest', async ({ page }) => {
    await stubRest(page);
    await page.goto('/leaderboard');
    await expect(page.getByText('Ben Franklin')).toBeVisible();
    // #1 gets the Crown icon instead of a number, so "#1" must not be rendered.
    await expect(page.getByText('#1', { exact: true })).toHaveCount(0);
    await expect(page.getByText('#2', { exact: true })).toBeVisible();
    await expect(page.getByText('#3', { exact: true })).toBeVisible();
  });

  test('leaves sub-threshold and never-played players out of the ranking', async ({ page }) => {
    await stubRest(page);
    await page.goto('/leaderboard');
    await expect(page.getByText('Ben Franklin')).toBeVisible();
    const ranked = (await page.locator('.font-semibold').allTextContents()).filter((n) =>
      ['Dex Morgan', 'Eve Newcomer'].includes(n)
    );
    expect(ranked).toEqual([]);
  });
});

test.describe('unranked section', () => {
  test('lists a sub-threshold player with their record and what’s left to do', async ({ page }) => {
    await stubRest(page);
    await page.goto('/leaderboard');
    await expect(page.getByText('NOT YET RANKED')).toBeVisible();
    await expect(page.getByText('Dex Morgan')).toBeVisible();
    // Their actual W/L, not just a bare "3/10" — a record matters to a player
    // before it counts towards ranking.
    await expect(page.getByText('2W 1L')).toBeVisible();
    await expect(page.getByText('Needs 7 more games to rank')).toBeVisible();
    await expect(page.getByText('Play 10+ games to get ranked')).toBeVisible();
  });

  test('never-played players are absent from the unranked list too', async ({ page }) => {
    await stubRest(page);
    await page.goto('/leaderboard');
    await expect(page.getByText('NOT YET RANKED')).toBeVisible();
    await expect(page.getByText('Eve Newcomer')).toHaveCount(0);
  });

  test('the section is dropped entirely when everyone who has played is ranked', async ({ page }) => {
    const onlyRanked = PLAYERS.filter((p) => p.total_games >= 10);
    await stubRest(page, { players: onlyRanked });
    await page.goto('/leaderboard');
    await expect(page.getByText('Ben Franklin')).toBeVisible();
    // An empty "NOT YET RANKED" heading with a reassurance under it was noise.
    await expect(page.getByText('NOT YET RANKED')).toHaveCount(0);
  });
});

test.describe('empty and error states', () => {
  /* Regression guard. The page used to render "Nobody has played 10 games yet"
     and "Everyone who has played is ranked" at the same time — two mutually
     exclusive statements stacked on top of each other. */
  test('never shows the empty-ranking and everyone-ranked messages together', async ({ page }) => {
    await stubRest(page, { players: [], matchCount: 0 });
    await page.goto('/leaderboard');
    await expect(page.getByText(/No games recorded yet/)).toBeVisible();
    await expect(page.getByText('NOT YET RANKED')).toHaveCount(0);
    await expect(page.getByText(/Everyone who has played is ranked/)).toHaveCount(0);
  });

  test('distinguishes an empty roster from one that just has not qualified yet', async ({ page }) => {
    // Nobody has played at all → say that, not "10 games needed".
    await stubRest(page, { players: [], matchCount: 0 });
    await page.goto('/leaderboard');
    await expect(page.getByText(/No games recorded yet/)).toBeVisible();

    // Somebody IS working towards it → explain the threshold, and list them.
    const belowThreshold = PLAYERS.filter((p) => p.total_games > 0 && p.total_games < 10);
    await stubRest(page, { players: belowThreshold, matchCount: 3 });
    await page.goto('/leaderboard');
    await expect(page.getByText(/10 games needed to qualify/)).toBeVisible();
    await expect(page.getByText('Dex Morgan')).toBeVisible();
    await expect(page.getByText('Needs 7 more games to rank')).toBeVisible();
  });

  test('shows the retry screen when the roster fails to load', async ({ page }) => {
    await stubRest(page, { players: 'error' });
    await page.goto('/leaderboard');
    await expect(page.getByText('Couldn’t load the rankings.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('shows the retry screen when the match count fails to load', async ({ page }) => {
    await stubRest(page, { matchCount: 'error' });
    await page.goto('/leaderboard');
    await expect(page.getByText('Couldn’t load the rankings.')).toBeVisible();
  });

  test('“Try again” re-runs both reads and recovers', async ({ page }) => {
    const calls = await stubRest(page);
    calls.failNext.players = true; // fail the first attempt only
    await page.goto('/leaderboard');
    await expect(page.getByText('Couldn’t load the rankings.')).toBeVisible();

    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'ALL-TIME RANKINGS' })).toBeVisible();
    await expect(page.getByText('Ben Franklin')).toBeVisible();
    expect(calls.players).toBe(2);
  });
});

test.describe('navigation', () => {
  test('the back link returns to the staff app', async ({ page }) => {
    await stubRest(page);
    await page.goto('/leaderboard');
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page).toHaveURL('http://localhost:5199/');
  });

  test('shows the venue name in the header', async ({ page }) => {
    await stubRest(page);
    await page.goto('/leaderboard');
    await expect(page.getByText('Demo Pickle Club')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'COURTFLOW' })).toBeVisible();
  });
});
