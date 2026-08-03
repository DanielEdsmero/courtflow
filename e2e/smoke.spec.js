import { test, expect } from '@playwright/test';
import { stubRest, stubRealtime, signIn, SUPABASE_ORIGIN } from './stub-supabase.js';

/* Validates the harness itself before anything relies on it: the test env really
   did displace .env.local, the seeded session really does sign in, and the
   websocket mock really does complete a Phoenix join. */

test('the app is pointed at the stub origin, not a real project', async ({ page }) => {
  const seen = [];
  page.on('request', (r) => seen.push(r.url()));
  await stubRest(page);
  await stubRealtime(page);
  await page.goto('/queue/demo-club');
  await expect(page.getByText('Demo Pickle Club').or(page.locator('h3').first())).toBeVisible();

  const supabaseCalls = seen.filter((u) => u.includes('/rest/v1/') || u.includes('/auth/v1/'));
  expect(supabaseCalls.length).toBeGreaterThan(0);
  for (const u of supabaseCalls) expect(u.startsWith(SUPABASE_ORIGIN)).toBe(true);
  // The real project's host must never appear.
  expect(seen.some((u) => u.includes('supabase.co'))).toBe(false);
});

test('the seeded session signs in and the venue loads', async ({ page }) => {
  const calls = await stubRest(page);
  await signIn(page);
  await page.goto('/leaderboard');
  await expect(page.getByRole('heading', { name: 'ALL-TIME RANKINGS' })).toBeVisible();
  expect(calls.venues).toBeGreaterThan(0);
});

test('the websocket mock completes a join, clearing the reconnecting pill', async ({ page }) => {
  await stubRest(page);
  const rt = await stubRealtime(page);
  await page.goto('/queue/demo-club');

  // Assert the board rendered FIRST. Without this the pill check passes
  // vacuously — an error screen has no pill either, so "hidden" would be true
  // even with a completely broken websocket mock.
  await expect(page.getByRole('heading', { name: 'Court 1' })).toBeVisible();
  await rt.waitForJoin('demo-club');
  // Now it means something: the pill renders whenever the channel is not
  // SUBSCRIBED, so it vanishing proves realtime-js accepted the handshake.
  await expect(page.getByText('reconnecting…')).toBeHidden();
});
