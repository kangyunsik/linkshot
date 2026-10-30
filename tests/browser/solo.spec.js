import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { MAPS } from '../../shared/world.js';

test.use({ baseURL: process.env.SOLO_SOURCE_TEST ? 'http://127.0.0.1:3000' : 'http://127.0.0.1:4173' });
test.beforeEach(async ({ context }) => {
  if (process.env.SOLO_SOURCE_TEST) await context.route('**/runtime-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: "export const APP_MODE = 'solo';" }));
  await context.addInitScript(() => { try { localStorage.setItem('sector07-settings', JSON.stringify({ sensitivity: 1, fov: 82, volume: 0, quality: 'low' })); } catch { /* about:blank */ } });
});

test('static solo build supports map/skin selection, four weapons, scope and independent magazines without a server', async ({ page }) => {
  const errors = [], requests = [], sockets = [];
  page.on('pageerror', (error) => errors.push(error.message)); page.on('request', (request) => requests.push(request.url())); page.on('websocket', (socket) => sockets.push(socket.url()));
  await page.goto('/'); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await expect(page).toHaveTitle(/^LINKSHOT/);
  await expect(page.getByRole('tab', { name: 'LAN 대전' })).toBeHidden(); await expect(page.locator('#join-section')).toBeHidden();
  await page.getByRole('button', { name: '전장 변경', exact: false }).click();
  await expect(page.locator('.map-choice')).toHaveCount(6);
  await page.getByRole('button', { name: '레드라인 전장 선택', exact: true }).click(); await expect(page.locator('#hero-map-name')).toHaveText('REDLINE 19');
  await page.getByRole('button', { name: '무기 및 스킨 선택' }).click();
  await expect(page.locator('#weapon-choices button')).toHaveCount(4); await expect(page.locator('#skin-choices button')).toHaveCount(6);
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
  await page.mouse.down({ button: 'right' }); await expect(page.locator('#scope-overlay')).toBeVisible(); await page.screenshot({ path: 'artifacts/redline-scope.png' });
  await page.mouse.up({ button: 'right' }); await expect(page.locator('#scope-overlay')).toBeHidden();
  await page.keyboard.press('Digit2'); await expect(page.locator('#hud-weapon-name')).toHaveText('PD–9'); await expect(page.locator('#hud-ammo')).toHaveText('36');
  await expect(page.locator('#reload-hint')).not.toHaveText('EQUIPPING...');
  await page.mouse.down(); await expect.poll(async () => Number(await page.locator('#hud-ammo').textContent())).toBeLessThan(33); await page.mouse.up();
  await page.keyboard.press('KeyR'); await expect(page.locator('#reload-indicator')).toBeVisible(); await expect(page.locator('#hud-ammo')).toHaveText('36');
  await page.keyboard.press('Digit1'); await expect(page.locator('#hud-weapon-name')).toHaveText('VX–7'); await expect(page.locator('#reload-hint')).not.toHaveText('EQUIPPING...');
  await page.mouse.down(); await expect.poll(async () => Number(await page.locator('#hud-ammo').textContent())).toBeLessThan(29); await page.mouse.up();
  await expect(page.locator('#reload-hint')).not.toHaveText('EQUIPPING...');
  await page.keyboard.press('Digit3'); await expect(page.locator('#hud-weapon-name')).toHaveText('SG–12'); await expect(page.locator('#hud-ammo')).toHaveText('08');
  await expect(page.locator('#reload-hint')).not.toHaveText('EQUIPPING...'); await page.mouse.down(); await expect(page.locator('#hud-ammo')).toHaveText('07');
  // A held trigger must remain at 7 even after more than a full pump cycle.
  const heldAt = Date.now();
  await expect.poll(async () => { await expect(page.locator('#hud-ammo')).toHaveText('07'); return Date.now() - heldAt; }, { intervals: [100, 150, 200], timeout: 3000 }).toBeGreaterThan(1000);
  await page.mouse.up(); await page.keyboard.press('Digit4'); await expect(page.locator('#hud-weapon-name')).toHaveText('SR–1'); await expect(page.locator('#hud-ammo')).toHaveText('05');
  await page.mouse.wheel(0, 100); await expect(page.locator('#hud-weapon-name')).toHaveText('VX–7');
  await expect.poll(async () => Number(await page.locator('#hud-ammo').textContent())).toBeLessThan(29);
  await page.screenshot({ path: 'artifacts/solo-redline.png' });
  await page.evaluate(() => document.exitPointerLock()); await expect(page.locator('#pause-overlay')).toBeVisible();
  await page.getByRole('button', { name: '로비로 나가기', exact: true }).click(); await expect(page.locator('#lobby')).toBeVisible();
  expect(sockets).toEqual([]); expect(requests.some((url) => url.includes('/api/'))).toBe(false);
  expect(requests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true); expect(errors).toEqual([]);
});

test('solo rounds end and restart locally without any backend', async ({ context, page }) => {
  await context.route('**/shared/world.js', async (route) => {
    const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('roundSeconds: 300', 'roundSeconds: 2') });
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
