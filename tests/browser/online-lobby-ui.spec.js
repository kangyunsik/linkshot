import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { createOnlineEngine } from '../../server/online-engine.js';

// This isolates the account UI from PostgreSQL availability. Authentication
// endpoints are mocked; transport, tickets, room state and combat are real.
test('profile-modal authentication and online weapon/team lobbies use a real gateway without expanding the dashboard', async ({ browser }) => {
  test.setTimeout(90_000);
  const origin = `http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`, api = 'http://127.0.0.1:18081', tickets = new Map(), registrations = [], contexts = [], errors = [];
  const engine = createOnlineEngine({ host: '127.0.0.1', port: 0, origins: [origin], client: { pending: async () => [], async consumeCustom(token) { const profile = tickets.get(token); tickets.delete(token); if (!profile) throw new Error('Invalid ticket'); return profile; } } });
  const { port } = await engine.listen();
  try {
    const pages = [];
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext(); contexts.push(context); let signedIn = false;
      await context.addInitScript(() => { try { localStorage.setItem('sector07-settings', JSON.stringify({ volume: 0, quality: 'low', fov: 82, sensitivity: 1 })); } catch {} });
      const profile = { id: randomUUID(), callsign: i === 0 ? '가나다라마바사아자차카타파하가나' : `MODAL ${i}`, kills: 0, deaths: 0, points: 0, roundsPlayed: 0, wins: 0, casualRating: 1000, rankTier: 'UNRANKED', rankDivision: 5, rankPoints: 0, placementsPlayed: 0, placementWins: 0, characterId: 'male', outfitId: 'field', ownedWeapons: ['rifle', 'pistol', 'shotgun', 'sniper'], weaponKills: {} };
      await context.route('**/runtime-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const APP_MODE='solo'; export const PROFILE_STORAGE='browser'; export const ONLINE_SERVER_URL=${JSON.stringify(api)};` }));
      await context.route(api + '/api/**', async (route) => {
        const request = route.request(), pathname = new URL(request.url()).pathname, headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-TOKEN' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        let status = 200, body = {};
        if (pathname === '/api/health') body = { service: 'linkshot-online', matchmaking: true, customRooms: true };
        else if (pathname === '/api/auth/csrf') body = { token: 'test-csrf', headerName: 'X-CSRF-TOKEN' };
        else if (pathname === '/api/auth/register') { registrations.push(request.postDataJSON()); body = profile; }
        else if (pathname === '/api/auth/login') { signedIn = true; body = { profile }; }
        else if (pathname === '/api/account') { status = signedIn ? 200 : 401; body = signedIn ? profile : { message: 'Login required' }; }
        else if (pathname === '/api/queue') body = { state: 'IDLE' };
        else if (pathname === '/api/custom/ticket' && signedIn) { const ticket = randomBytes(32).toString('base64url'); tickets.set(ticket, profile); body = { ticket, engineUrl: `ws://127.0.0.1:${port}/play` }; }
        else { status = 404; body = { message: 'Not found' }; }
        await route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
      });
      const page = await context.newPage(); pages.push(page); page.on('pageerror', (error) => errors.push(error.message)); await page.goto(origin);
      await page.locator('#profile-button').click(); await expect(page.locator('#online-server-state')).toContainText('연결됨');
      await page.locator('#online-username').fill(`modal_user_${i}`); await page.locator('#online-password').fill('test-only-long-passphrase'); await page.locator('#online-callsign').fill(profile.callsign); await page.locator('#online-register').click(); await expect(page.locator('#online-profile-summary')).toContainText(profile.callsign); await expect(page.locator('#online-password')).toHaveValue(''); await page.getByLabel('프로필 닫기').click();
      await page.getByRole('tab', { name: '사용자 대전', exact: true }).click(); await expect(page.getByText('CUSTOM ROOMS CONNECTED')).toBeVisible(); await expect(page.locator('#online-auth-form')).toBeHidden();
      for (const [width,height] of [[1366,768],[390,844]]) { await page.setViewportSize({ width,height }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true); }
      await page.setViewportSize({ width: 1440,height: 1000 });
    }
    const [host, guest] = pages;
    await host.locator('#online-loadout-button').click(); await expect(host.locator('#online-weapon-choice option[value=m82]')).toBeDisabled(); await host.locator('#online-weapon-choice').selectOption('sniper'); await host.getByRole('button', { name: '장비 선택 완료' }).click();
    await host.locator('#create-button').click(); await host.locator('#room-title').fill('MODAL WAN'); await host.locator('#room-game-type').selectOption('teams'); await host.locator('#bots-minus').click(); await host.locator('#bots-minus').click(); await host.locator('#room-create-confirm').click(); await expect(host.locator('#room-lobby-dialog')).toBeVisible(); await expect(host.locator('#game-shell')).toBeHidden();
    const room = [...engine.custom.directory.rooms.values()][0]; await guest.locator('#room-browser-button').click(); await expect(guest.locator('#room-list')).toContainText('MODAL WAN'); await guest.locator('#room-list').getByRole('button', { name: '참가', exact: true }).click(); await expect(guest.locator('#room-lobby-dialog')).toBeVisible(); await expect(host.locator('#room-lobby-action')).toBeDisabled();
    await guest.locator('#room-lobby-action').click(); await expect(host.locator('#room-lobby-action')).toBeEnabled(); await host.locator('#room-lobby-action').click(); await expect(host.locator('#pause-overlay')).toBeVisible(); await expect(guest.locator('#pause-overlay')).toBeVisible(); expect(room.players.get(room.hostId).weaponId).toBe('sniper');
    expect(registrations).toHaveLength(2); expect(errors).toEqual([]); for (const page of pages) expect(await page.evaluate(() => Object.keys(localStorage).some((key) => /token|password|session/i.test(key)))).toBe(false);
  } finally { for (const context of contexts) await context.close(); await engine.close(); }
});
