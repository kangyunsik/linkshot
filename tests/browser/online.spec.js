import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import net from 'node:net';
import { createProfile } from '../../shared/progression.js';
import { networkSettings } from '../../scripts/create-online-env.mjs';

async function services(origin, { engine = false, wait = 1, lanHost = '' } = {}) {
  await mkdir('artifacts/online-browser', { recursive: true }); const data = await mkdtemp(path.resolve('artifacts/online-browser/match-')), secret = randomBytes(48).toString('base64url'), children = [];
  const start = async (args, env, expression) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }); children.push(child); let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
    return new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Online service startup timed out: ' + output.slice(-2000))), 75_000); child.stdout.on('data', (chunk) => { const match = chunk.toString().match(expression); if (match) { clearTimeout(timeout); resolve(match[1]); } }); child.once('error', reject); child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Online service exited (${code}): ${output.slice(-2000)}`)); }); });
  };
  const close = async () => { for (const child of children.toReversed()) { const stopped = new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', resolve); }); child.kill('SIGTERM'); await stopped; } };
  try {
    const apiUrl = await start(['scripts/run-online-dev.mjs'], { ONLINE_BIND: lanHost ? '0.0.0.0' : '127.0.0.1', ONLINE_PORT: '0', ONLINE_DATA_DIR: data, FRONTEND_ORIGINS: origin, ENGINE_SECRET: secret, CASUAL_WAIT_SECONDS: String(wait), MATCH_ROUND_SECONDS: '60', MATCH_FRAG_LIMIT: '1' }, /LINKSHOT LOCAL API (http:\/\/127\.0\.0\.1:\d+)/);
    if (engine) {
      let port = 0;
      if (lanHost) { const probe = net.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve)); port = probe.address().port; await new Promise((resolve) => probe.close(resolve)); }
      await start(['server/online-engine.js'], { ENGINE_BIND: lanHost ? '0.0.0.0' : '127.0.0.1', ENGINE_PORT: String(port), ENGINE_PUBLIC_URL: lanHost ? `ws://${lanHost}:${port}/play` : '', FRONTEND_ORIGINS: origin, ONLINE_API_URL: apiUrl, ENGINE_SECRET: secret }, /combat engine listening on port (\d+)/);
      await expect.poll(async () => (await (await fetch(apiUrl + '/api/health')).json()).matchmaking).toBe(true);
    }
    return { apiUrl: lanHost ? apiUrl.replace('127.0.0.1', lanHost) : apiUrl, close };
  } catch (error) { await close(); throw error; }
}

async function onlinePage(context, apiUrl, origin, mode, index = 0) {
  await context.route('**/runtime-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const APP_MODE = 'solo'; export const PROFILE_STORAGE = 'browser'; export const ONLINE_SERVER_URL = ${JSON.stringify(apiUrl)};` }));
  const local = createProfile(`online-match-local-${index}-0001`, Date.now(), 'LOCAL TESTER'); local.points = local.totalEarned = 1234;
  await context.addInitScript((local) => { try { if (!localStorage.getItem('linkshot-profile-v1')) localStorage.setItem('linkshot-profile-v1', JSON.stringify(local)); localStorage.setItem('sector07-settings', JSON.stringify({ volume: 0, quality: 'low', fov: 82, sensitivity: 1 })); } catch {} }, local);
  const page = await context.newPage(), state = { latest: null, errors: [] };
  page.on('pageerror', (error) => state.errors.push(error.message)); page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => { try { const value = JSON.parse(payload.toString()); if (['state', 'joined'].includes(value.type)) state.latest = value; } catch {} }));
  await page.goto(origin); await page.getByRole('tab', { name: mode, exact: true }).click(); await expect(page.locator('#online-server-state')).toContainText('연결됨');
  await page.locator('#online-username').fill('ui_' + randomBytes(7).toString('hex')); await page.locator('#online-password').fill('test-only-long-passphrase'); await page.locator('#online-callsign').fill(`PLAYER ${index}`); await page.getByRole('button', { name: '온라인 계정 만들기', exact: true }).click(); await expect(page.locator('#online-profile-summary')).toContainText(`PLAYER ${index} · 온라인 0 LP`);
  return { page, state };
}

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

test('casual matchmaking fills three empty slots with labelled AI and enters the real shared combat gateway', async ({ browser }) => {
  test.skip(process.env.ONLINE_BROWSER_TEST !== '1', 'Optional online integration.'); test.setTimeout(150_000);
  const origin = `http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`, backend = await services(origin, { engine: true }), context = await browser.newContext();
  try {
    const { page, state } = await onlinePage(context, backend.apiUrl, origin, '일반'); await page.getByRole('button', { name: '일반 매칭', exact: true }).click();
    await expect(page.locator('#pause-overlay')).toBeVisible({ timeout: 20_000 }); await expect(page.locator('#hud-connection-kind')).toHaveText('ONLINE');
    await expect.poll(() => state.latest?.room.phase).toBe('active'); expect(state.latest.players).toHaveLength(4); expect(state.latest.players.filter((player) => player.isBot)).toHaveLength(3); expect(state.latest.room.mode).toBe('casual'); expect(state.latest.room.mapId).not.toBe('training');
    await expect(page.locator('#profile-points')).toHaveText('1,234'); expect(state.errors).toEqual([]);
    await page.screenshot({ path: 'artifacts/casual-online-ai-fill.png' });
    await expect(page.locator('#round-overlay')).toBeVisible({ timeout: 75_000 }); await expect(page.locator('#round-reward-status')).toContainText('온라인 서버에 저장됨', { timeout: 15_000 }); await expect(page.locator('#online-rating-summary')).toContainText('일반 레이팅 +0 → 1000');
    const saved = await page.evaluate(async (base) => { const account = await (await fetch(base + '/api/account', { credentials: 'include' })).json(), history = await (await fetch(base + '/api/results', { credentials: 'include' })).json(); return { account, history, local: JSON.parse(localStorage.getItem('linkshot-profile-v1')) }; }, backend.apiUrl);
    expect(saved.account.points).toBeGreaterThanOrEqual(50); expect(saved.account.casualRating).toBe(1000); expect(saved.history).toHaveLength(1); expect(saved.history[0].points).toBe(saved.account.points); expect(saved.local.points).toBe(1234); expect(saved.local.kills).toBe(0); expect(saved.local.roundsPlayed).toBe(0); expect(state.errors).toEqual([]);
  } finally { await context.close(); await backend.close(); }
});

test('ranked waits for four humans, grants only temporary weapons and reconnects without resetting the player', async ({ browser }) => {
  test.skip(process.env.ONLINE_BROWSER_TEST !== '1', 'Optional online integration.'); test.setTimeout(210_000);
  const origin = `http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`, backend = await services(origin, { engine: true }), contexts = [], entrants = [];
  try {
    for (let i = 0; i < 4; i++) { const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }); contexts.push(context); entrants.push(await onlinePage(context, backend.apiUrl, origin, '랭크', i)); }
    await entrants[0].page.locator('#online-weapon-choice').selectOption('m82');
    await entrants[0].page.getByRole('button', { name: '랭크 매칭', exact: true }).click(); await expect(entrants[0].page.locator('#online-cancel-queue')).toBeVisible(); await entrants[0].page.locator('#online-cancel-queue').click(); await expect(entrants[0].page.locator('#online-queue-panel')).toBeHidden();
    for (const entrant of entrants.slice(0, 3)) await entrant.page.getByRole('button', { name: '랭크 매칭', exact: true }).click();
    await expect(entrants[0].page.locator('#online-queue-detail')).toContainText('사람 3/4'); const started = Date.now();
    await expect.poll(async () => { expect(entrants.slice(0, 3).every((entry) => entry.state.latest === null)).toBe(true); return Date.now() - started; }).toBeGreaterThan(2500);
    await expect(entrants[0].page.locator('#online-queue-detail')).toContainText('AI 추가 없음');
    await entrants[3].page.getByRole('button', { name: '랭크 매칭', exact: true }).click();
    for (const entrant of entrants) { await expect(entrant.page.locator('#pause-overlay')).toBeVisible({ timeout: 25_000 }); await expect.poll(() => entrant.state.latest?.room.phase).toBe('active'); expect(entrant.state.latest.players).toHaveLength(4); expect(entrant.state.latest.players.some((player) => player.isBot)).toBe(false); }
    const first = entrants[0], self = first.state.latest.players.find((player) => player.name === 'PLAYER 0'), matchId = first.state.latest.room.roundId;
    expect(self.weaponId).toBe('m82'); expect(self.ownedWeapons).toHaveLength(20);
    const canonical = await first.page.evaluate(async (base) => (await fetch(base + '/api/account', { credentials: 'include' })).json(), backend.apiUrl); expect(canonical.ownedWeapons).toHaveLength(4); expect(canonical.ownedWeapons).not.toContain('m82');
    await first.page.reload(); await first.page.getByRole('tab', { name: '랭크', exact: true }).click(); await expect(first.page.locator('#online-reconnect')).toBeVisible(); await first.page.locator('#online-reconnect').click(); await expect(first.page.locator('#pause-overlay')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => first.state.latest?.players.find((player) => player.id === self.id)?.weaponId).toBe('m82');
    const restored = first.state.latest.players.find((player) => player.id === self.id); expect(restored.hp).toBe(self.hp); expect(restored.ammo).toBe(self.ammo); expect(restored.spawnCount).toBe(self.spawnCount); expect(first.state.latest.room.roundId).toBe(matchId);
    for (const entrant of entrants) expect(entrant.state.errors).toEqual([]);
    await first.page.screenshot({ path: 'artifacts/ranked-online-human-match.png' });
  } finally { for (const context of contexts) await context.close(); await backend.close(); }
});

test('a private LAN frontend authenticates with same-site cookies and joins the advertised LAN WebSocket, not client loopback', async ({ browser }) => {
  test.skip(process.env.ONLINE_BROWSER_TEST !== '1', 'Optional online integration.'); test.setTimeout(150_000);
  let settings; try { settings = networkSettings('--lan'); } catch { test.skip(true, 'No private LAN interface is available.'); }
  const host = new URL(settings.FRONTEND_URL).hostname, origin = `http://${host}:${Number(process.env.PREVIEW_PORT) || 4173}`, backend = await services(origin, { engine: true, lanHost: host }), context = await browser.newContext();
  try {
    const { page, state } = await onlinePage(context, backend.apiUrl, origin, '일반', 9), sockets = []; page.on('websocket', (socket) => sockets.push(socket.url()));
    const cookies = await context.cookies(backend.apiUrl + '/api'); expect(cookies.some((cookie) => cookie.name === 'LINKSHOTSESSION' && cookie.httpOnly && cookie.path === '/api')).toBe(true);
    await page.getByRole('button', { name: '일반 매칭', exact: true }).click(); await expect(page.locator('#pause-overlay')).toBeVisible({ timeout: 25_000 }); await expect.poll(() => state.latest?.room.phase).toBe('active');
    expect(sockets.some((url) => new URL(url).hostname === host)).toBe(true); expect(sockets.some((url) => ['localhost', '127.0.0.1'].includes(new URL(url).hostname))).toBe(false); expect(state.latest.players).toHaveLength(4); expect(state.errors).toEqual([]);
  } finally { await context.close(); await backend.close(); }
});
