import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createGameServer } from '../../server/index.js';

test('the dashboard stays compact across modes and account/setup/armory dialogs animate, trap focus and respect reduced motion', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  const heights = [];
  for (const mode of ['LAN 대전', '일반', '랭크', '사용자 대전']) {
    await page.getByRole('tab', { name: mode, exact: true }).click(); heights.push(await page.locator('.deploy-card').evaluate((node) => node.getBoundingClientRect().height));
    await expect(page.locator('#online-auth-form')).toBeHidden(); await expect(page.locator('#room-title')).toBeHidden(); await expect(page.locator('#room-list')).toBeHidden();
  }
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(180);
  await page.locator('#profile-button').click(); await expect(page.locator('#profile-dialog')).toBeVisible(); await expect(page.locator('#online-username')).toBeVisible();
  await page.locator('#online-username').focus(); await page.keyboard.press('Shift+Tab'); expect(await page.evaluate(() => document.getElementById('profile-dialog').contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('#profile-dialog')).toBeHidden(); await expect(page.locator('#profile-button')).toBeFocused();
  await page.getByRole('tab', { name: 'LAN 대전', exact: true }).click(); await page.locator('#create-button').click(); await expect(page.locator('#room-create-dialog')).toBeVisible(); await expect(page.locator('#room-title')).toBeVisible(); await page.getByLabel('방 설정 닫기').click(); await expect(page.locator('#room-create-dialog')).toBeHidden();
  await page.locator('#nav-armory').click(); await expect(page.locator('#armory-dialog')).toBeVisible(); await expect(page.locator('#weapon-preview')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.locator('#armory-dialog')).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.locator('#profile-button').click(); expect(await page.locator('#profile-dialog').evaluate((node) => node.getAnimations().length)).toBe(0); await page.keyboard.press('Escape'); await expect(page.locator('#profile-dialog')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#profile-button').click(); expect(await page.locator('#profile-dialog').evaluate((node) => node.getBoundingClientRect().width <= innerWidth)).toBe(true); await page.keyboard.press('Escape'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.setViewportSize({ width: 1440, height: 1000 });
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/compact-dashboard.png', fullPage: true }); expect(errors).toEqual([]);
});

test('closing/reopening a dialog cancels stale exits and nested Escape closes only the top layer', async ({ page }) => {
  await page.goto('/'); await page.evaluate(async () => {
    const { DialogMotion } = await import('/dialog-motion.js');
    for (const id of ['motion-parent', 'motion-child']) { const dialog = document.createElement('dialog'); dialog.id = id; dialog.className = 'dialog'; const title = document.createElement('h2'); title.textContent = id; const button = document.createElement('button'); button.textContent = '닫기'; button.setAttribute('data-close', ''); dialog.append(title, button); document.body.append(dialog); }
    window.__motion = new DialogMotion(); const parent = document.getElementById('motion-parent'); window.__motion.show(parent); void window.__motion.close(parent); window.__motion.show(parent);
  });
  await expect(page.locator('#motion-parent')).toBeVisible(); await expect(page.locator('#motion-parent')).not.toHaveAttribute('data-motion', 'opening');
  await page.evaluate(() => window.__motion.show(document.getElementById('motion-child'))); await expect(page.locator('#motion-child')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.locator('#motion-child')).toBeHidden(); await expect(page.locator('#motion-parent')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#motion-parent')).toBeHidden();
});

test('a LAN room assembles teams and per-team AI before entry; late joiners choose their side while existing players keep fighting', async ({ browser }) => {
  test.setTimeout(90_000);
  const app = createGameServer({ host: '127.0.0.1', port: 0, loop: false }), info = await app.listen(), contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  try {
    const [host, guest, late] = await Promise.all(contexts.map((context) => context.newPage())); const errors = []; for (const page of [host, guest, late]) page.on('pageerror', (error) => errors.push(error.message));
    const origin = `http://127.0.0.1:${info.port}`; await host.goto(origin); await expect(host.getByText('LAN SERVER ONLINE')).toBeVisible(); await host.locator('#create-button').click();
    await host.locator('#room-title').fill('TEAM ASSEMBLY'); await host.locator('#room-game-type').selectOption('teams'); await host.locator('#room-initial-team').selectOption('blue'); await host.locator('#bots-minus').click(); await host.locator('#bots-minus').click(); await host.locator('#room-create-confirm').click();
    await expect(host.locator('#room-lobby-dialog')).toBeVisible(); await expect(host.locator('#game-shell')).toBeHidden(); const room = [...app.rooms.values()][0]; expect(room.phase).toBe('lobby');
    await host.locator('#lobby-bot-difficulty').selectOption('advanced'); await host.getByRole('button', { name: '레드팀 AI 추가', exact: true }).click(); await expect.poll(() => room.players.size).toBe(2); app.broadcast(); await expect(host.locator('#room-lobby-roster')).toContainText('고급');
    for (const page of [guest, late]) { await page.goto(origin); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible(); }
    await guest.locator('#room-browser-button').click(); await guest.locator('#room-code').fill(room.code); await guest.getByRole('button', { name: '코드로 방 참가' }).click(); await expect(guest.locator('#room-lobby-dialog')).toBeVisible();
    await expect(guest.locator('#room-lobby-action')).toBeDisabled(); await expect(guest.locator('#room-team-choice-title')).toContainText('입장할 팀'); await guest.locator('#room-select-blue').click(); await expect.poll(() => [...room.players.values()].filter((p) => !p.isBot && p.teamId === 'blue').length).toBe(2); app.broadcast();
    await guest.locator('#room-lobby-action').click(); await expect.poll(() => [...room.players.values()].filter((p) => p.ready).length).toBe(1); app.broadcast(); await expect(host.locator('#room-lobby-action')).toBeEnabled();
    await host.screenshot({ path: 'artifacts/team-room-lobby.png' }); await host.locator('#room-lobby-action').click(); await expect.poll(() => room.phase).toBe('active'); app.broadcast(); await expect(host.locator('#pause-overlay')).toBeVisible(); await expect(guest.locator('#pause-overlay')).toBeVisible();
    const round = room.roundId, deadline = room.endsAt, original = room.players.get(room.hostId); original.ammo = 9;
    await late.locator('#room-browser-button').click(); await late.locator('#room-code').fill(room.code); await late.getByRole('button', { name: '코드로 방 참가' }).click(); await expect(late.locator('#room-lobby-dialog')).toBeVisible(); app.broadcast(); await expect(late.locator('#room-lobby-roster')).toContainText('교전 중'); await expect(late.locator('#game-shell')).toBeHidden();
    await expect(late.locator('#room-lobby-action')).toBeDisabled(); await late.locator('#room-select-blue').click(); await expect.poll(() => [...room.players.values()].find((p) => !p.isBot && p.roomStatus === 'waiting')?.teamId).toBe('blue'); app.broadcast();
    await late.locator('#room-select-red').click(); await expect.poll(() => [...room.players.values()].find((p) => !p.isBot && p.roomStatus === 'waiting')?.teamId).toBe('red'); app.broadcast(); await expect(late.locator('#room-lobby-action')).toContainText('레드팀'); await late.locator('#room-lobby-action').click(); await expect.poll(() => [...room.players.values()].filter((p) => p.roomStatus === 'playing').length).toBe(4); app.broadcast(); await expect(late.locator('#pause-overlay')).toBeVisible();
    expect(room.roundId).toBe(round); expect(room.endsAt).toBe(deadline); expect(original.ammo).toBe(9); expect(errors).toEqual([]);
  } finally { for (const context of contexts) await context.close(); await app.close(); }
});
