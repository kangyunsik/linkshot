import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createProfile } from '../../shared/progression.js';

test('real Spring/PostgreSQL browser authentication is separate from device LP, weapons and identity', async ({ page, context }) => {
  test.skip(process.env.ONLINE_BROWSER_TEST !== '1', 'Optional Java/PostgreSQL browser integration; enable ONLINE_BROWSER_TEST=1.'); test.setTimeout(120_000);
  await mkdir('artifacts/online-browser', { recursive: true }); const data = await mkdtemp(path.resolve('artifacts/online-browser/data-'));
  const origin = `http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`;
  const child = spawn(process.execPath, ['scripts/run-online-dev.mjs'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ONLINE_PORT: '0', ONLINE_DATA_DIR: data, FRONTEND_ORIGINS: origin, ENGINE_SECRET: randomBytes(48).toString('base64url') } });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  try {
    const apiUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local Spring startup timed out: ' + output.slice(-3000))), 75_000);
      const onData = (chunk) => { const match = chunk.toString().match(/LINKSHOT LOCAL API (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); child.stdout.off('data', onData); resolve(match[1]); } };
      child.stdout.on('data', onData); child.once('error', reject); child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Local Spring exited (${code}): ${output.slice(-3000)}`)); });
    });
    const local = createProfile('online-ui-local-0001', Date.now(), 'LOCAL TESTER'); local.points = local.totalEarned = 1234; local.ownedWeapons.push('m82');
    await context.addInitScript((local) => { try { if (!localStorage.getItem('linkshot-profile-v1')) localStorage.setItem('linkshot-profile-v1', JSON.stringify(local)); localStorage.setItem('sector07-settings', JSON.stringify({ volume: 0, quality: 'low', fov: 82, sensitivity: 1 })); } catch { /* about:blank */ } }, local);
    await context.route('**/runtime-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const APP_MODE = 'solo'; export const PROFILE_STORAGE = 'browser'; export const ONLINE_SERVER_URL = ${JSON.stringify(apiUrl)};` }));
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin); await page.getByRole('tab', { name: '일반', exact: true }).click(); await expect(page.locator('#online-server-state')).toContainText('연결됨');
    const username = 'ui_' + randomBytes(7).toString('hex'); await page.locator('#online-username').fill(username); await page.locator('#online-password').fill('test-only-long-passphrase'); await page.locator('#online-callsign').fill('ONLINE TESTER');
    await page.getByRole('button', { name: '온라인 계정 만들기', exact: true }).click(); await expect(page.locator('#online-profile-summary')).toContainText('ONLINE TESTER · 온라인 0 LP'); await expect(page.locator('#profile-points')).toHaveText('1,234'); await expect(page.locator('#online-password')).toHaveValue('');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1'))); expect(stored.points).toBe(1234); expect(stored.ownedWeapons).toContain('m82');
    const cookie = (await context.cookies(apiUrl + '/api')).find((cookie) => cookie.name === 'LINKSHOTSESSION'); expect(cookie?.httpOnly).toBe(true); expect(cookie?.path).toBe('/api');
    expect(await page.evaluate(() => Object.keys(localStorage).some((key) => /token|password|session/i.test(key)))).toBe(false);
    await page.screenshot({ path: 'artifacts/spring-online-account.png', fullPage: true });
    await page.getByRole('button', { name: '온라인 로그아웃', exact: true }).click(); await expect(page.locator('#online-auth-form')).toBeVisible();
    await page.locator('#online-password').fill('test-only-long-passphrase'); await page.getByRole('button', { name: '온라인 로그인', exact: true }).click(); await expect(page.locator('#online-profile-summary')).toContainText('ONLINE TESTER · 온라인 0 LP'); await expect(page.locator('#create-button')).toBeDisabled(); expect(errors).toEqual([]);
  } finally {
    const stopped = new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', resolve); }); child.kill('SIGTERM'); await stopped;
  }
});
