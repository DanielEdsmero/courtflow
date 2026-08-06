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
