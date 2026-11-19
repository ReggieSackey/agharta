import { defineConfig } from '@playwright/test';

// Dedicated port: avoids silently reusing an unrelated server that happens to
// be listening on :3000 (e.g. another Next app), which would fail these specs
// with confusing 404s. Override with E2E_BASE_URL to target a running server.
const PORT = 3100;
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL,
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm dev --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
