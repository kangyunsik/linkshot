import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const sizes = [[1920,1080], [1440,900], [1366,768], [1280,720], [1024,600], [820,768], [740,667], [390,844], [375,667], [360,640]];
for (const edition of ['LAN', 'SOLO']) test(`${edition} dashboard fits every mode in one viewport without clipping navigation or requiring page scroll`, async ({ page }) => {
  test.setTimeout(90_000); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(edition === 'LAN' ? '/' : `http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`);
  await expect(page.getByText(edition === 'LAN' ? 'LAN SERVER ONLINE' : 'SOLO READY · LOCAL SIMULATION')).toBeVisible();
  for (const [width,height] of sizes) {
    await page.setViewportSize({ width,height });
    for (const mode of ['튜토리얼','혼자 연습','LAN 대전','일반','랭크','사용자 대전']) {
      await page.getByRole('tab', { name: mode, exact: true }).click();
      const layout = await page.evaluate(() => {
        const selectors = ['#profile-button','#nav-play','#nav-armory','#mode-information-button','#create-button','#rank-card','#armory-button','#network-button','#profile-casual-rating','#profile-rank-tier', '.mode-switch'];
        const outside = selectors.filter((selector) => { const rect = document.querySelector(selector).getBoundingClientRect(); return rect.width <= 0 || rect.height <= 0 || rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1; });
        const card = document.querySelector('.deploy-card').getBoundingClientRect();
        const clipped = [...document.querySelectorAll('.deploy-card button')].filter((node) => node.checkVisibility()).filter((node) => { const rect = node.getBoundingClientRect(); return rect.top < card.top - 1 || rect.bottom > card.bottom + 1; }).map((node) => node.id);
        const overflowing = document.documentElement.scrollWidth > innerWidth ? [...document.querySelectorAll('#lobby *')].filter((node) => node.checkVisibility() && node.getBoundingClientRect().right > innerWidth + .5).map((node) => ({ node: node.id || node.className, right: node.getBoundingClientRect().right })).slice(-12) : [];
        return { pageHeight: document.documentElement.scrollHeight, pageWidth: document.documentElement.scrollWidth, outside, clipped, overflowing };
      });
      expect(layout, `${edition} ${width}×${height} ${mode}`).toEqual({ pageHeight: height, pageWidth: width, outside: [], clipped: [], overflowing: [] });
      const spacing = await page.evaluate(() => { const description = document.getElementById('mode-description').getBoundingClientRect(), actions = document.querySelector('.deployment-actions').getBoundingClientRect(), rail = document.querySelector('.operation-rail').getBoundingClientRect(), card = document.querySelector('.deploy-card').getBoundingClientRect(), tools = document.querySelector('.briefing-grid').getBoundingClientRect(); return { deadGap: actions.top - description.bottom, railFits: card.top >= rail.top - 1 && tools.bottom <= rail.bottom + 1 }; });
      expect(spacing.deadGap).toBeLessThan(34); expect(spacing.railFits, `${edition} ${width}×${height}`).toBe(true);
      const tiles = await page.locator('.briefing-grid > button').evaluateAll((nodes) => nodes.map((node) => ({ width: node.getBoundingClientRect().width,height: node.getBoundingClientRect().height })));
      expect(tiles).toHaveLength(3); expect(Math.max(...tiles.map((tile) => tile.width)) - Math.min(...tiles.map((tile) => tile.width))).toBeLessThanOrEqual(1); expect(Math.max(...tiles.map((tile) => tile.height)) - Math.min(...tiles.map((tile) => tile.height))).toBeLessThanOrEqual(1);
    }
  }
  await mkdir('artifacts', { recursive: true }); await page.setViewportSize({ width: 1366,height: 768 }); await page.screenshot({ path: `artifacts/dashboard-one-screen-${edition.toLowerCase()}.png` }); expect(errors).toEqual([]);
});

test('modal headers and actions stay reachable on short screens, background scrolling is locked and nested dialogs restore focus', async ({ page }) => {
  await page.setViewportSize({ width: 1024,height: 600 }); await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  await page.locator('#create-button').click(); await expect(page.locator('#room-create-dialog')).toBeVisible();
  const bounds = await page.locator('#room-create-dialog').evaluate((dialog) => { const footer = dialog.querySelector('.dialog-footer').getBoundingClientRect(), header = dialog.querySelector('.dialog-heading').getBoundingClientRect(); return { footerVisible: footer.bottom <= innerHeight && footer.top > 0, headerVisible: header.top >= 0, scrollRegion: !!dialog.querySelector('.dialog-body') }; });
  expect(bounds).toEqual({ footerVisible: true, headerVisible: true, scrollRegion: true });
  await page.getByLabel('방 설정 닫기').click(); await expect(page.locator('#room-create-dialog')).toBeHidden();
  await page.locator('#mode-information-button').click(); await expect(page.locator('#mode-info-dialog')).toBeVisible(); await page.getByRole('button', { name: '프로필 / 계정', exact: true }).click(); await expect(page.locator('#profile-dialog')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#profile-dialog')).toBeHidden(); await expect(page.locator('#mode-info-dialog')).toBeVisible(); await expect(page.getByRole('button', { name: '프로필 / 계정', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('#mode-info-dialog')).toBeHidden(); await expect(page.locator('#mode-information-button')).toBeFocused();
  await page.setViewportSize({ width: 360,height: 640 }); await page.getByRole('button', { name: '플레이 방법', exact: true }).click(); await expect(page.locator('#help-dialog')).toBeVisible();
  await page.locator('#help-dialog .dialog-body').evaluate((node) => { node.scrollTop = node.scrollHeight; }); await page.mouse.move(2,2); await page.mouse.wheel(0,700);
  expect(await page.evaluate(() => scrollY)).toBe(0); await expect(page.getByLabel('도움말 닫기')).toBeInViewport(); await page.keyboard.press('Escape'); await expect(page.locator('#help-dialog')).toBeHidden(); expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(640);
  await page.getByRole('tab',{ name: '혼자 연습',exact: true }).click(); await page.getByRole('button',{ name: '전장 변경',exact: true }).click(); await expect(page.locator('#maps-dialog')).toBeVisible(); await page.getByRole('button',{ name: '레드라인 전장 선택',exact: true }).click(); await expect(page.locator('#maps-dialog')).toBeHidden();
  await page.locator('#rank-card').click(); await expect(page.locator('#rank-dialog')).toBeVisible(); expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sector07-loadout')).mapId)).toBe('redline'); await page.keyboard.press('Escape'); await expect(page.locator('#rank-card')).toBeFocused();
});
