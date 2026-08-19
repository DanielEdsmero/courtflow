import { test, expect } from '@playwright/test';
import { stubRest, stubRealtime, displayPayload, queueState } from './stub-supabase.js';

/* ─────────────────────────────────────────────
   /queue/:slug — the public club board (spec §F4)
   The interesting behaviour is not the rendering (it shares DisplayView with the
   TV) but the trust model: validate before spending an RPC, and never apply what
   arrives on a guessable broadcast channel.
   ───────────────────────────────────────────── */

test.describe('rendering', () => {
  test('renders the live board from the RPC payload', async ({ page }) => {
    await stubRest(page);
    await stubRealtime(page);
    await page.goto('/queue/demo-club');

    await expect(page.getByRole('heading', { name: 'Court 1' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Court 2' })).toBeVisible();
    // Court 1 is playing, Court 2 is free.
    await expect(page.getByText('LIVE')).toBeVisible();
    await expect(page.getByText('WAITING FOR PLAYERS')).toBeVisible();
    // One group waiting.
    await expect(page.getByRole('heading', { name: /UP NEXT/ })).toBeVisible();
    await expect(page.getByText('(1)')).toBeVisible();
    await expect(page.getByText('1 courts active')).toBeVisible();
  });

  test('resolves player ids to names via the roster in the same payload', async ({ page }) => {
    await stubRest(page);
    await stubRealtime(page);
    await page.goto('/queue/demo-club');
    await expect(page.getByText('Ada Lovelace').first()).toBeVisible();
    await expect(page.getByText('Ben Franklin').first()).toBeVisible();
  });

  test('shows the empty-queue state when nobody is waiting', async ({ page }) => {
    const state = queueState();
    state.queue = [];
    await stubRest(page, { queueRpc: displayPayload({ state }) });
    await stubRealtime(page);
    await page.goto('/queue/demo-club');
    await expect(page.getByText('QUEUE EMPTY')).toBeVisible();
  });
});

test.describe('slug validation', () => {
  // isValidSlug is what stands between a guessable URL and an RPC. Each of these
  // must be rejected in the browser, before any network call.
  const bad = [
    ['uppercase', 'Demo-Club'],
    ['doubled hyphen', 'demo--club'],
    ['leading hyphen', '-democlub'],
    ['trailing hyphen', 'democlub-'],
    ['underscore', 'demo_club'],
  ];

  for (const [label, slug] of bad) {
    test(`rejects ${label} without spending an RPC`, async ({ page }) => {
      const calls = await stubRest(page);
      await stubRealtime(page);
      await page.goto(`/queue/${slug}`);

      await expect(page.getByText('Club not found')).toBeVisible();
      expect(calls.queueRpc).toBe(0);
    });
  }

  test('accepts a well-formed slug and does spend exactly one RPC', async ({ page }) => {
    const calls = await stubRest(page);
    await stubRealtime(page);
    await page.goto('/queue/demo-club');
    await expect(page.getByRole('heading', { name: 'Court 1' })).toBeVisible();
    expect(calls.queueRpc).toBe(1);
  });
});

test.describe('error states', () => {
  test('an unknown club reads as not found', async ({ page }) => {
    await stubRest(page, { queueRpc: null });
    await stubRealtime(page);
    await page.goto('/queue/no-such-club');
    await expect(page.getByText('Club not found')).toBeVisible();
    // Copy is aimed at a player holding a phone, not at staff.
    await expect(page.getByText(/poster/i)).toBeVisible();
  });

  test('a transport failure reads as unreachable, not as a missing club', async ({ page }) => {
    await stubRest(page, { queueRpc: 'error' });
    await stubRealtime(page);
    await page.goto('/queue/demo-club');
    await expect(page.getByText('Can’t reach CourtFlow')).toBeVisible();
    await expect(page.getByText('Club not found')).toBeHidden();
  });

  test('shows the reconnecting pill while the socket is down', async ({ page }) => {
    // No realtime stub: the websocket to the dead stub origin never connects.
    await stubRest(page);
    await page.goto('/queue/demo-club');
    await expect(page.getByRole('heading', { name: 'Court 1' })).toBeVisible();
    await expect(page.getByText('reconnecting…')).toBeVisible();
  });
});

test.describe('live updates', () => {
  test('a broadcast ping triggers a re-fetch rather than being trusted', async ({ page }) => {
    const calls = await stubRest(page);
    const rt = await stubRealtime(page);
    await page.goto('/queue/demo-club');
    await expect(page.getByRole('heading', { name: 'Court 1' })).toBeVisible();
    await rt.waitForJoin('demo-club');
    expect(calls.queueRpc).toBe(1);

    // Change what the server would return, then ping. The ping itself carries no
    // state, so the only way the new name can appear is a genuine re-fetch.
    const renamed = queueState();
    renamed.courts[1].name = 'Court 9';
    calls.state.queueRpc = displayPayload({ state: renamed });

    rt.ping('demo-club');
    await expect(page.getByRole('heading', { name: 'Court 9' })).toBeVisible();
    expect(calls.queueRpc).toBe(2);
  });

  test('a burst of pings is debounced into a single re-fetch', async ({ page }) => {
    const calls = await stubRest(page);
    const rt = await stubRealtime(page);
    await page.goto('/queue/demo-club');
    await expect(page.getByRole('heading', { name: 'Court 1' })).toBeVisible();
    await rt.waitForJoin('demo-club');
    const before = calls.queueRpc;

    // Ten pings inside the 250ms window — a forged flood must not become ten RPCs.
    rt.ping('demo-club', 10);
    await page.waitForTimeout(800);
    expect(calls.queueRpc).toBe(before + 1);
  });

  test('re-fetches when the tab becomes visible again', async ({ page }) => {
    const calls = await stubRest(page);
    await stubRealtime(page);
    await page.goto('/queue/demo-club');
    await expect(page.getByRole('heading', { name: 'Court 1' })).toBeVisible();
    const before = calls.queueRpc;

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => calls.queueRpc).toBe(before + 1);
  });
});

test.describe('privacy', () => {
  /* This board is reachable by anyone who can read a poster, so staff-only data
     must be ABSENT from the payload, not merely unrendered. The stub mirrors the
     RPC's redaction on purpose — a fixture richer than the real payload would let
     a leak pass every test in this file. */

  test('shows no payment status anywhere', async ({ page }) => {
    await stubRest(page);
    await stubRealtime(page);
    await page.goto('/queue/demo-club');
    await expect(page.getByText('Ada Lovelace').first()).toBeVisible();

    for (const label of ['Unpaid', 'Paid — Cash', 'Paid — Online', 'Cash', 'Online']) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    await expect(page.locator('[title*="Unpaid"], [title*="Paid"]')).toHaveCount(0);
  });

  test('leaks no staff-only vocabulary into the rendered page', async ({ page }) => {
    await stubRest(page);
    await stubRealtime(page);
    await page.goto('/queue/demo-club');
    await expect(page.getByText('Ada Lovelace').first()).toBeVisible();

    const body = (await page.locator('body').innerText()).toLowerCase();
    for (const forbidden of [
      'unpaid', 'matcher:', 'suggested', 'high court', 'low court', 'cooldown', 'diagnostic',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  test('the payload itself carries no payment, no W/L and no audit log', async ({ page }) => {
    // The strongest form of the assertion: check what actually crosses the wire,
    // not what happens to be painted. Anything present here is one render away
    // from being public.
    await stubRest(page);
    await stubRealtime(page);

    const response = page.waitForResponse((r) => r.url().includes('get_display_state_by_slug'));
    await page.goto('/queue/demo-club');
    const payload = await (await response).json();

    expect(payload.players.length).toBeGreaterThan(0);
    for (const player of payload.players) {
      expect(player).not.toHaveProperty('payment');
      // The hidden Value is derived from these: +1 a win, -0.5 a loss.
      expect(player).not.toHaveProperty('wins');
      expect(player).not.toHaveProperty('losses');
    }
    // Audit entries carry name + payment + method + session length.
    expect(payload.state).not.toHaveProperty('auditLog');
  });
});

test.describe('call windows', () => {
  test('a waiting group shows an approximate range, never a promised minute', async ({ page }) => {
    const state = queueState();
    state.defaultOpenDuration = 15;
    state.competitiveMode = false;
    // Both courts running, so the next group has to wait for a turnover.
    const startedAt = Date.now() - 10 * 60_000;
    state.courts = state.courts.map((c, i) => ({
      ...c,
      match: {
        players: ['p1', 'p2', 'p3', 'p4'],
        startedAt: startedAt - i * 60_000,
        endsAt: startedAt + 15 * 60_000,
        durationMin: 15,
      },
    }));
    await stubRest(page, { queueRpc: displayPayload({ state }) });
    await stubRealtime(page);
    await page.goto('/queue/demo-club');

    await expect(page.getByText(/approx\. \d+–\d+ min/i).first()).toBeVisible();
    // A range, not a single number dressed up as a fact.
    await expect(page.getByText(/^about \d+ min$/)).toHaveCount(0);
  });

  test('says nothing rather than guessing when there is no duration to project from', async ({ page }) => {
    const state = queueState();
    state.defaultOpenDuration = null;
    await stubRest(page, { queueRpc: displayPayload({ state }) });
    await stubRealtime(page);
    await page.goto('/queue/demo-club');

    await expect(page.getByRole('heading', { name: /UP NEXT/ })).toBeVisible();
    await expect(page.getByText(/approx\./i)).toHaveCount(0);
  });
});
