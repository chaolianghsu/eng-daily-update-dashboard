import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5176/eng-daily-update-dashboard/',
    headless: true,
  },
  webServer: {
    command: 'bun run dev -- --port 5176',
    port: 5176,
    reuseExistingServer: false,
  },
});
