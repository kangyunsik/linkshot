import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { if (!localStorage.getItem('sector07-settings')) localStorage.setItem('sector07-settings', JSON.stringify({ sensitivity: 1, fov: 82, volume: 0, quality: 'low' })); } catch { /* about:blank has no storage origin. */ }
  });
});

test('lobby, generated assets, map, settings persistence and responsive layout', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  await expect(page).toHaveTitle(/^LINKSHOT/);
  await expect(page.getByRole('heading', { name: '같은 공간, 하나의 전장.' })).toBeVisible();
  const asset = await page.request.get('/assets/foundry-hero.png'); expect(asset.ok()).toBeTruthy(); expect(asset.headers()['content-type']).toBe('image/png');
  await page.getByRole('button', { name: '전장 브리핑', exact: true }).click();
  await expect(page.locator('#briefing-dialog')).toBeVisible();
  await page.getByRole('button', { name: '맵 브리핑 닫기' }).click();
  await page.getByRole('button', { name: '설정', exact: true }).first().click();
  await page.locator('#fov').fill('95'); await expect(page.locator('#fov-value')).toHaveText('95°');
  await page.getByRole('button', { name: '완료', exact: true }).click();
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sector07-settings')).fov)).toBe(95);
  await page.getByRole('button', { name: '열린 방 보기' }).click(); await expect(page.locator('#rooms-dialog')).toBeVisible();
  await page.getByRole('button', { name: '방 목록 닫기' }).click();
  // Public documentation screenshots must not retain this machine's real LAN address.
  await page.locator('#lan-address').evaluate((element) => { element.textContent = '192.0.2.10:3000'; });
  await page.locator('#profile-device').evaluate((element) => { element.textContent = '기기 #DEMO'; });
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/lobby-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'artifacts/lobby-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('two browser clients share a room; pointer lock, movement, firing, reload, scoreboard and leave work', async ({ browser, page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  let state;
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    try { const data = JSON.parse(String(payload)); if (data.type === 'state') state = data; } catch { /* Ignore non-JSON frames. */ }
  }));
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  await page.getByLabel('플레이어 콜사인').fill('ALPHA');
  await page.getByRole('button', { name: '봇 한 명 줄이기' }).click(); await page.getByRole('button', { name: '봇 한 명 줄이기' }).click();
  await page.getByRole('button', { name: '방 만들고 출격' }).click();
  await expect(page.locator('#game-shell')).toBeVisible(); await expect(page.locator('#pause-overlay')).toBeVisible();
  const code = await page.locator('#pause-room-code').textContent(); expect(code).toMatch(/^[A-Z2-9]{5}$/);
  await page.getByRole('button', { name: '교전 시작', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game-canvas');
  await expect.poll(() => state?.players.length).toBe(1);
  const initial = { ...state.players[0] };
  await page.keyboard.down('KeyW');
  await expect.poll(() => state && Math.hypot(state.players[0].x - initial.x, state.players[0].z - initial.z)).toBeGreaterThan(1.5);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyC'); await expect.poll(() => state?.players[0].crouching).toBe(true); await expect(page.locator('#hud-stance')).toBeVisible();
  await page.keyboard.up('KeyC'); await expect.poll(() => state?.players[0].crouching).toBe(false); await expect(page.locator('#hud-stance')).toBeHidden();
  await page.keyboard.down('ControlLeft'); await expect.poll(() => state?.players[0].crouching).toBe(true);
  await page.keyboard.up('ControlLeft'); await expect.poll(() => state?.players[0].crouching).toBe(false);
  await page.mouse.down(); await expect.poll(() => state?.players[0].ammo).toBeLessThan(29); await page.mouse.up();
  await page.keyboard.press('KeyR'); await expect(page.locator('#reload-indicator')).toBeVisible();
  await expect(page.locator('#hud-ammo')).toHaveText('30');
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/gameplay.png' });
  await page.evaluate(() => document.exitPointerLock()); await expect(page.locator('#pause-overlay')).toBeVisible();
  const context2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context2.addInitScript(() => { try { localStorage.setItem('sector07-settings', JSON.stringify({ sensitivity: 1, fov: 82, volume: 0, quality: 'low' })); } catch { /* about:blank */ } });
  const second = await context2.newPage(); second.on('pageerror', (error) => errors.push(error.message));
  try {
    await second.goto(new URL('/', page.url()).href); await expect(second.getByText('LAN SERVER ONLINE')).toBeVisible();
    await second.getByLabel('플레이어 콜사인').fill('BRAVO'); await second.getByLabel('참가할 방 코드').fill(code);
    await second.getByRole('button', { name: '코드로 방 참가' }).click();
    await expect(second.locator('#game-shell')).toBeVisible(); await expect.poll(() => state?.players.length).toBe(2);
    await page.bringToFront(); await page.keyboard.down('Tab');
    await expect(page.locator('#scoreboard-table')).toContainText('ALPHA'); await expect(page.locator('#scoreboard-table')).toContainText('BRAVO');
    await page.keyboard.up('Tab'); await expect(page.locator('#scoreboard-overlay')).toBeHidden();
    await page.getByRole('button', { name: '로비로 나가기', exact: true }).click(); await expect(page.locator('#lobby')).toBeVisible();
    await second.bringToFront(); await second.getByRole('button', { name: '로비로 나가기', exact: true }).click(); await expect(second.locator('#lobby')).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context2.close(); }
});

test('practice mode spawns bots and invalid room codes fail without trapping the UI', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  await page.getByLabel('참가할 방 코드').fill('ZZZZZ'); await page.getByRole('button', { name: '코드로 방 참가' }).click();
  await expect(page.locator('.toast.error')).toContainText('방을 찾을 수 없습니다'); await expect(page.locator('#loading-overlay')).toBeHidden();
  await page.getByRole('tab', { name: '혼자 연습' }).click(); await page.getByRole('button', { name: '연습전 시작' }).click();
  await expect(page.locator('#pause-overlay')).toBeVisible(); await expect(page.locator('#copy-invite')).toBeHidden();
  await page.keyboard.down('Tab'); await expect(page.locator('#scoreboard-table')).toContainText('BOT'); await page.keyboard.up('Tab');
  await page.getByRole('button', { name: '로비로 나가기', exact: true }).click(); await expect(page.locator('#lobby')).toBeVisible();
});

test('plain-HTTP LAN origin supports invite auto-join, clipboard fallback and pointer lock', async ({ browser, context, page }) => {
  const info = await (await page.request.get('/api/info')).json();
  test.skip(!info.urls.length, 'This environment has no private IPv4 LAN interface.');
  const lan = info.urls[0], errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.addInitScript(() => { try { localStorage.setItem('sector07-settings', JSON.stringify({ sensitivity: 1, fov: 82, volume: 0, quality: 'normal' })); } catch { /* about:blank */ } });
  await page.goto(lan); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await page.getByRole('button', { name: '봇 한 명 줄이기' }).click(); await page.getByRole('button', { name: '봇 한 명 줄이기' }).click();
  await page.getByRole('button', { name: '방 만들고 출격' }).click(); await expect(page.locator('#pause-overlay')).toBeVisible();
  const code = await page.locator('#pause-room-code').textContent();
  await page.getByRole('button', { name: /친구 초대 링크 복사/ }).click();
  await expect(page.locator('.toast')).toContainText('초대 링크를 복사했습니다');
  const invitedContext = await browser.newContext();
  await invitedContext.addInitScript(() => { try { localStorage.setItem('sector07-settings', JSON.stringify({ sensitivity: 1, fov: 82, volume: 0, quality: 'low' })); } catch { /* about:blank */ } });
  try {
    const invited = await invitedContext.newPage(); invited.on('pageerror', (error) => errors.push(error.message));
    await invited.goto(`${lan}/?room=${code}`); await expect(invited.locator('#pause-overlay')).toBeVisible();
    await expect(invited.locator('#pause-room-code')).toHaveText(code);
    await page.bringToFront(); await page.getByRole('button', { name: '교전 시작', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game-canvas');
    await page.keyboard.press('KeyF'); await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('game-shell');
    await page.screenshot({ path: 'artifacts/gameplay-standard.png' });
    await page.evaluate(() => document.exitPointerLock()); await expect(page.locator('#pause-overlay')).toBeVisible();
    await page.getByRole('button', { name: '로비로 나가기', exact: true }).click(); await expect(page.locator('#lobby')).toBeVisible();
    await invited.bringToFront(); await invited.getByRole('button', { name: '로비로 나가기', exact: true }).click();
    expect(errors).toEqual([]);
  } finally { await invitedContext.close(); }
});
