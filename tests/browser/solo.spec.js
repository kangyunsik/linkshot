import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { MAPS } from '../../shared/world.js';

test.use({ baseURL: process.env.SOLO_SOURCE_TEST ? `http://127.0.0.1:${process.env.LAN_TEST_PORT || 3000}` : 'http://127.0.0.1:4173' });
test.beforeEach(async ({ context }) => {
  if (process.env.SOLO_SOURCE_TEST) await context.route('**/runtime-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: "export const APP_MODE = 'solo'; export const PROFILE_STORAGE = 'browser';" }));
  await context.addInitScript(() => { try { localStorage.setItem('sector07-settings', JSON.stringify({ sensitivity: 1, fov: 82, volume: 0, quality: 'low' })); } catch { /* about:blank */ } });
});

test('static solo build supports loadout selection, scope, live weapon lock and reload without a server', async ({ page }) => {
  const errors = [], requests = [], sockets = [];
  page.on('pageerror', (error) => errors.push(error.message)); page.on('request', (request) => requests.push(request.url())); page.on('websocket', (socket) => sockets.push(socket.url()));
  await page.goto('/'); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await expect(page).toHaveTitle(/^LINKSHOT/);
  await expect(page.getByRole('tab', { name: 'LAN 대전' })).toBeHidden(); await expect(page.locator('#join-section')).toBeHidden();
  await page.getByRole('button', { name: '전장 변경', exact: false }).click();
  await expect(page.locator('.map-choice')).toHaveCount(6);
  await page.getByRole('button', { name: '레드라인 전장 선택', exact: true }).click(); await expect(page.locator('#hero-map-name')).toHaveText('REDLINE 19');
  await page.getByRole('button', { name: '무기 및 스킨 선택' }).click();
  await expect(page.locator('#weapon-choices button')).toHaveCount(19); await expect(page.locator('#skin-choices button')).toHaveCount(6);
  await page.getByRole('button', { name: '저격소총 SR–1 선택' }).click(); await page.getByRole('button', { name: '아크틱 고스트 스킨', exact: true }).click();
  await expect(page.locator('#weapon-stats')).toContainText('100 / HEAD 150');
  await expect(page.locator('#armory-skin-name')).toHaveText('ARCTIC GHOST');
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/armory.png' });
  await page.getByRole('button', { name: '장비 저장', exact: true }).click();
  await page.reload(); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sector07-loadout')))).toEqual({ mapId: 'redline', weaponId: 'sniper', skinId: 'arctic' });
  await page.getByRole('button', { name: '봇 한 명 줄이기' }).click();
  await page.getByRole('button', { name: '연습전 시작', exact: true }).click(); await expect(page.locator('#pause-overlay')).toBeVisible();
  await expect(page.locator('#hud-map-name')).toHaveText('REDLINE 19'); await expect(page.locator('#hud-weapon-name')).toHaveText('SR–1'); await expect(page.locator('#hud-ammo')).toHaveText('05'); await expect(page.locator('#hud-skin-name')).toHaveText('ARCTIC GHOST');
  await page.getByRole('button', { name: '교전 시작', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game-canvas');
  await page.keyboard.down('KeyC'); await expect(page.locator('#hud-stance')).toBeVisible();
  await page.keyboard.up('KeyC'); await expect(page.locator('#hud-stance')).toBeHidden();
  await page.mouse.down({ button: 'right' }); await expect(page.locator('#scope-overlay')).toBeVisible(); await page.screenshot({ path: 'artifacts/redline-scope.png' });
  await page.mouse.up({ button: 'right' }); await expect(page.locator('#scope-overlay')).toBeHidden();
  for (let slot = 1; slot <= 7; slot++) await page.keyboard.press(`Digit${slot}`);
  await page.mouse.wheel(0, 100); await expect(page.locator('#hud-weapon-name')).toHaveText('SR–1');
  await page.mouse.down(); await expect(page.locator('#hud-ammo')).toHaveText('04');
  // A held trigger cannot fire the bolt-action rifle a second time.
  const heldAt = Date.now();
  await expect.poll(async () => { await expect(page.locator('#hud-ammo')).toHaveText('04'); return Date.now() - heldAt; }, { intervals: [100, 150, 200], timeout: 3000 }).toBeGreaterThan(1200);
  await page.mouse.up(); await page.keyboard.press('KeyR'); await expect(page.locator('#reload-indicator')).toBeVisible(); await expect(page.locator('#hud-ammo')).toHaveText('05');
  await page.screenshot({ path: 'artifacts/solo-redline.png' });
  await page.evaluate(() => document.exitPointerLock()); await expect(page.locator('#pause-overlay')).toBeVisible();
  await page.getByRole('button', { name: '로비로 나가기', exact: true }).click(); await expect(page.locator('#lobby')).toBeVisible();
  expect(sockets).toEqual([]); expect(requests.some((url) => url.includes('/api/'))).toBe(false);
  expect(requests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true); expect(errors).toEqual([]);
});

test('solo rounds end and restart locally without any backend', async ({ context, page }) => {
  await context.route('**/shared/simulation.js', async (route) => {
    const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replaceAll('this.startedAt + this.roundSeconds * 1000', 'this.startedAt + 2000') });
  });
  await page.goto('/'); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await page.getByRole('button', { name: '연습전 시작', exact: true }).click();
  await expect(page.locator('#round-overlay')).toBeVisible(); await expect(page.locator('#round-table')).toContainText('BOT');
  await page.getByRole('button', { name: '다시 출격', exact: true }).click(); await expect(page.locator('#round-overlay')).toBeHidden(); await expect(page.locator('#pause-overlay')).toBeVisible();
  await page.getByRole('button', { name: '로비로 나가기', exact: true }).click(); await expect(page.locator('#lobby')).toBeVisible();
});

test('every arena can be entered and disposed in the static build', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/'); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  for (const map of MAPS) {
    await page.getByRole('button', { name: '전장 변경', exact: false }).click(); await page.getByRole('button', { name: `${map.label} 전장 선택`, exact: true }).click();
    await page.getByRole('button', { name: '연습전 시작', exact: true }).click(); await expect(page.locator('#pause-overlay')).toBeVisible();
    await expect(page.locator('#hud-map-name')).toHaveText(map.name);
    await page.getByRole('button', { name: '로비로 나가기', exact: true }).click(); await expect(page.locator('#lobby')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('solo worker preserves bot difficulty and E-selected weapon, then accepts movement after respawn', async ({ context, page }) => {
  await context.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { constructor(...args) { super(...args); this.addEventListener('message', ({ data }) => { if (data.type === 'state' || data.type === 'joined') window.__soloState = data; }); } };
  });
  await context.route('**/shared/simulation.js', async (route) => {
    const response = await route.fetch();
    const code = (await response.text()).replace('tick(dt) {', "tick(dt) { if (!this.__testDeath && this.players.has('local-operator')) { const p = this.players.get('local-operator'); p.hp = 0; p.diedAt = this.clock(); p.respawnAt = p.diedAt + 3000; this.__testDeath = true; }");
    await route.fulfill({ response, body: code });
  });
  await page.goto('/'); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await page.getByLabel('봇 난이도', { exact: true }).selectOption('advanced'); await page.reload();
  await expect(page.getByLabel('봇 난이도', { exact: true })).toHaveValue('advanced');
  await page.getByRole('button', { name: '연습전 시작', exact: true }).click(); await expect(page.locator('#respawn-overlay')).toBeVisible();
  await page.keyboard.press('KeyE'); await expect(page.locator('#respawn-loadout')).toBeVisible();
  await page.locator('#respawn-weapon-choices [data-weapon=sniper]').click();
  await expect(page.locator('#hud-weapon-name')).toHaveText('SR–1'); await expect(page.locator('#respawn-overlay')).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game-canvas');
  expect(await page.evaluate(() => window.__soloState.room.botDifficulty)).toBe('advanced');
  const position = await page.evaluate(() => { const p = window.__soloState.players.find((p) => p.id === 'local-operator'); return { x: p.x, z: p.z }; });
  await page.keyboard.down('KeyW');
  await expect.poll(() => page.evaluate((origin) => { const p = window.__soloState.players.find((p) => p.id === 'local-operator'); return Math.hypot(p.x - origin.x, p.z - origin.z); }, position)).toBeGreaterThan(0.8);
  await page.keyboard.up('KeyW');
});
