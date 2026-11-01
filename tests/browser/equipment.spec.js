import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createGameServer } from '../../server/index.js';

async function fixture(page) {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  await page.evaluate(async () => {
    const [{ Room }, { FPSGame }] = await Promise.all([import('/shared/simulation.js'), import('/game.js')]);
    const room = new Room('DROPS', { bots: 0 }), player = room.addPlayer('viewer', 'VIEWER'), other = room.addPlayer('other', 'OTHER');
    room.world = { ...room.world, width: 100, depth: 100, obstacles: [] };
    Object.assign(player, { x: 24, y: 0, z: 10, yaw: 0, pitch: 0, ammo: 7, protectedUntil: 0 }); Object.assign(other, { x: 24, y: 0, z: 4, protectedUntil: 0 });
    document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false; const sounds = [];
    const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), settings: { sensitivity: 1, fov: 82, volume: 0, quality: 'low' }, audio: { unlock: async () => {}, step() {}, shot() {}, melee() { sounds.push('knife'); }, reload() {}, hit() {}, hurt() {}, kill() {} }, mapId: 'foundry',
      send(data) { if (data.type === 'input') room.setInput(player.id, data); if (data.type === 'equipment') room.interactEquipment(player.id, data); }, onMenu(show) { document.getElementById('pause-overlay').hidden = !show; }, onFatal(message) { throw new Error(message); } });
    game.world = room.world; game.applySnapshot(room.snapshot(), player.id); await game.prepareGraphics();
    let ticks = 0; const timer = setInterval(() => { room.tick(1 / 60); if (++ticks % 3 === 0) game.applySnapshot(room.snapshot()); }, 1000 / 60);
    const start = () => game.lock(); document.getElementById('resume-button').addEventListener('click', start); document.getElementById('pause-overlay').hidden = false;
    window.__equipment = { room, player, other, game, sounds, timer, start };
  });
  await page.getByRole('button', { name: '교전 시작', exact: true }).click(); await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game-canvas');
}
async function dispose(page) { await page.evaluate(async () => { const f = window.__equipment; if (!f) return; clearInterval(f.timer); document.getElementById('resume-button').removeEventListener('click', f.start); await f.game.dispose(); delete window.__equipment; }); }

test('G only swaps with a ground gun, leaves the old gun/ammunition on the floor and ignores repeats', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await fixture(page);
  try {
    await page.keyboard.press('KeyG'); await expect(page.locator('#hud-weapon-name')).toHaveText('VX–7'); expect(await page.evaluate(() => window.__equipment.room.droppedWeapons.size)).toBe(0);
    await page.evaluate(() => { const f = window.__equipment; f.room.dropWeapon({ ...f.player, weaponId: 'mp5', weaponSkinId: 'circuit', ammo: 12 }); });
    await expect(page.locator('#equipment-hint')).toContainText('MP5와 교체');
    await page.keyboard.down('KeyG'); await expect(page.locator('#hud-weapon-name')).toHaveText('MP5'); await expect(page.locator('#hud-ammo')).toHaveText('12'); await page.keyboard.down('KeyG'); await page.keyboard.up('KeyG');
    await expect.poll(() => page.evaluate(() => { const item = [...window.__equipment.game.groundItems.values()][0]; return item.target.grounded && item.group.position.y < .002; })).toBe(true);
    const visual = await page.evaluate(async () => { const f = window.__equipment, { Box3 } = await import('/vendor/three.module.js'); f.game.scene.updateMatrixWorld(true); const item = [...f.game.groundItems.values()][0], bounds = new Box3().setFromObject(item.group.children[0]); return { items: f.game.groundItems.size, bottom: bounds.min.y, gun: item.target.weaponId, ammo: item.target.ammo }; });
    expect(visual.items).toBe(1); expect(visual.bottom).toBeCloseTo(.025, 2); expect(visual.gun).toBe('rifle'); expect(visual.ammo).toBe(7);
    await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/ground-gun-swap.png' });
    await page.keyboard.press('KeyR'); await expect(page.locator('#reload-indicator')).toBeVisible();
    await page.keyboard.press('KeyG'); await expect(page.locator('#hud-weapon-name')).toHaveText('VX–7'); await expect(page.locator('#hud-ammo')).toHaveText('07');
    expect(await page.evaluate(() => ({ size: window.__equipment.game.groundItems.size, gun: [...window.__equipment.room.droppedWeapons.values()][0].weaponId, ammo: [...window.__equipment.room.droppedWeapons.values()][0].ammo }))).toEqual({ size: 1, gun: 'mp5', ammo: 12 }); expect(errors).toEqual([]);
  } finally { await dispose(page); }
});

test('a legacy fallback knife still works, but is never equipped by pressing G without a ground gun', async ({ page }) => {
  await fixture(page);
  try {
    await page.keyboard.press('KeyG'); await expect(page.locator('#hud-weapon-name')).toHaveText('VX–7');
    await page.evaluate(() => { const f = window.__equipment; Object.assign(f.player, { weaponId: 'knife', ammo: 0, equipmentSeq: f.player.equipmentSeq + 1 }); f.game.applySnapshot(f.room.snapshot()); });
    await expect(page.locator('#hud-weapon-name')).toHaveText('FIELD KNIFE');
    await page.evaluate(() => { const f = window.__equipment; Object.assign(f.other, { x: 24, y: 0, z: 8.8, hp: 45, protectedUntil: 0 }); f.game.applySnapshot(f.room.snapshot()); });
    await expect(page.locator('#reload-hint')).toContainText('근접'); await page.mouse.click(600, 450);
    await expect.poll(() => page.evaluate(() => window.__equipment.other.hp)).toBe(0);
    await expect(page.locator('#killfeed')).toContainText('FIELD KNIFE');
    expect(await page.evaluate(() => ({ drops: window.__equipment.room.droppedWeapons.size, saved: window.__equipment.player.nextWeaponId, knifeKills: window.__equipment.player.weaponKills.knife }))).toEqual({ drops: 1, saved: 'rifle', knifeKills: 1 });
  } finally { await dispose(page); }
});

test('the static solo worker keeps the current gun when G has nothing to swap with, without WebSocket or API traffic', async ({ page }) => {
  const sockets = [], apis = [], errors = []; page.on('websocket', (socket) => sockets.push(socket.url())); page.on('pageerror', (error) => errors.push(error.message)); page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) apis.push(request.url()); });
  await page.goto(`http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await page.getByRole('button', { name: '연습전 시작', exact: true }).click(); await expect(page.locator('#pause-overlay')).toBeVisible(); await page.getByRole('button', { name: '교전 시작', exact: true }).click();
  await page.keyboard.press('KeyG'); await expect(page.locator('#hud-weapon-name')).toHaveText('VX–7'); await expect(page.locator('#hud-ammo')).toHaveText('30');
  await page.mouse.click(600, 450); await expect(page.locator('#hud-ammo')).toHaveText('29');
  await page.evaluate(() => document.exitPointerLock()); await expect(page.locator('#pause-overlay')).toBeVisible(); await page.getByRole('button', { name: '로비로 나가기', exact: true }).click(); expect(sockets).toEqual([]); expect(apis).toEqual([]); expect(errors).toEqual([]);
});

test('real LAN movement snapshots produce audible remote Web Audio steps and stop after the source dies', async ({ page }) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1' }), info = await app.listen();
  try {
    await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto(`http://127.0.0.1:${info.port}`);
    const ids = await page.evaluate(async () => {
      const connect = () => new Promise((resolve) => { const socket = new WebSocket(`ws://${location.host}/play`); socket.addEventListener('message', function hello(event) { const data = JSON.parse(event.data); if (data.type === 'hello') { socket.removeEventListener('message', hello); resolve(socket); } }); });
      const wait = (socket, type) => new Promise((resolve) => { socket.addEventListener('message', function receive(event) { const data = JSON.parse(event.data); if (data.type === type) { socket.removeEventListener('message', receive); resolve(data); } }); });
      const a = await connect(), b = await connect(); let joined = wait(a, 'joined'); a.send(JSON.stringify({ type: 'create', bots: 0 })); const first = await joined;
      joined = wait(b, 'joined'); b.send(JSON.stringify({ type: 'join', code: first.room.code })); const second = await joined;
      const [{ FPSGame }, { GameAudio }] = await Promise.all([import('/game.js'), import('/audio.js')]);
      const audio = new GameAudio({ volume: 100 }); await audio.unlock(); audio.master.gain.cancelScheduledValues(audio.context.currentTime); audio.master.gain.value = 0;
      const steps = [], step = audio.step.bind(audio); audio.step = (sprint, crouched, mix) => { const voice = step(sprint, crouched, mix); if (mix.remote && voice) steps.push({ gain: voice.gain.gain.value, ...mix }); };
      document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
      const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), mapId: 'foundry', settings: { sensitivity: 1, fov: 82, quality: 'low' }, audio, send(data) { a.send(JSON.stringify(data)); }, onMenu() {}, onFatal(message) { throw new Error(message); } });
      game.applySnapshot(first, first.id); a.addEventListener('message', (event) => { const data = JSON.parse(event.data); if (data.type === 'state') game.applySnapshot(data); }); await game.prepareGraphics();
      let tick = 0; const timer = setInterval(() => b.send(JSON.stringify({ type: 'input', forward: ++tick % 3 === 0 ? 0 : .65, yaw: 0 })), 1000 / 30);
      window.__lanSteps = { a, b, game, audio, steps, timer }; return { code: first.room.code, a: first.id, b: second.id };
    });
    const room = app.rooms.get(ids.code); room.world = { ...room.world, width: 100, depth: 100, obstacles: [] };
    await page.evaluate(() => { const game = window.__lanSteps.game; game.world = { ...game.world, width: 100, depth: 100, obstacles: [] }; });
    Object.assign(room.players.get(ids.a), { x: 24, y: 0, z: 16, yaw: 0 }); Object.assign(room.players.get(ids.b), { x: 22, y: 0, z: 12, yaw: 0 });
    await page.evaluate(() => { window.__lanSteps.game.yaw = 0; window.__lanSteps.steps.length = 0; });
    await expect.poll(() => page.evaluate(() => window.__lanSteps.steps.length), { timeout: 8000 }).toBeGreaterThanOrEqual(3);
    const steps = await page.evaluate(() => window.__lanSteps.steps); expect(steps.every((step) => step.gain > .03 && step.pan < 0)).toBe(true);
    Object.assign(room.players.get(ids.b), { hp: 0, respawnAt: Date.now() + 10_000 });
    await expect.poll(() => page.evaluate(() => window.__lanSteps.game.remote.values().next().value.target.hp)).toBe(0);
    const count = await page.evaluate(() => window.__lanSteps.steps.length); await expect.poll(async () => { expect(await page.evaluate(() => window.__lanSteps.steps.length)).toBe(count); return Date.now() - room.players.get(ids.b).lastInput; }, { timeout: 2000 }).toBeGreaterThan(500);
  } finally {
    await page.evaluate(async () => { const f = window.__lanSteps; if (!f) return; clearInterval(f.timer); await f.game.dispose(); f.a.close(); f.b.close(); await f.audio.context.close(); }); await app.close();
  }
});
