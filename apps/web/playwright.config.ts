import { defineConfig } from '@playwright/test';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://bagantkd:bagantkd_dev_only@127.0.0.1:5433/bagantkd';
const API_PORT = 3010;
const WEB_PORT = 3001;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      cwd: import.meta.dirname,
      port: API_PORT,
      reuseExistingServer: !process.env['CI'],
      env: { DATABASE_URL, PORT: String(API_PORT), CORS_ORIGIN: `http://127.0.0.1:${WEB_PORT}` },
      timeout: 30_000,
    },
    {
      command: `pnpm exec next dev --port ${WEB_PORT}`,
      cwd: import.meta.dirname,
      port: WEB_PORT,
      reuseExistingServer: !process.env['CI'],
      env: { NEXT_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}` },
      timeout: 60_000,
    },
  ],
});
