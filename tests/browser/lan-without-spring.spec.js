import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createOnlineEngine } from '../../server/online-engine.js';

test('online combat plus FE preview supports two LAN browsers, room lists and actual play while Spring is unavailable', async ({ browser }) => {
  test.setTimeout(60_000);
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const frontPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const origin = `http://127.0.0.1:${frontPort}`, client = new Proxy({}, { get: () => async () => { throw new Error('Spring unavailable'); } });
  const engine = createOnlineEngine({ client, host: '127.0.0.1', port: 0, origins: [origin] }), { port } = await engine.listen(), contexts = [];
  const child = spawn(process.execPath, ['scripts/preview.mjs'], { env: { ...process.env, PREVIEW_PORT: String(frontPort), FRONTEND_URL: origin, LAN_ENGINE_URL: `ws://127.0.0.1:${port}/lan/play` }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Preview did not start')), 10000); child.stdout.on('data', chunk => { if (chunk.toString().includes('FE 미리보기')) { clearTimeout(timer); resolve(); } }); child.once('error', reject); child.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited: ${code}`)); }); });
    const pages = [], errors = [];
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext(); contexts.push(context);
      await context.route('**/runtime-config.js', route => route.fulfill({ contentType: 'text/javascript', body: "export const APP_MODE='lan'; export const LAN_PLAY_PATH='/lan/play'; export const PROFILE_STORAGE='browser'; export const ONLINE_SERVER_URL='http://127.0.0.1:1';" }));
      await context.addInitScript(() => localStorage.setItem('sector07-settings', JSON.stringify({ quality: 'low', volume: 0, fov: 82, sensitivity: 1 })));
      const page = await context.newPage(); pages.push(page); page.on('pageerror', error => errors.push(error.message)); await page.goto(origin); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible(); await expect(page.locator('#create-button')).toBeEnabled();
    }
    const [host, guest] = pages; await host.locator('#create-button').click(); await host.locator('#bots-minus').click(); await host.locator('#bots-minus').click(); await host.locator('#room-title').fill('NO SPRING LAN'); await host.locator('#room-create-confirm').click(); await expect(host.locator('#room-lobby-dialog')).toBeVisible();
    const room = [...engine.lan.directory.rooms.values()][0];
    await guest.locator('#room-browser-button').click(); await expect(guest.locator('#room-list')).toContainText('NO SPRING LAN'); await guest.locator('#room-list').getByRole('button', { name: '참가', exact: true }).click(); await expect(guest.locator('#room-lobby-dialog')).toBeVisible(); await guest.locator('#room-lobby-action').click();
    await expect(host.locator('#room-lobby-action')).toBeEnabled(); await host.locator('#room-lobby-action').click(); await expect(host.locator('#pause-overlay')).toBeVisible(); await expect(guest.locator('#pause-overlay')).toBeVisible();
    expect(room.mode).toBe('lan'); expect(room.players.size).toBe(2); expect(engine.matches.size).toBe(0); expect(engine.custom.directory.rooms.size).toBe(0);
    await host.locator('#resume-button').click(); await expect.poll(() => host.evaluate(() => document.pointerLockElement?.id)).toBe('game-canvas');
    const player = room.players.get(room.hostId), before = { x: player.x, z: player.z }; await host.keyboard.down('KeyW'); await expect.poll(() => Math.hypot(player.x - before.x, player.z - before.z)).toBeGreaterThan(1); await host.keyboard.up('KeyW');
    expect(errors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
    if (child.exitCode === null && child.signalCode === null) { const closed = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await closed; }
    await engine.close();
  }
});
