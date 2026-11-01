import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createProfile } from '../../shared/progression.js';

test('the main stats show online casual rating and tier separately, refresh correctly and keep queue text simple at every layout size', async ({ context, page }) => {
  const origin = `http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`, api = 'http://127.0.0.1:18080';
  const local = createProfile('online-stats-device-0001', Date.now(), 'LOCAL TESTER'); Object.assign(local, { kills: 12, deaths: 4, points: 600, totalEarned: 600 });
  await context.addInitScript((profile) => { if (!localStorage.getItem('linkshot-profile-v1')) localStorage.setItem('linkshot-profile-v1', JSON.stringify(profile)); }, local);
  await context.route('**/runtime-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const APP_MODE = 'solo'; export const PROFILE_STORAGE = 'browser'; export const ONLINE_SERVER_URL = ${JSON.stringify(api)};` }));
  let signedIn = true, queuedMode = null;
  const profile = { id: 'stats-account', callsign: 'ONLINE TESTER', points: 0, kills: 0, deaths: 0, casualRating: 1432, rankTier: 'SILVER', rankDivision: 3, rankPoints: 42, placementsPlayed: 10, ownedWeapons: ['rifle', 'pistol', 'shotgun', 'sniper'] };
  await context.route(api + '/api/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname, headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-TOKEN' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let status = 200, body;
    if (path === '/api/health') body = { service: 'linkshot-online', matchmaking: true };
    else if (path === '/api/account') { status = signedIn ? 200 : 401; body = signedIn ? profile : { message: 'Login required' }; }
    else if (path === '/api/auth/csrf') body = { token: 'example-csrf', headerName: 'X-CSRF-TOKEN' };
    else if (path === '/api/auth/logout') { signedIn = false; status = 204; }
    else if (path === '/api/queue') { if (request.method() === 'POST') queuedMode = request.postDataJSON().mode; if (request.method() === 'DELETE') queuedMode = null; body = queuedMode ? { state: 'QUEUED', mode: queuedMode, elapsedSeconds: 12, playersFound: 1, requiredPlayers: 4, aiInSeconds: 18, ratingGap: 600, reason: '' } : { state: 'IDLE' }; }
    else if (path === '/api/queue/heartbeat') body = { ok: true };
    else { status = 404; body = {}; }
    await route.fulfill({ status, headers, ...(status === 204 ? {} : { contentType: 'application/json', body: JSON.stringify(body) }) });
  });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await page.goto(origin);
  await expect(page.locator('#profile-casual-rating')).toHaveText('1,432'); await expect(page.locator('#profile-rank-tier')).toHaveText('실버 III'); await expect(page.locator('#profile-rank-progress')).toContainText('42 승급점수'); await expect(page.locator('#profile-casual-status')).toContainText('ONLINE TESTER');
  await expect(page.locator('#profile-callsign')).toHaveText('LOCAL TESTER'); await expect(page.locator('#profile-kills')).toHaveText('12'); await expect(page.locator('#profile-deaths')).toHaveText('4'); await expect(page.locator('#profile-points')).toHaveText('600');
  for (const width of [1440, 1100, 950, 740, 390]) { await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await expect(page.locator('#profile-casual-rating')).toBeVisible(); await expect(page.locator('#profile-rank-tier')).toBeVisible(); }
  await page.setViewportSize({ width: 1440, height: 1000 }); await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/lobby-online-rating-tier.png', fullPage: true });
  await page.reload(); await expect(page.locator('#profile-casual-rating')).toHaveText('1,432'); await expect(page.locator('#profile-rank-tier')).toHaveText('실버 III');
  for (const mode of ['일반', '랭크']) { await page.getByRole('tab', { name: mode, exact: true }).click(); await page.getByRole('button', { name: `${mode} 매칭`, exact: true }).click(); await expect(page.locator('#online-queue-detail')).toHaveText('매칭 인원 1/4'); await expect(page.locator('#online-queue-panel')).not.toContainText(/허용 점수|AI 추가|AI로 빈자리/); await page.locator('#online-cancel-queue').click(); await expect(page.locator('#online-queue-panel')).toBeHidden(); }
  await page.locator('#online-logout').click(); await expect(page.locator('#profile-casual-rating')).toHaveText('—'); await expect(page.locator('#profile-rank-tier')).toHaveText('—');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1'))); expect(stored.kills).toBe(12); expect(stored.points).toBe(600); expect(stored.casualRating).toBeUndefined(); expect(errors).toEqual([]);
});
