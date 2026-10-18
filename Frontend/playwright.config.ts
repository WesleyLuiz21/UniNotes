import { defineConfig, devices } from '@playwright/test';

const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 4173);
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 3100);
// Set E2E_BASE_URL to run against an already-running deployment (e.g. the Docker stack).
const EXTERNAL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: EXTERNAL ?? `http://localhost:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
    // For HTTPS test deployments using a local/internal CA (never needed against a real certificate).
    ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === '1',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } },
      testIgnore: /mobile\.spec\.ts/,
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: EXTERNAL
    ? undefined
    : [
        {
          command: './e2e/start-backend.sh',
          url: `http://localhost:${BACKEND_PORT}/api/health`,
          timeout: 120_000,
          reuseExistingServer: false,
          env: { E2E_BACKEND_PORT: String(BACKEND_PORT), E2E_FRONTEND_PORT: String(FRONTEND_PORT) },
        },
        {
          command: `npm run build && npx vite preview --port ${FRONTEND_PORT} --strictPort`,
          url: `http://localhost:${FRONTEND_PORT}`,
          timeout: 180_000,
          reuseExistingServer: false,
          env: { BACKEND_URL: `http://localhost:${BACKEND_PORT}` },
        },
      ],
});
