import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    viewport: { width: 1366, height: 768 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node apps/server/dist/index.js',
    url: 'http://127.0.0.1:3100/health',
    env: { PORT: '3100', HOST: '127.0.0.1', DB_PATH: ':memory:' },
    reuseExistingServer: false,
  },
});
