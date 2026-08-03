import { defineConfig, devices } from '@playwright/test';

/* ─────────────────────────────────────────────
   E2E CONFIG
   Runs against `vite --mode test`, which loads .env.test.local and so points the
   Supabase client at a dead local origin. Every request to it is intercepted in
   the browser and answered from a fixture — see e2e/stub-supabase.js. Nothing in
   this suite can reach, read or write the real project.
   ───────────────────────────────────────────── */

const PORT = 5199;

export default defineConfig({
  testDir: './e2e',
  // The stubs count requests to assert things like "an invalid slug spends no
  // RPC", which only holds if one test isn't racing another's counters.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --mode test --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
