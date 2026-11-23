import { test, expect } from '@playwright/test';

test.use({ baseURL: `http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}` });

test('free range works offline with weapon and distance selection, confirmed impacts, and no profile changes', async ({ page }) => {
  const sockets = [], errors = [];
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/runtime-config.js', route => route.fulfill({
    contentType: 'text/javascript', body: "export const APP_MODE = 'solo'; export const PROFILE_STORAGE = 'browser';",
  }));
  await page.addInitScript(() => localStorage.setItem('sector07-settings', JSON.stringify({ sensitivity: 1, fov: 82, volume: 0, quality: 'low' })));
  await page.goto('/');
  const entry = page.getByRole('button', { name: '자유 사격장', exact: true });
  await expect(entry).toBeEnabled();
  const profile = () => page.evaluate(() => {
    const { kills, points, weaponKills, ownedWeapons, roundsPlayed } = JSON.parse(localStorage.getItem('linkshot-profile-v1'));
    return { kills, points, weaponKills, ownedWeapons, roundsPlayed, loadout: localStorage.getItem('sector07-loadout') };
  });
  const initial = await profile();
  expect(initial.ownedWeapons).not.toContain('m4a1');
  await entry.click();
  await expect(page.locator('#range-setup')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('combobox', { name: '총기', exact: true }).selectOption('m4a1');
  await page.getByRole('combobox', { name: '표적 거리', exact: true }).selectOption('10');
  await page.getByRole('button', { name: '적용 · 탄착 초기화' }).click();
  await expect(page.locator('#hud-weapon-name')).toHaveText('M4A1');
  await expect(page.locator('#range-distance-label')).toHaveText('기준선 10m');
  await page.getByRole('button', { name: '사격 시작', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game-canvas');
  await page.mouse.down();
  await expect.poll(() => page.locator('#range-hits').textContent().then(Number)).toBeGreaterThan(0);
  await page.mouse.up();
  await expect(page.locator('#range-accuracy')).toContainText('%');
  const plotted = await page.locator('#range-plot').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, i) => i % 4 === 0 && value === 177 && pixels[i + 1] === 237 && pixels[i + 2] === 213);
  });
  expect(plotted).toBe(true);
  await page.evaluate(() => document.exitPointerLock());
  await expect(page.locator('#pause-overlay')).toBeVisible();
  await page.getByRole('combobox', { name: '표적 거리', exact: true }).selectOption('60');
  await page.getByRole('button', { name: '적용 · 탄착 초기화' }).click();
  await expect(page.locator('#range-distance-label')).toHaveText('기준선 60m');
  await expect(page.locator('#range-shots')).toHaveText('0');
  await page.getByRole('button', { name: '로비로 나가기', exact: true }).click();
  await expect(page.locator('#range-hud')).toBeHidden();
  await expect(entry).toBeVisible();
  expect(await profile()).toEqual(initial);
  expect(errors).toEqual([]);
  expect(sockets).toEqual([]);
});
