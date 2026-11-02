import { defineConfig, devices } from '@playwright/test';

const PORT = 3400;
const TEST_DB =
  process.env.TEST_DATABASE_URL || 'postgres://kanban:kanban@localhost:5432/kanban_test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  globalSetup: './tests/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `PORT=${PORT} DATABASE_URL=${TEST_DB} node server/index.js`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'api',
      testMatch: /api.*\.spec\.ts/,
    },
    {
      name: 'e2e',
      testMatch: /e2e.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});