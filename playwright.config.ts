import { defineConfig } from '@playwright/test';

// Drives the system Chrome (no browser download). Self-signed dev certificate, so HTTPS errors are ignored.
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  reporter: 'list',
  workers: 1,
  use: {
    baseURL: 'https://localhost:5173',
    ignoreHTTPSErrors: true,
    channel: 'chrome',
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--enable-unsafe-webgpu'] },
  },
  webServer: {
    command: 'npm run dev',
    url: 'https://localhost:5173',
    ignoreHTTPSErrors: true,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
