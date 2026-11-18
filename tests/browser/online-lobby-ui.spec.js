import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { createOnlineEngine } from '../../server/online-engine.js';

// This isolates the account UI from PostgreSQL availability. Authentication
// endpoints are mocked; transport, tickets, room state and combat are real.
test('profile-modal authentication and online weapon/team lobbies use a real gateway without expanding the dashboard', async ({ browser }) => {
  test.setTimeout(90_000);
  const origin = `http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`, api = 'http://127.0.0.1:18081', lanHost = [192, 168, 40, 25].join('.'), tickets = new Map(), registrations = [], contexts = [], errors = [];
  const engine = createOnlineEngine({ host: '127.0.0.1', port: 0, origins: [origin.replace('127.0.0.1', lanHost)], client: { pending: async () => [], async consumeCustom(token) { const profile = tickets.get(token); tickets.delete(token); if (!profile) throw new Error('Invalid ticket'); return profile; } } });
  const { port } = await engine.listen();
  try {
    const pages = [];
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext(); contexts.push(context); let signedIn = false;
      await context.addInitScript(() => { try { localStorage.setItem('sector07-settings', JSON.stringify({ volume: 0, quality: 'low', fov: 82, sensitivity: 1 })); } catch {} });
      const username = `modal_user_${i}`, callsign = i === 0 ? '가나다라마바사아자차카타파하가나' : `MODAL ${i}`;
      const profile = { id: randomUUID(), username, callsign: username, kills: 0, deaths: 0, points: 0, roundsPlayed: 0, wins: 0, casualRating: 1000, rankTier: 'UNRANKED', rankDivision: 5, rankPoints: 0, placementsPlayed: 0, placementWins: 0, characterId: 'male', outfitId: 'field', ownedWeapons: ['rifle', 'pistol', 'shotgun', 'sniper'], weaponKills: {} };
      await context.route('**/runtime-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const APP_MODE='solo'; export const PROFILE_STORAGE='browser'; export const ONLINE_SERVER_URL=${JSON.stringify(api.replace('127.0.0.1', lanHost))}; export const FRONTEND_URL=${JSON.stringify(origin.replace('127.0.0.1', lanHost))};` }));
      await context.route(api + '/api/**', async (route) => {
        const request = route.request(), pathname = new URL(request.url()).pathname, headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-TOKEN' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        let status = 200, body = {};
        if (pathname === '/api/health') body = { service: 'linkshot-online', matchmaking: true, customRooms: true };
        else if (pathname === '/api/auth/csrf') body = { token: 'test-csrf', headerName: 'X-CSRF-TOKEN' };
        else if (pathname === '/api/auth/username-availability') body = { username, available: true };
        else if (pathname === '/api/auth/register') { registrations.push(request.postDataJSON()); body = profile; }
        else if (pathname === '/api/auth/login') { signedIn = true; body = { profile }; }
        else if (pathname === '/api/account') { status = signedIn ? 200 : 401; body = signedIn ? profile : { message: 'Login required' }; }
        else if (pathname === '/api/account/callsign' && signedIn) { profile.callsign = request.postDataJSON().callsign; body = profile; }
        else if (pathname === '/api/queue') body = { state: 'IDLE' };
        else if (pathname === '/api/custom/ticket' && signedIn) { const ticket = randomBytes(32).toString('base64url'); tickets.set(ticket, profile); body = { ticket, engineUrl: `ws://${lanHost}:${port}/play` }; }
        else { status = 404; body = { message: 'Not found' }; }
        await route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
      });
      const page = await context.newPage(); pages.push(page); page.on('pageerror', (error) => errors.push(error.message)); await page.goto(origin);
      await page.locator('#profile-button').click(); await expect(page.locator('#online-server-state')).toContainText('연결됨');
      await expect(page.locator('#online-auth-form input[name="callsign"]')).toHaveCount(0); await expect(page.locator('#online-callsign-form')).toBeHidden();
      await expect(page.locator('#online-check-username')).toBeHidden(); await page.locator('#online-register').click();
      await page.locator('#register-username').fill(username); await page.locator('#online-check-username').click(); await expect(page.locator('#online-username-status')).toHaveText('사용 가능한 아이디입니다.'); await expect(page.locator('#register-password')).toHaveValue('');
      await page.locator('#register-password').fill('test-only-long-passphrase'); await page.locator('#register-password-confirm').fill('test-only-long-passphrase'); await page.locator('#online-submit-registration').click(); await expect(page.locator('#online-profile-summary')).toContainText(username); await expect(page.locator('#register-password')).toHaveValue('');
      await page.locator('#online-profile-callsign').fill(callsign); await page.locator('#online-save-callsign').click(); await expect(page.locator('#online-profile-summary')).toContainText(callsign); await expect(page.locator('#operator-callsign')).toHaveText(callsign);
      await page.getByLabel('프로필 닫기').click(); await page.reload(); await page.locator('#profile-button').click(); await expect(page.locator('#online-profile-callsign')).toHaveValue(callsign); await page.getByLabel('프로필 닫기').click();
      await page.getByRole('tab', { name: '사용자 대전', exact: true }).click(); await expect(page.getByText('CUSTOM ROOMS CONNECTED')).toBeVisible(); await expect(page.locator('#online-auth-form')).toBeHidden();
      for (const [width,height] of [[1366,768],[390,844]]) { await page.setViewportSize({ width,height }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true); }
      await page.setViewportSize({ width: 1440,height: 1000 });
    }
    const [host, guest] = pages;
    await host.locator('#online-loadout-button').click(); await host.locator('#weapon-choices [data-weapon=m82]').click(); await expect(host.locator('#armory-unlock')).toBeDisabled(); await expect(host.locator('#armory-owned-state')).toContainText('계정 LP로 영구 해금'); await host.locator('#weapon-choices [data-weapon=sniper]').click(); await host.getByRole('button', { name: '장비 저장' }).click();
    await host.locator('#create-button').click(); await host.locator('#room-title').fill('MODAL WAN'); await host.locator('#room-game-type').selectOption('teams'); await host.locator('#bots-minus').click(); await host.locator('#bots-minus').click(); await host.locator('#room-create-confirm').click(); await expect(host.locator('#room-lobby-dialog')).toBeVisible(); await expect(host.locator('#game-shell')).toBeHidden();
    const room = [...engine.custom.directory.rooms.values()][0]; await guest.locator('#room-browser-button').click(); await expect(guest.locator('#room-list')).toContainText('MODAL WAN'); await guest.locator('#room-list').getByRole('button', { name: '참가', exact: true }).click(); await expect(guest.locator('#room-lobby-dialog')).toBeVisible(); await expect(host.locator('#room-lobby-action')).toBeDisabled();
    await expect(guest.locator('#room-lobby-action')).toBeDisabled(); await guest.locator('#room-select-red').click(); await expect(guest.locator('#room-lobby-action')).toContainText('레드팀'); await guest.locator('#room-lobby-action').click(); await expect(host.locator('#room-lobby-action')).toBeEnabled(); await host.locator('#room-lobby-action').click(); await expect(host.locator('#pause-overlay')).toBeVisible(); await expect(guest.locator('#pause-overlay')).toBeVisible(); expect(room.players.get(room.hostId).weaponId).toBe('sniper');
    expect(registrations).toHaveLength(2); for (const body of registrations) expect(Object.keys(body).sort()).toEqual(['password', 'username']); expect(errors).toEqual([]); for (const page of pages) expect(await page.evaluate(() => Object.keys(localStorage).some((key) => /token|password|session/i.test(key)))).toBe(false);
  } finally { for (const context of contexts) await context.close(); await engine.close(); }
});

test('ID checks work before passwords and duplicate registration never logs in or changes the original credentials', async ({ context, page }) => {
  const origin = `http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`, api = 'http://127.0.0.1:18082', original = 'test-only-first-passphrase', profile = { id: randomUUID(), username: 'existing_user', callsign: 'existing_user', points: 0, kills: 0, deaths: 0, casualRating: 1000, rankTier: 'UNRANKED', ownedWeapons: ['rifle', 'pistol', 'shotgun', 'sniper'] };
  let signedIn = false, logins = 0, staleCheck;
  await context.route('**/runtime-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const APP_MODE='solo'; export const PROFILE_STORAGE='browser'; export const ONLINE_SERVER_URL=${JSON.stringify(api)};` }));
  const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-TOKEN' };
  await context.route(api + '/api/**', async (route) => {
    const request = route.request(), url = new URL(request.url()); let status = 200, body = {};
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname === '/api/health') body = { service: 'linkshot-online', matchmaking: false };
    else if (url.pathname === '/api/auth/csrf') body = { token: 'test-csrf', headerName: 'X-CSRF-TOKEN' };
    else if (url.pathname === '/api/auth/username-availability') {
      const username = url.searchParams.get('username').toLowerCase();
      if (username === 'slow_user') { staleCheck = route; return; }
      body = { username, available: username !== profile.username };
    } else if (url.pathname === '/api/auth/register') { status = 409; body = { message: '이미 존재하는 아이디입니다.' }; }
    else if (url.pathname === '/api/auth/login') {
      logins++; const form = new URLSearchParams(request.postData()); signedIn = form.get('username').toLowerCase() === profile.username && form.get('password') === original; status = signedIn ? 200 : 401; body = signedIn ? { profile } : { message: 'Invalid credentials' };
    } else if (url.pathname === '/api/account') { status = signedIn ? 200 : 401; body = signedIn ? profile : { message: 'Login required' }; }
    else if (url.pathname === '/api/queue') body = { state: 'IDLE' };
    else { status = 404; body = { message: 'Not found' }; }
    await route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(origin); await page.locator('#profile-button').click(); await expect(page.locator('#online-server-state')).toContainText('연결됨');
  await expect(page.locator('#online-check-username')).toBeHidden(); await expect(page.locator('#online-submit-registration')).toBeHidden(); await page.locator('#online-register').click();
  await page.locator('#register-username').fill('slow_user'); await page.locator('#online-check-username').click(); await expect.poll(() => !!staleCheck).toBe(true);
  await page.locator('#register-username').fill('EXISTING_USER'); await staleCheck.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ username: 'slow_user', available: true }) });
  await expect(page.locator('#online-username-status')).toHaveText(''); await page.locator('#online-check-username').click(); await expect(page.locator('#online-username-status')).toHaveText('이미 존재하는 아이디입니다.'); await expect(page.locator('#register-password')).toHaveValue('');
  await page.locator('#register-password').fill('test-only-different-passphrase'); await page.locator('#register-password-confirm').fill('test-only-different-passphrase'); await page.locator('#online-submit-registration').click(); await expect(page.locator('#online-auth-status')).toHaveText('이미 존재하는 아이디입니다.');
  await expect(page.locator('#online-registration-form')).toBeVisible(); await expect(page.locator('#online-profile-summary')).toBeHidden(); expect(logins).toBe(0);
  await page.locator('#auth-login-tab').click(); await expect(page.locator('#online-check-username')).toBeHidden(); await page.locator('#online-username').fill('EXISTING_USER'); await page.locator('#online-password').fill(original); await page.locator('#online-login').click(); await expect(page.locator('#online-profile-summary')).toContainText('existing_user'); expect(logins).toBe(1);
});
