import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const lanPort = Number(process.env.LAN_TEST_PORT) || 3000;
const previewPort = Number(process.env.PREVIEW_PORT) || 4173;
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${lanPort}`, viewport: { width: 1440, height: 1000 },
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
    { command: 'node server/index.js', env: { PORT: String(lanPort) }, url: `http://127.0.0.1:${lanPort}/api/info`, reuseExistingServer: !process.env.CI, timeout: 15_000 },
    { command: 'node scripts/preview.mjs', env: { PREVIEW_PORT: String(previewPort) }, url: `http://127.0.0.1:${previewPort}/runtime-config.js`, reuseExistingServer: !process.env.CI, timeout: 15_000 },
  ],
});
