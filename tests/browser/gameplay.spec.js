import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => { try { localStorage.setItem('sector07-settings', JSON.stringify({ sensitivity: 1, fov: 82, volume: 0, quality: 'low' })); } catch { /* about:blank */ } });
});

async function fixture(page, mapId = 'foundry') {
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  await page.evaluate(async (mapId) => {
    const [{ FPSGame }, { Room }] = await Promise.all([import('/game.js'), import('/shared/simulation.js')]);
    const room = new Room('RULES', { bots: 0, mapId }), player = room.addPlayer('viewer', 'VIEWER'), other = room.addPlayer('other', 'OPERATOR', false, { outfitId: 'runner' });
    Object.assign(player, { x: 24, y: 0, z: 10, yaw: 0, protectedUntil: 0 }); Object.assign(other, { x: 22, y: 0, z: 6, yaw: Math.PI }); room.events.length = 0;
    document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
    const sounds = [];
    const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), settings: { sensitivity: 1, fov: 82, volume: 0, quality: 'low' }, audio: { unlock: async () => {}, shot(_volume, _pan, id) { sounds.push(id); }, hit() {}, hurt() {}, kill() {}, step() {}, reload() {} }, mapId,
      send: (data) => { if (data.type === 'input') room.setInput(player.id, data); if (data.type === 'loadout') room.selectLoadout(player.id, data); },
      onMenu: (show) => { document.getElementById('pause-overlay').hidden = !show; }, onFatal: (message) => { throw new Error(message); } });
    game.applySnapshot(room.snapshot(), player.id); document.getElementById('pause-overlay').hidden = false;
    let ticks = 0; const timer = setInterval(() => { room.tick(1 / 60); if (++ticks % 3 === 0) game.applySnapshot(room.snapshot()); }, 1000 / 60);
    const start = () => game.lock(); document.getElementById('resume-button').addEventListener('click', start);
    window.__rules = { room, game, player, timer, start, sounds };
  }, mapId);
  await page.getByRole('button', { name: '교전 시작', exact: true }).click(); await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game-canvas');
}
async function dispose(page) {
  await page.evaluate(() => { const f = window.__rules; if (f) { clearInterval(f.timer); document.getElementById('resume-button').removeEventListener('click', f.start); f.game.dispose(); delete window.__rules; } });
}

test('live weapon shortcuts are locked; sprint/airborne crouch and accuracy penalties match the server', async ({ page }) => {
  await fixture(page);
  try {
    await page.keyboard.press('Digit4'); await page.mouse.wheel(0, 300);
    expect(await page.evaluate(() => window.__rules.player.weaponId)).toBe('rifle');
    await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyC');
    await expect.poll(() => page.evaluate(() => window.__rules.player.sprinting)).toBe(true);
    expect(await page.evaluate(() => window.__rules.player.crouching)).toBe(false);
    await page.mouse.down(); await expect(page.locator('#crosshair')).toHaveAttribute('data-accuracy', 'sprinting');
    await expect.poll(() => page.evaluate(() => window.__rules.game.pitch)).toBeGreaterThan(0.025); await page.mouse.up();
    await page.keyboard.press('Space'); await expect(page.locator('#crosshair')).toHaveAttribute('data-accuracy', 'airborne');
    expect(await page.evaluate(() => window.__rules.player.crouching)).toBe(false);
    await page.keyboard.up('KeyC'); await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
  } finally { await dispose(page); }
});

test('E opens a death-only chooser and the selected gun is equipped after respawn', async ({ page }) => {
  await fixture(page);
  try {
    await page.evaluate(() => { const { player, game, room } = window.__rules; Object.assign(player, { hp: 0, diedAt: Date.now(), respawnAt: Date.now() + 3000 }); game.applySnapshot(room.snapshot()); });
    await expect(page.locator('#respawn-overlay')).toBeVisible(); await page.keyboard.press('KeyE'); await expect(page.locator('#respawn-loadout')).toBeVisible();
    await page.locator('#respawn-weapon-choices [data-weapon=sniper]').click(); await expect(page.locator('#respawn-loadout')).toBeHidden();
    expect(await page.evaluate(() => window.__rules.player.nextWeaponId)).toBe('sniper');
    await expect(page.locator('#hud-weapon-name')).toHaveText('SR–1'); await expect(page.locator('#hud-ammo')).toHaveText('05');
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game-canvas');
    await page.keyboard.press('Digit1'); expect(await page.evaluate(() => window.__rules.player.weaponId)).toBe('sniper');
    const origin = await page.evaluate(() => ({ x: window.__rules.player.x, z: window.__rules.player.z }));
    await page.keyboard.down('KeyW'); await expect.poll(() => page.evaluate((origin) => Math.hypot(window.__rules.player.x - origin.x, window.__rules.player.z - origin.z), origin)).toBeGreaterThan(0.8); await page.keyboard.up('KeyW');
  } finally { await dispose(page); }
});

test('each gun repeats one identical recorded sound with fixed pitch and bounded voices', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  const result = await page.evaluate(async () => {
    const { GameAudio } = await import('/audio.js'), audio = new GameAudio({ volume: 0 }); await audio.unlock(); await audio.ready;
    const counts = [...audio.samples].map(([id, sounds]) => ({ id, count: sounds.filter(Boolean).length, duration: sounds[0].duration }));
    for (let i = 0; i < 60; i++) audio.shot(0.2, (i % 3 - 1) * 0.5, 'rifle', 12);
    const sources = [...audio.voices], voices = sources.length, identical = sources.every((source) => source.buffer === sources[0].buffer && source.playbackRate.value === 1); audio.setEnvironment(true); await audio.context.close(); return { counts, voices, identical };
  });
  expect(result.counts).toHaveLength(19); for (const count of result.counts) { expect(count.count).toBe(1); expect(count.duration).toBeGreaterThan(0.3); }
  expect(result.identical).toBe(true);
  expect(result.voices).toBeGreaterThan(0); expect(result.voices).toBeLessThanOrEqual(40);
});

test('multi-storey buildings use batched geometry and render actual open windows', async ({ page }) => {
  await fixture(page, 'blocknine');
  try {
    const result = await page.evaluate(() => {
      const { game, room } = window.__rules; cancelAnimationFrame(game.frameId);
      const batches = game.scene.children.filter((object) => object.name.startsWith('architecture-'));
      game.camera.position.set(-34, 18, -30); game.camera.lookAt(0, 3, 0); game.renderer.render(game.scene, game.camera);
      return { batches: batches.length, instances: batches.reduce((sum, object) => sum + object.count, 0), buildings: room.world.buildings.length, windows: room.world.buildings.reduce((sum, building) => sum + building.windows.length, 0) };
    });
    expect(result.buildings).toBe(8); expect(result.windows).toBeGreaterThan(10); expect(result.windows).toBeLessThan(80); expect(result.instances).toBeGreaterThan(600); expect(result.batches).toBeLessThan(7);
    await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/climbable-buildings.png' });
  } finally { await dispose(page); }
});

test('hip-fire and ADS centers stay pixel-perfect during jumps, recoil, zoom and odd viewport sizes', async ({ page }) => {
  await fixture(page);
  const centered = async (selector) => {
    const offset = await page.locator(selector).evaluate((element) => { const r = element.getBoundingClientRect(); return Math.hypot(r.x + r.width / 2 - innerWidth / 2, r.y + r.height / 2 - innerHeight / 2); });
    expect(offset).toBeLessThan(0.01);
  };
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 1279, height: 799 }]) {
      await page.setViewportSize(viewport); await centered('#crosshair b');
      await page.keyboard.press('Space'); await expect(page.locator('#crosshair')).toHaveAttribute('data-accuracy', 'airborne'); await centered('#crosshair b');
      await page.mouse.down({ button: 'right' }); await expect(page.locator('#ads-reticle')).toBeVisible(); await centered('#ads-reticle');
      for (const fov of [65, 105]) { await page.evaluate((fov) => { window.__rules.game.settings.fov = fov; }, fov); await centered('#ads-reticle'); }
      await page.mouse.down(); await expect.poll(() => page.evaluate(() => window.__rules.game.pitch)).toBeGreaterThan(0); await centered('#ads-reticle'); await page.mouse.up();
      await page.mouse.up({ button: 'right' }); await expect.poll(() => page.evaluate(() => window.__rules.game.predicted.grounded)).toBe(true);
    }
  } finally { await dispose(page); }
});

test('blood is visual-only and death leaves an animated, bounded, temporary corpse', async ({ page }) => {
  await fixture(page);
  try {
    await page.evaluate(() => {
      const { game, room } = window.__rules, victim = room.players.get('other');
      victim.hp = 0; victim.respawnAt = Date.now() + 15000;
      game.applySnapshot(room.snapshot()); game.combat.blood({ x: victim.x, y: 1.2, z: victim.z }, { x: 24, y: 1.6, z: 10 }, 0);
      game.handleEvent({ type: 'kill', killer: 'VIEWER', victim: 'OPERATOR', killerId: 'viewer', victimId: 'other', weaponId: 'rifle', headshot: false });
    });
    expect(await page.evaluate(() => window.__rules.game.combat.bursts.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__rules.game.combat.corpses[0]?.settled)).toBe(true);
    expect(await page.evaluate(() => window.__rules.game.combat.corpses.length)).toBe(1);
    await page.screenshot({ path: 'artifacts/death-and-corpse.png' });
    expect(await page.evaluate(() => { const { game } = window.__rules; game.combat.update(performance.now() + 11000, 0.016); return game.combat.corpses.length + game.combat.bursts.length + game.combat.stains.length; })).toBe(0);
    await expect(page.locator('#damage-direction-caption')).toBeHidden();
  } finally { await dispose(page); }
});

test('a centered 110m scoped sniper shot registers damage and immediately exits zoom', async ({ page }) => {
  await fixture(page, 'redline');
  try {
    await page.evaluate(() => {
      const { game, room, player } = window.__rules, target = room.players.get('other'), now = Date.now();
      Object.assign(player, { x: -55, y: 0, z: -19, yaw: -Math.PI / 2, pitch: Math.atan2(1.58 - 1.62, 110), weaponId: 'sniper', nextWeaponId: 'sniper', ammo: 5, nextFireAt: 0, shotHeat: 0, grounded: true });
      Object.assign(target, { x: 55, y: 0, z: -19, yaw: Math.PI / 2, hp: 100, protectedUntil: 0, grounded: true });
      for (const p of [player, target]) { p.history = []; room.recordPlayerHistory(p, now - 200); room.recordPlayerHistory(p, now); }
      game.predicted = null; game.applySnapshot(room.snapshot());
    });
    await page.mouse.down({ button: 'right' }); await expect(page.locator('#scope-overlay')).toBeVisible();
    const error = await page.locator('.scope-lens i').evaluate((element) => { const r = element.getBoundingClientRect(); return Math.hypot(r.x + r.width / 2 - innerWidth / 2, r.y + r.height / 2 - innerHeight / 2); });
    expect(error).toBeLessThan(0.01);
    await page.mouse.down(); await page.mouse.up(); await expect(page.locator('#scope-overlay')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__rules.room.players.get('other').hp)).toBe(0);
    expect(await page.evaluate(() => window.__rules.game.ads)).toBe(false);
    await page.mouse.up({ button: 'right' }); await page.mouse.down({ button: 'right' }); await expect(page.locator('#scope-overlay')).toBeVisible();
    await page.setViewportSize({ width: 1279, height: 799 });
    expect(await page.locator('.scope-lens i').evaluate((element) => { const r = element.getBoundingClientRect(); return Math.hypot(r.x + r.width / 2 - innerWidth / 2, r.y + r.height / 2 - innerHeight / 2); })).toBeLessThan(0.01);
    await page.mouse.up({ button: 'right' });
  } finally { await dispose(page); }
});

test('host kill/time settings persist and are displayed in the actual LAN match', async ({ page }) => {
  let state; page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => { try { const data = JSON.parse(String(payload)); if (data.type === 'state') state = data; } catch { /* Non-JSON. */ } }));
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  await page.getByLabel('목표 킬 수', { exact: true }).fill('7'); await page.getByLabel('제한 시간 (분)', { exact: true }).fill('2'); await page.getByLabel('제한 시간 (분)', { exact: true }).press('Tab');
  await page.reload(); await expect(page.getByLabel('목표 킬 수', { exact: true })).toHaveValue('7'); await expect(page.getByLabel('제한 시간 (분)', { exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: '봇 한 명 줄이기' }).click(); await page.getByRole('button', { name: '봇 한 명 줄이기' }).click();
  await page.getByRole('button', { name: '방 만들고 출격', exact: true }).click();
  await expect(page.locator('#hud-frag-limit')).toHaveText('FIRST TO 7');
  await expect.poll(() => state?.room.roundSeconds).toBe(120); expect(state.room.fragLimit).toBe(7);
  await page.getByRole('button', { name: '로비로 나가기', exact: true }).click();
});

test('FAMAS fires a three-round burst on one press and does not repeat while held', async ({ page }) => {
  await fixture(page);
  try {
    await page.evaluate(() => { const { player, game, room } = window.__rules; Object.assign(player, { weaponId: 'famas', nextWeaponId: 'famas', ammo: 25, nextFireAt: 0, burstLeft: 0 }); game.predicted = null; game.applySnapshot(room.snapshot()); });
    await page.mouse.down(); await expect(page.locator('#hud-ammo')).toHaveText('22');
    const start = Date.now(); await expect.poll(async () => { await expect(page.locator('#hud-ammo')).toHaveText('22'); return Date.now() - start; }, { intervals: [100, 150], timeout: 3000 }).toBeGreaterThan(900);
    expect(await page.evaluate(() => window.__rules.sounds.filter((id) => id === 'famas').length)).toBe(3);
    await page.mouse.up(); await page.mouse.down(); await page.mouse.up(); await expect(page.locator('#hud-ammo')).toHaveText('19');
    expect(await page.locator('#respawn-weapon-choices button').count()).toBe(19);
    await expect.poll(() => page.evaluate(() => window.__rules.sounds.filter((id) => id === 'famas').length)).toBe(6);
  } finally { await dispose(page); }
});

test('view recoil returns to the pre-shot aim after both a tap and sustained fire', async ({ page }) => {
  await fixture(page);
  try {
    const initial = await page.evaluate(() => window.__rules.game.pitch);
    await page.mouse.down(); await page.mouse.up();
    await expect.poll(() => page.evaluate((initial) => window.__rules.game.pitch - initial, initial)).toBeGreaterThan(0.001);
    await expect.poll(() => page.evaluate((initial) => Math.abs(window.__rules.game.pitch - initial), initial), { timeout: 3000, intervals: [50, 100] }).toBeLessThan(0.00001);
    await page.mouse.down(); await expect.poll(() => page.evaluate((initial) => window.__rules.game.pitch - initial, initial)).toBeGreaterThan(0.06); await page.mouse.up();
    await expect.poll(() => page.evaluate((initial) => Math.abs(window.__rules.game.pitch - initial), initial), { timeout: 3000, intervals: [50, 100] }).toBeLessThan(0.00001);
    await expect.poll(() => page.evaluate((initial) => Math.abs(window.__rules.player.pitch - initial), initial)).toBeLessThan(0.00001);
    const alignment = await page.evaluate(() => { const { game } = window.__rules; return Math.abs(game.camera.rotation.x - game.input().pitch); });
    expect(alignment).toBeLessThan(1e-9);
  } finally { await dispose(page); }
});

test('mouse aiming during recoil is preserved when the recoil recovers', async ({ page }) => {
  await fixture(page);
  try {
    await page.mouse.down(); await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__rules.game.pitch)).toBeGreaterThan(0.001);
    await page.evaluate(() => {
      const event = new MouseEvent('mousemove', { bubbles: true });
      Object.defineProperties(event, { movementY: { value: -20 }, movementX: { value: 6 } }); document.dispatchEvent(event);
    });
    await expect.poll(() => page.evaluate(() => Math.abs(window.__rules.game.pitch - 0.04)), { timeout: 3000, intervals: [50, 100] }).toBeLessThan(0.00001);
    expect(await page.evaluate(() => window.__rules.game.yaw)).toBeCloseTo(-0.012, 8);
    await expect.poll(() => page.evaluate(() => Math.abs(window.__rules.player.pitch - 0.04))).toBeLessThan(0.00001);
  } finally { await dispose(page); }
});
