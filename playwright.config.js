import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:3000', viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: {
      ...(existsSync(chrome) ? { executablePath: chrome } : {}),
      args: [
        '--autoplay-policy=no-user-gesture-required',
        ...(process.env.PLAYWRIGHT_SOFTWARE_RENDERING ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
      ],
    },
  },
  webServer: [
    { command: 'node server/index.js', url: 'http://127.0.0.1:3000/api/info', reuseExistingServer: !process.env.CI, timeout: 15_000 },
    { command: 'node scripts/preview.mjs', url: 'http://127.0.0.1:4173/runtime-config.js', reuseExistingServer: !process.env.CI, timeout: 15_000 },
  ],
});
