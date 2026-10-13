import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/site-e2e',
  timeout: 120000,
  workers: 1,
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3105/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  use: {
    baseURL: 'http://127.0.0.1:3105',
    viewport: { width: 1366, height: 768 },
    trace: 'retain-on-failure',
  },
});
