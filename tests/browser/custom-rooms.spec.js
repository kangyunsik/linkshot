import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createGameServer } from '../../server/index.js';
import { getWeapon } from '../../shared/catalog.js';
import { services, onlinePage } from './online-fixtures.js';

test('LAN room creation and password browser UI place teams on opposite sides, show team victory and permit only the host to restart', async ({ browser }) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1', loop: false }), info = await app.listen(), a = await browser.newContext(), b = await browser.newContext(), password = randomUUID();
  try {
    const host = await a.newPage(), guest = await b.newPage(), origin = `http://127.0.0.1:${info.port}`; await host.goto(origin); await expect(host.getByText('LAN SERVER ONLINE')).toBeVisible();
    await host.locator('#bots-minus').click(); await host.locator('#bots-minus').click(); await host.locator('#room-title').fill('PRIVATE LAN'); await host.locator('#room-password').fill(password); await host.locator('#room-game-type').selectOption('teams'); await host.locator('#frag-limit').fill('1'); await host.getByRole('button', { name: '방 만들고 출격', exact: true }).click(); await expect(host.locator('#pause-overlay')).toBeVisible();
    await guest.goto(origin); await expect(guest.getByText('LAN SERVER ONLINE')).toBeVisible(); await guest.locator('#room-browser-button').click(); await expect(guest.locator('#room-list')).toContainText('PRIVATE LAN'); await expect(guest.locator('#room-list')).toContainText('비밀번호'); await guest.locator('#room-list').getByRole('button', { name: '참가', exact: true }).click();
    await guest.locator('#room-join-password').fill('wrong'); await guest.getByRole('button', { name: '확인하고 입장', exact: true }).click(); await expect(guest.locator('#room-password-error')).toContainText('비밀번호'); await guest.locator('#room-join-password').fill(password); await guest.getByRole('button', { name: '확인하고 입장', exact: true }).click(); await expect(guest.locator('#pause-overlay')).toBeVisible();
    const room = [...app.rooms.values()][0], [blue, red] = [...room.players.values()]; expect(blue.teamId).toBe('blue'); expect(red.teamId).toBe('red'); expect(blue.x).toBeLessThan(red.x); app.broadcast(); await expect(host.locator('#team-score-hud')).toBeVisible();
    room.applyDamage(blue, red, 100, false, {}, getWeapon('rifle'), Date.now()); app.broadcast(); await expect(host.locator('#round-winner')).toContainText('블루팀 승리'); await expect(guest.locator('#round-winner')).toContainText('블루팀 승리'); await expect(host.locator('#team-score-blue')).toHaveText('1'); await expect(guest.locator('#restart-button')).toBeHidden();
    await host.locator('#restart-button').click(); await expect.poll(() => room.phase).toBe('active'); app.broadcast(); await expect(host.locator('#round-overlay')).toBeHidden(); await expect(host.locator('#team-score-blue')).toHaveText('0');
  } finally { await a.close(); await b.close(); await app.close(); }
});

test('WAN user rooms authenticate two accounts, list locked team rooms, reject a wrong password and preserve competitive/device progression', async ({ browser }) => {
  test.skip(process.env.ONLINE_BROWSER_TEST !== '1', 'Optional real Spring/PostgreSQL integration.'); test.setTimeout(180_000);
  const origin = `http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`, backend = await services(origin, { engine: true }), a = await browser.newContext(), b = await browser.newContext(), password = randomUUID();
  try {
    const host = await onlinePage(a, backend.apiUrl, origin, '사용자 대전', 10), guest = await onlinePage(b, backend.apiUrl, origin, '사용자 대전', 11);
    for (const player of [host, guest]) await expect(player.page.getByText('CUSTOM ROOMS CONNECTED')).toBeVisible();
    await host.page.locator('#bots-minus').click(); await host.page.locator('#bots-minus').click(); await host.page.locator('#room-title').fill('WAN PRIVATE TEAMS'); await host.page.locator('#room-password').fill(password); await host.page.locator('#room-game-type').selectOption('teams'); await host.page.locator('#round-minutes').fill('1'); await host.page.getByRole('button', { name: '사용자 방 만들기', exact: true }).click(); await expect(host.page.locator('#pause-overlay')).toBeVisible();
    await guest.page.locator('#room-browser-button').click(); await expect(guest.page.locator('#room-list')).toContainText('WAN PRIVATE TEAMS'); expect(await guest.page.locator('#room-list').textContent()).not.toContain(password); await guest.page.locator('#room-list').getByRole('button', { name: '참가', exact: true }).click(); await guest.page.locator('#room-join-password').fill('incorrect'); await guest.page.getByRole('button', { name: '확인하고 입장', exact: true }).click(); await expect(guest.page.locator('#room-password-error')).toContainText('비밀번호');
    await guest.page.locator('#room-join-password').fill(password); await guest.page.getByRole('button', { name: '확인하고 입장', exact: true }).click(); await expect(guest.page.locator('#pause-overlay')).toBeVisible(); await expect(guest.page.locator('#hud-connection-kind')).toHaveText('CUSTOM'); await expect.poll(() => host.state.latest?.players.length).toBe(2); expect(host.state.latest.room.gameType).toBe('teams'); expect(new Set(host.state.latest.players.map((p) => p.teamId)).size).toBe(2);
    await expect(host.page.locator('#round-overlay')).toBeVisible({ timeout: 70_000 }); await expect(guest.page.locator('#round-overlay')).toBeVisible(); await expect(host.page.locator('#custom-progress-note')).toBeVisible(); await expect(host.page.locator('#round-reward')).toBeHidden();
    const before = host.state.latest.room.roundId; await host.page.locator('#restart-button').click(); await expect.poll(() => host.state.latest?.room.roundId).not.toBe(before); expect(host.state.latest.room.phase).toBe('active');
    const account = await host.page.evaluate(async (api) => (await fetch(api + '/api/account', { credentials: 'include' })).json(), backend.apiUrl); expect(account.roundsPlayed).toBe(0); expect(account.points).toBe(0); expect(account.casualRating).toBe(1000); expect(account.placementsPlayed).toBe(0); expect(account.ownedWeapons).toHaveLength(4); expect(await host.page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).points)).toBe(1234); expect(host.state.errors).toEqual([]); expect(guest.state.errors).toEqual([]);
  } finally { await a.close(); await b.close(); await backend.close(); }
});
