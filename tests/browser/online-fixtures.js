import { expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import net from 'node:net';
import { createProfile } from '../../shared/progression.js';

export async function services(origin, { engine = false, wait = 1, lanHost = '', rankedAi = true } = {}) {
  await mkdir('artifacts/online-browser', { recursive: true }); const data = await mkdtemp(path.resolve('artifacts/online-browser/rooms-')), secret = randomBytes(48).toString('base64url'), children = [];
  const start = (args, env, expression) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }); children.push(child); let output = '';
    return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Online startup timed out: ' + output.slice(-2000))), 75_000); const read = (chunk) => { output += chunk; const match = output.match(expression); if (match) { clearTimeout(timer); resolve(match[1]); } }; child.stdout.on('data', read); child.stderr.on('data', read); child.once('error', reject); child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Online service exited (${code}): ${output.slice(-2000)}`)); }); });
  };
  const close = async () => { for (const child of children.toReversed()) { const stopped = new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', resolve); }); child.kill('SIGTERM'); await stopped; } };
  try {
    const apiUrl = await start(['scripts/run-online-dev.mjs'], { ONLINE_BIND: lanHost ? '0.0.0.0' : '127.0.0.1', ONLINE_PORT: '0', ONLINE_DATA_DIR: data, FRONTEND_ORIGINS: origin, ENGINE_SECRET: secret, RANKED_AI_ENABLED: String(rankedAi), CASUAL_WAIT_SECONDS: String(wait), MATCH_ROUND_SECONDS: '60', MATCH_FRAG_LIMIT: '1' }, /LINKSHOT LOCAL API (http:\/\/127\.0\.0\.1:\d+)/);
    if (engine) {
      let port = 0; if (lanHost) { const probe = net.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve)); port = probe.address().port; await new Promise((resolve) => probe.close(resolve)); }
      await start(['server/online-engine.js'], { ENGINE_BIND: lanHost ? '0.0.0.0' : '127.0.0.1', ENGINE_PORT: String(port), ENGINE_PUBLIC_URL: lanHost ? `ws://${lanHost}:${port}/play` : '', FRONTEND_ORIGINS: origin, ONLINE_API_URL: apiUrl, ENGINE_SECRET: secret }, /combat engine listening on port (\d+)/);
      await expect.poll(async () => (await (await fetch(apiUrl + '/api/health')).json()).customRooms).toBe(true);
    }
    return { apiUrl: lanHost ? apiUrl.replace('127.0.0.1', lanHost) : apiUrl, close };
  } catch (error) { await close(); throw error; }
}

export async function onlinePage(context, apiUrl, origin, mode, index = 0) {
  await context.route('**/runtime-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const APP_MODE = 'solo'; export const PROFILE_STORAGE = 'browser'; export const ONLINE_SERVER_URL = ${JSON.stringify(apiUrl)};` }));
  const local = createProfile(`custom-local-${index}-0001`, Date.now(), 'LOCAL TESTER'); local.points = local.totalEarned = 1234;
  await context.addInitScript((profile) => { try { if (!localStorage.getItem('linkshot-profile-v1')) localStorage.setItem('linkshot-profile-v1', JSON.stringify(profile)); localStorage.setItem('sector07-settings', JSON.stringify({ volume: 0, quality: 'low', fov: 82, sensitivity: 1 })); } catch {} }, local);
  const page = await context.newPage(), state = { latest: null, errors: [] }; page.on('pageerror', (error) => state.errors.push(error.message)); page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => { try { const data = JSON.parse(payload.toString()); if (['joined', 'state'].includes(data.type)) state.latest = data; } catch {} }));
  await page.goto(origin); await page.getByRole('tab', { name: mode, exact: true }).click(); await expect(page.locator('#online-server-state')).toContainText('연결됨');
  await page.locator('#online-username').fill('ui_' + randomBytes(7).toString('hex')); await page.locator('#online-password').fill('test-only-long-passphrase'); await page.locator('#online-callsign').fill(`PLAYER ${index}`); await page.locator('#online-register').click(); await expect(page.locator('#online-profile-summary')).toContainText(`PLAYER ${index} · 온라인 0 LP`);
  return { page, state };
}
