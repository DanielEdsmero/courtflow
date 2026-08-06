import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Absolute base: routes like /d/<token> must resolve assets from the domain root.
  base: '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.js'],
    // e2e/ holds Playwright specs, which import @playwright/test and need a real
    // browser — Vitest would collect them and fail. `npm run test:e2e` runs those.
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
