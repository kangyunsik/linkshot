import { test, expect } from '@playwright/test';
import { createGameServer } from '../../server/index.js';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('sector07-settings', JSON.stringify({ quality: 'low', volume: 0, fov: 82, sensitivity: 1 }));
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { constructor(...args) { super(...args); this.addEventListener('message', ({ data }) => { if (['state', 'joined'].includes(data.type)) window.__objectiveState = data; }); } };
  });
});

test('rule selection filters incompatible maps and exposes score/wave limits without allowing enemy-team selection in co-op', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible(); await page.locator('#create-button').click();
  const enabled = () => page.locator('#room-map-choice option:not([disabled])').evaluateAll((options) => options.map((option) => option.value));
  expect(await enabled()).toHaveLength(8);
  await page.locator('#room-game-type').selectOption('teams'); expect(await enabled()).toHaveLength(10); expect(await enabled()).toContain('faultline'); expect(await enabled()).toContain('sump');
  await page.locator('#room-game-type').selectOption('hardpoint'); expect(await enabled()).toEqual(['relay']); await expect(page.locator('#frag-limit')).toHaveValue('150'); await expect(page.locator('#rule-description')).toContainText('초당 1점');
  await page.locator('#room-game-type').selectOption('defense'); expect(await enabled()).toEqual(['bastion']); await expect(page.locator('#frag-limit')).toHaveValue('5'); await expect(page.locator('#room-initial-team')).toBeDisabled();
  await expect(page.locator('.map-choice[data-map="faultline"]')).toBeDisabled(); await expect(page.locator('.map-choice[data-map="bastion"]')).toBeEnabled();
});

for (const [mapId, gameType, name] of [['faultline', 'teams', 'FAULTLINE'], ['sump', 'teams', 'SUMP'], ['relay', 'hardpoint', 'RELAY'], ['bastion', 'defense', 'BASTION']]) {
  test(`${mapId} plays in the static browser worker only under its supported rule`, async ({ page }) => {
    const errors = [], sockets = []; page.on('pageerror', (error) => errors.push(error.message)); page.on('websocket', (socket) => sockets.push(socket.url()));
    await page.goto(`http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
    await page.locator('#deployment-settings-button').click(); await page.locator('#room-game-type').selectOption(gameType); await page.locator('#room-map-choice').selectOption(mapId); await page.locator('#room-create-confirm').click();
    await page.locator('#create-button').click(); await expect(page.locator('#pause-overlay')).toBeVisible(); await expect(page.locator('#hud-map-name')).toHaveText(name);
    expect(await page.evaluate(() => window.__objectiveState.room.gameType)).toBe(gameType);
    if (gameType === 'hardpoint') { await expect(page.locator('#objective-hud')).toBeVisible(); await expect(page.locator('#objective-title')).toContainText('중앙 중계판'); await expect(page.locator('#hud-frag-limit')).toContainText('POINTS'); }
    if (gameType === 'defense') {
      await expect(page.locator('#objective-hud')).toBeVisible(); await expect(page.locator('#objective-title')).toContainText('공세');
      await expect.poll(() => page.evaluate(() => window.__objectiveState.players.filter((p) => p.isWaveEnemy).length), { timeout: 15000 }).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.__objectiveState.players.filter((p) => !p.isWaveEnemy).every((p) => p.teamId === 'blue'))).toBe(true);
    }
    await page.getByRole('button', { name: '로비로 나가기', exact: true }).click(); await expect(page.locator('#lobby')).toBeVisible(); expect(errors).toEqual([]); expect(sockets).toEqual([]);
  });
}

test('co-op LAN rooms start with one defending human, synchronize live waves/core HUD, finish and restart without another human team', async ({ page }) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1', loop: false }), info = await app.listen();
  try {
    await page.goto(`http://127.0.0.1:${info.port}`); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible(); await page.locator('#create-button').click();
    await page.locator('#room-game-type').selectOption('defense'); await page.locator('#frag-limit').fill('1'); await page.locator('#room-create-confirm').click(); await expect(page.locator('#room-lobby-dialog')).toBeVisible();
    const room = [...app.rooms.values()][0]; let now = Date.now(); room.clock = () => now;
    await expect(page.locator('#room-team-choice')).toBeHidden(); await expect(page.locator('#room-lobby-roster')).toContainText('수비팀');
    await expect(page.locator('#room-lobby-action')).toBeEnabled(); await page.locator('#room-lobby-action').click(); await expect.poll(() => room.phase).toBe('active'); app.broadcast(); await expect(page.locator('#pause-overlay')).toBeVisible();
    for (let i = 0; i < 220; i++) { now += 50; room.tick(.05); } app.broadcast();
    await expect(page.locator('#objective-detail')).toContainText('공세 AI'); expect([...room.players.values()].some((p) => p.isWaveEnemy)).toBe(true);
    const host = room.players.get(room.hostId);
    for (const p of [...room.players.values()].filter((p) => p.isWaveEnemy)) room.applyDamage(host, p, 10000, false, {}, { id: 'rifle' }, now);
    for (let i = 0; i < 20; i++) { now += 50; room.tick(.05); } app.broadcast();
    await expect(page.locator('#room-lobby-result')).toContainText('수비 성공'); expect(room.result.rewards[host.id].points).toBe(0);
    await page.locator('#room-lobby-action').click(); await expect.poll(() => room.phase).toBe('active'); app.broadcast(); await expect(page.locator('#pause-overlay')).toBeVisible();
    expect(room.objectives.state.coreHealth).toBe(1000); expect(room.objectives.state.wave).toBe(1);
  } finally { await app.close(); }
});

test('LAN hardpoint snapshots drive rotation, contested HUD and score victory rather than kills', async ({ page }) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1', loop: false }), info = await app.listen();
  try {
    await page.goto(`http://127.0.0.1:${info.port}`); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible(); await page.locator('#create-button').click();
    await page.locator('#room-game-type').selectOption('hardpoint'); await page.locator('#frag-limit').fill('30'); await page.locator('#room-create-confirm').click(); await expect(page.locator('#room-lobby-dialog')).toBeVisible();
    const room = [...app.rooms.values()][0]; await page.locator('#room-lobby-action').click(); await expect.poll(() => room.phase).toBe('active'); app.broadcast(); await expect(page.locator('#pause-overlay')).toBeVisible();
    const host = room.players.get(room.hostId), point = room.world.hardpoints[0], enemy = [...room.players.values()].find((p) => p.teamId !== host.teamId);
    for (const p of room.players.values()) Object.assign(p, { x: p.teamId === 'blue' ? -30 : 30, y: 0, z: 12, protectedUntil: 0 });
    Object.assign(host, { x: point.x, y: point.y, z: point.z });
    for (let i = 0; i < 4; i++) room.objectives.tick(.25, Date.now()); app.broadcast(); await expect(page.locator('#team-score-blue')).toHaveText('1');
    await expect(page.locator('#objective-blue-gauge')).toHaveAttribute('aria-valuenow', '1'); await expect(page.locator('#objective-blue-gauge')).toHaveAttribute('aria-valuemax', '30');
    room.objectives.tick(.25, Date.now()); room.objectives.tick(.25, Date.now()); app.broadcast();
    await expect(page.locator('#objective-capture-gauge')).toHaveAttribute('aria-valuenow', '50'); await expect(page.locator('#objective-capture-label')).toHaveText('블루팀 점령 중');
    Object.assign(enemy, { x: point.x, y: point.y, z: point.z }); room.objectives.tick(.1, Date.now()); app.broadcast(); await expect(page.locator('#objective-detail')).toContainText('득점 정지');
    await expect(page.locator('#objective-hud')).toHaveAttribute('data-control', 'contested'); await expect(page.locator('#objective-capture-value')).toHaveText('진행 일시 정지');
    room.objectives.state.nextAt = Date.now() - 1; room.objectives.tick(.01, Date.now()); app.broadcast(); await expect(page.locator('#objective-title')).toContainText('북쪽 안테나');
    Object.assign(enemy, { x: 30, y: 0, z: 12 }); const next = room.world.hardpoints[1]; Object.assign(host, { x: next.x, y: next.y, z: next.z });
    for (let i = 0; i < 120; i++) room.objectives.tick(.25, Date.now()); app.broadcast(); await expect(page.locator('#room-lobby-result')).toContainText('블루팀 승리'); expect(room.result.rewards[host.id].points).toBe(0);
  } finally { await app.close(); }
});

for (const [mapId, gameType] of [['faultline', 'teams'], ['sump', 'teams'], ['relay', 'hardpoint'], ['bastion', 'defense']]) test(`${mapId} renders its distinct terrain with bounded draw calls and releases all scene resources`, async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const result = await page.evaluate(async ({ mapId, gameType }) => {
    const [{ FPSGame }, { Room }] = await Promise.all([import('/game.js'), import('/shared/simulation.js')]);
    const room = new Room('TERRAIN', { mapId, gameType, bots: 0 }), player = room.addPlayer('viewer', 'VIEWER'); document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
    if (gameType === 'hardpoint') { const p = room.world.hardpoints[0]; Object.assign(player, { x: p.x, y: p.y, z: p.z, protectedUntil: 0 }); room.objectives.tick(.25, room.clock()); room.objectives.tick(.25, room.clock()); room.teamScores.blue = 45; room.teamScores.red = 27; }
    const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), mapId, settings: { quality: 'normal', fov: 82, sensitivity: 1 }, audio: { step() {}, stopReload() {} }, send() {}, onMenu() {}, onFatal(message) { throw new Error(message); } });
    game.applySnapshot(room.snapshot(), player.id); await game.prepareGraphics(); cancelAnimationFrame(game.frameId); game.weapon.visible = false; const extent = Math.max(room.world.width, room.world.depth); game.camera.position.set(extent * .55, extent * .7, extent * .65); game.camera.lookAt(0, 0, 0); game.renderFrame();
    let valid = true, shapes = 0; game.scene.getObjectByName(`team-arena-${mapId}`).traverse((object) => { if (object.geometry) { shapes++; const p = object.geometry.getAttribute('position'); valid &&= [...p.array].every(Number.isFinite); } });
    window.__terrainGame = game; return { calls: game.renderer.info.render.calls, triangles: game.renderer.info.render.triangles, valid, shapes };
  }, { mapId, gameType });
  try {
    expect(result.calls).toBeLessThan(160); expect(result.triangles).toBeLessThan(180000); expect(result.valid).toBe(true); expect(result.shapes).toBeGreaterThan(10);
    await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: `artifacts/team-map-${mapId}.png` });
    if (gameType === 'hardpoint') {
      await expect(page.locator('#objective-capture-gauge')).toHaveAttribute('aria-valuenow', '50'); await expect(page.locator('#objective-blue-value')).toHaveText('45 / 150'); await expect(page.locator('#objective-red-value')).toHaveText('27 / 150');
      expect(await page.evaluate(() => { const view = window.__terrainGame.objectiveView; return view.billboard.visible && view.occupation.visible && view.billboard.material.map === view.texture; })).toBe(true);
      await page.evaluate(() => { const game = window.__terrainGame; game.camera.position.set(13, 10, 15); game.camera.lookAt(0, 1, 0); game.renderFrame(); });
      await page.screenshot({ path: 'artifacts/hardpoint-capture-gauges.png' });
      for (const [width, height] of [[390, 844], [1440, 1000]]) { await page.setViewportSize({ width, height }); await expect(page.locator('#objective-hud')).toBeInViewport(); expect(await page.locator('#objective-hud').evaluate((el) => el.getBoundingClientRect().bottom < innerHeight / 2 - 15)).toBe(true); }
    }
    if (mapId === 'sump') {
      await page.evaluate(() => { const game = window.__terrainGame; game.camera.position.set(22, 1.62, 13); game.camera.lookAt(14, 1.4, -8); game.renderFrame(); }); await page.screenshot({ path: 'artifacts/sump-lower-route.png' });
    }
    const released = await page.evaluate(async () => {
      const game = window.__terrainGame, resources = new Set(), disposed = new Set(); game.scene.traverse((object) => { if (object.geometry) resources.add(object.geometry); if (object.isInstancedMesh) resources.add(object); for (const material of object.material ? Array.isArray(object.material) ? object.material : [object.material] : []) { resources.add(material); for (const value of Object.values(material)) if (value?.isTexture) resources.add(value); } });
      for (const item of resources) item.addEventListener('dispose', () => disposed.add(item)); await game.dispose(); delete window.__terrainGame; return [...resources].every((item) => disposed.has(item));
    });
    expect(released).toBe(true); expect(errors).toEqual([]);
  } finally { await page.evaluate(async () => { await window.__terrainGame?.dispose(); delete window.__terrainGame; }); }
});
