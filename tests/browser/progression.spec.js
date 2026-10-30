import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createProfile } from '../../shared/progression.js';

test.use({ baseURL: 'http://127.0.0.1:4173' });
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => { try { localStorage.setItem('sector07-settings', JSON.stringify({ sensitivity: 1, fov: 82, volume: 0, quality: 'low' })); } catch { /* about:blank */ } });
});

test('main menu restores cumulative statistics and cosmetic purchases survive refresh', async ({ context, page }) => {
  const profile = createProfile('demo-device-0001', Date.now(), 'TESTER');
  Object.assign(profile, { kills: 12, deaths: 4, points: 600, totalEarned: 600 });
  await context.addInitScript((initial) => { try { if (!localStorage.getItem('linkshot-profile-v1')) localStorage.setItem('linkshot-profile-v1', JSON.stringify(initial)); } catch { /* about:blank */ } }, profile);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/'); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await expect(page.locator('#profile-kills')).toHaveText('12'); await expect(page.locator('#profile-deaths')).toHaveText('4'); await expect(page.locator('#profile-ratio')).toHaveText('3.00'); await expect(page.locator('#profile-points')).toHaveText('600');
  await page.getByRole('button', { name: '캐릭터 외형 상점', exact: true }).click(); await expect(page.locator('#outfit-choices button')).toHaveCount(5);
  await page.getByRole('button', { name: '보이드 러너 외형 미리보기', exact: true }).click();
  await page.getByRole('button', { name: '250 LP로 구매', exact: true }).click(); await expect(page.locator('#purchase-dialog')).toBeVisible();
  await page.getByRole('button', { name: '구매 후 장착', exact: true }).click(); await expect(page.locator('#purchase-dialog')).toBeHidden();
  await expect(page.locator('#shop-points')).toHaveText('350'); await expect(page.locator('#shop-owned-state')).toHaveText('현재 장착 중');
  await expect(page.locator('#shop-action')).toBeDisabled();
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/operator-shop.png' });
  await page.getByRole('button', { name: '외형 상점 닫기', exact: true }).click(); await page.reload(); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await expect(page.locator('#profile-points')).toHaveText('350'); await expect(page.locator('#profile-kills')).toHaveText('12');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).equippedOutfitId)).toBe('runner');
  await page.getByRole('button', { name: '캐릭터 외형 상점', exact: true }).click(); await page.getByRole('button', { name: '오비탈 가드 외형 미리보기', exact: true }).click();
  await expect(page.locator('#shop-action')).toBeDisabled(); await expect(page.locator('#shop-point-note')).toContainText('550 LP');
  await page.getByRole('button', { name: '기본 오퍼레이터 외형 미리보기', exact: true }).click(); await page.getByRole('button', { name: '이 외형 장착', exact: true }).click();
  await expect(page.locator('#shop-points')).toHaveText('350'); expect(await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).equippedOutfitId)).toBe('field');
  await page.getByRole('button', { name: '외형 상점 닫기', exact: true }).click(); expect(errors).toEqual([]);
});

test('completion reward is paid once, persists after refresh, and a new round can earn separately', async ({ context, page }) => {
  await context.route('**/shared/world.js', async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('roundSeconds: 300', 'roundSeconds: 2') }); });
  await page.goto('/'); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible(); const identity = await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).id);
  await page.getByRole('button', { name: '연습전 시작', exact: true }).click(); await expect(page.locator('#round-overlay')).toBeVisible();
  await expect(page.locator('#round-reward')).toBeVisible(); await expect(page.locator('#round-points')).toHaveText('50'); await expect(page.locator('#profile-points')).toHaveText('50');
  await page.getByRole('button', { name: '로비로 돌아가기', exact: true }).click(); await page.reload(); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await expect(page.locator('#profile-points')).toHaveText('50'); expect(await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).id)).toBe(identity);
  await page.getByRole('button', { name: '연습전 시작', exact: true }).click(); await expect(page.locator('#round-overlay')).toBeVisible(); await expect(page.locator('#profile-points')).toHaveText('100');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).roundsPlayed)).toBe(2);
});

test('leaving before round completion does not grant participation points', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await page.getByRole('button', { name: '연습전 시작', exact: true }).click(); await expect(page.locator('#pause-overlay')).toBeVisible();
  await page.getByRole('button', { name: '로비로 나가기', exact: true }).click(); await expect(page.locator('#profile-points')).toHaveText('0');
  await page.reload(); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).roundsPlayed)).toBe(0);
});
