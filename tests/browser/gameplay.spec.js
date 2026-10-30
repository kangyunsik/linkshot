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
  expect(result.counts).toHaveLength(20); for (const count of result.counts) { expect(count.count).toBe(1); expect(count.duration).toBeGreaterThan(0.3); }
  expect(result.identical).toBe(true);
  expect(result.voices).toBeGreaterThan(0); expect(result.voices).toBeLessThanOrEqual(40);
});

test('boot sounds are spatial, stance-aware and bounded; kill cues are distinct and obey mute', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  const result = await page.evaluate(async () => {
    const { GameAudio } = await import('/audio.js'), audio = new GameAudio({ volume: 100 }); await audio.unlock(); await audio.ready; audio.master.gain.cancelScheduledValues(audio.context.currentTime); audio.master.gain.value = 0;
    const walk = audio.step(false, false, { pan: -0.8 }), run = audio.step(true), crouch = audio.step(false, true), wall = audio.step(false, false, { volume: 0.3, occluded: true });
    const single = audio.kill(1), triple = audio.kill(3, true);
    for (let i = 0; i < 40; i++) audio.step(false, false, { foot: i % 2 });
    const result = { walk: walk.gain.gain.value, run: run.gain.gain.value, crouch: crouch.gain.gain.value, pan: walk.panner.pan.value, filtered: wall.filter.frequency.value < walk.filter.frequency.value, steps: audio.stepVoices.size, killDistinct: single.source.buffer !== triple.source.buffer, killRate: triple.source.playbackRate.value, sniperSeconds: ['sniper', 'awp', 'm82'].map((id) => audio.samples.get(id)[0].duration) };
    audio.muted = true; result.mutedStep = audio.step() === null; result.mutedKill = audio.kill(2) === null;
    audio.muted = false; audio.settings.volume = 0; result.zeroVolume = audio.step() === null && audio.kill() === null;
    await audio.context.close(); return result;
  });
  expect(result.run).toBeGreaterThan(result.walk); expect(result.walk).toBeGreaterThan(result.crouch); expect(result.pan).toBeCloseTo(-0.8, 6); expect(result.filtered).toBe(true); expect(result.steps).toBeLessThanOrEqual(16);
  expect(result.killDistinct).toBe(true); expect(result.killRate).toBe(1); expect(result.mutedStep && result.mutedKill && result.zeroVolume).toBe(true);
  expect(result.sniperSeconds[0]).toBeCloseTo(1.65, 2); expect(result.sniperSeconds[1]).toBeCloseTo(1.95, 2); expect(result.sniperSeconds[2]).toBeCloseTo(2.2, 2);
});

test('local and nearby remote movement both produce footsteps, but dead sources do not', async ({ page }) => {
  await fixture(page);
  try {
    const result = await page.evaluate(() => {
      const { game, room, timer } = window.__rules; clearInterval(timer); cancelAnimationFrame(game.frameId);
      room.world = { ...room.world, width: 100, depth: 100, obstacles: [] }; game.world = room.world;
      const steps = []; game.audio.step = (sprint, crouched, mix) => steps.push({ sprint, crouched, ...mix });
      game.keys.add('KeyW'); const avatar = game.remote.get('other'); Object.assign(avatar.target, { moveSpeed: 5.7, grounded: true, hp: 100 });
      const start = performance.now(); game.previousFrame = start;
      for (let i = 1; i <= 120; i++) { avatar.target.z = 6 - i * 5.7 / 60; game.animate(start + i * 1000 / 60); cancelAnimationFrame(game.frameId); }
      const local = steps.filter((step) => !step.remote), remote = steps.filter((step) => step.remote), beforeDeath = steps.length;
      game.local.hp = 0; avatar.target.hp = 0;
      for (let i = 121; i <= 180; i++) { avatar.target.z -= 0.1; game.animate(start + i * 1000 / 60); cancelAnimationFrame(game.frameId); }
      return { local, remote, beforeDeath, afterDeath: steps.length };
    });
    expect(result.local.length).toBeGreaterThanOrEqual(3); expect(result.remote.length).toBeGreaterThanOrEqual(3); expect(result.afterDeath).toBe(result.beforeDeath);
    expect(result.local.every((step) => step.playerId === 'viewer' && step.volume === 1)).toBe(true);
    expect(result.remote.every((step) => step.playerId === 'other' && step.pan < 0 && step.volume > 0 && step.volume < 1)).toBe(true);
  } finally { await dispose(page); }
});

test('only confirmed personal kills play kill/multikill audio, including the final kill, without duplicates', async ({ page }) => {
  await fixture(page);
  try {
    const cues = await page.evaluate(() => {
      const { game, timer } = window.__rules; clearInterval(timer); const cues = []; game.audio.kill = (chain, headshot) => cues.push({ chain, headshot });
      const event = { type: 'kill', killId: 'audio-kill-1', killerId: 'viewer', victimId: 'other', killer: 'VIEWER', victim: 'OPERATOR', weaponId: 'rifle', killChain: 1, headshot: false };
      game.handleEvent(event); game.handleEvent(event); game.handleEvent({ ...event, killId: 'someone-else', killerId: 'other' });
      game.handleEvent({ ...event, killId: 'audio-kill-2', killChain: 2, headshot: true });
      game.room.phase = 'ended'; game.handleEvent({ ...event, killId: 'audio-kill-3', killChain: 3 }); return cues;
    });
    expect(cues).toEqual([{ chain: 1, headshot: false }, { chain: 2, headshot: true }, { chain: 3, headshot: false }]);
  } finally { await dispose(page); }
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
    expect(await page.locator('#respawn-weapon-choices button').count()).toBe(20);
    await expect.poll(() => page.evaluate(() => window.__rules.sounds.filter((id) => id === 'famas').length)).toBe(6);
  } finally { await dispose(page); }
});

test('an empty magazine reloads automatically after a tap, updating the HUD and playing one reload sound', async ({ page }) => {
  await fixture(page);
  try {
    await page.evaluate(() => {
      const f = window.__rules; f.player.ammo = 1; f.player.magazines.rifle = 1; f.game.applySnapshot(f.room.snapshot());
      f.reloads = 0; f.game.audio.reload = () => { f.reloads++; };
    });
    await page.mouse.down(); await page.mouse.up(); await expect(page.locator('#reload-indicator')).toBeVisible();
    expect(await page.evaluate(() => window.__rules.game.fireHeld)).toBe(false);
    await expect(page.locator('#hud-ammo')).toHaveText('30'); await expect(page.locator('#reload-indicator')).toBeHidden();
    expect(await page.evaluate(() => window.__rules.reloads)).toBe(1);
    expect(await page.evaluate(() => window.__rules.sounds.filter((id) => id === 'rifle').length)).toBe(1);
  } finally { await dispose(page); }
});

test('jumping preserves takeoff momentum while mouse look, strafe, sprint and ADS inputs change', async ({ page }) => {
  await fixture(page);
  try {
    await page.evaluate(() => { const { room, game } = window.__rules; room.world = { ...room.world, width: 100, depth: 100, obstacles: [] }; game.world = room.world; });
    await page.keyboard.down('KeyW'); await page.keyboard.press('Space'); await expect.poll(() => page.evaluate(() => window.__rules.player.grounded)).toBe(false);
    const takeoff = await page.evaluate(() => { const p = window.__rules.player; return { x: p.x, vx: p.vx, vz: p.vz, yaw: p.yaw }; });
    await page.keyboard.up('KeyW'); await page.keyboard.down('KeyD'); await page.keyboard.down('ShiftLeft'); await page.mouse.down({ button: 'right' });
    await page.evaluate(() => { const event = new MouseEvent('mousemove', { bubbles: true }); Object.defineProperty(event, 'movementX', { value: 200 }); document.dispatchEvent(event); });
    await expect.poll(() => page.evaluate(() => window.__rules.player.yaw)).not.toBe(takeoff.yaw);
    const flight = await page.evaluate(() => { const { player: p, game } = window.__rules; return { x: p.x, vx: p.vx, vz: p.vz, grounded: p.grounded, predictedVx: game.predicted.vx, predictedVz: game.predicted.vz }; });
    expect(flight.grounded).toBe(false); expect(flight.x).toBeCloseTo(takeoff.x, 8); expect(flight.vx).toBe(takeoff.vx); expect(flight.vz).toBe(takeoff.vz); expect(flight.predictedVx).toBe(takeoff.vx); expect(flight.predictedVz).toBe(takeoff.vz);
    await page.keyboard.up('KeyD'); await page.keyboard.up('ShiftLeft'); await page.mouse.up({ button: 'right' });
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

test('death cancels held fire, burst prediction, ADS and delayed local shot feedback', async ({ page }) => {
  await fixture(page);
  try {
    await page.mouse.down(); await expect.poll(() => page.evaluate(() => window.__rules.sounds.length)).toBeGreaterThan(0);
    const before = await page.evaluate(() => {
      const { player, game, room, sounds } = window.__rules;
      Object.assign(game, { localBurstLeft: 2, localFirePending: true, ads: true });
      Object.assign(player, { hp: 0, diedAt: Date.now(), respawnAt: Date.now() + 3000, lastDeath: { attackerName: 'OPERATOR', weaponId: 'ak47', weaponLevel: 3, headshot: true } });
      game.applySnapshot(room.snapshot());
      game.playLocalShot({ id: 'ak47', type: 'ASSAULT', recoil: 2.2 }, performance.now());
      return { sounds: sounds.length, ammo: player.ammo };
    });
    await page.mouse.up(); await page.mouse.down(); await page.mouse.up();
    await expect(page.locator('#death-attacker')).toHaveText('OPERATOR'); await expect(page.locator('#death-weapon')).toHaveText('AK-47'); await expect(page.locator('#death-weapon-level')).toHaveText('Lv.3');
    const after = await page.evaluate(() => { const { game, sounds, player } = window.__rules; return { sounds: sounds.length, ammo: player.ammo, held: game.fireHeld, burst: game.localBurstLeft, pending: game.localFirePending, fire: game.input().fire, muzzle: game.muzzleUntil, ads: game.ads }; });
    expect(after).toEqual({ ...before, held: false, burst: 0, pending: false, fire: false, muzzle: 0, ads: false });
  } finally { await dispose(page); }
});

test('delayed and duplicate shot acknowledgements do not play AK/M4 audio twice', async ({ page }) => {
  await fixture(page);
  try {
    const counts = await page.evaluate(async () => {
      const { game, timer, sounds } = window.__rules; clearInterval(timer);
      const { getWeapon } = await import('/shared/catalog.js'), results = [];
      for (const id of ['ak47', 'm4a1']) {
        game.fireSeq++; game.localShotIndex = 0; const before = sounds.length;
        game.playLocalShot(getWeapon(id), performance.now() - 2000);
        const event = { type: 'shot', id: 'viewer', weaponId: id, shotId: `${id}-delayed-1`, fireSeq: game.fireSeq, shotIndex: 1, origin: { x: 24, y: 1.62, z: 10 }, rays: [{ end: { x: 24, y: 1.62, z: 0 }, hit: null }] };
        game.handleEvent(event); game.handleEvent(event); results.push(sounds.length - before);
      }
      return results;
    });
    expect(counts).toEqual([1, 1]);
  } finally { await dispose(page); }
});

test('kill chains flash below the timer with per-kill weapon mastery and a level-up gauge', async ({ page }) => {
  await fixture(page);
  try {
    for (const [chain, label] of [[1, 'KILL'], [2, 'DOUBLE KILL'], [3, 'TRIPLE KILL'], [4, 'QUADRA KILL']]) {
      await page.evaluate((chain) => window.__rules.game.handleEvent({ type: 'kill', killId: `hud-kill-${chain}`, killerId: 'viewer', victimId: 'other', killer: 'VIEWER', victim: 'OPERATOR', weaponId: 'rifle', weaponKills: 49 + chain, weaponLevel: 1, killChain: chain, headshot: chain === 1 }), chain);
      await expect(page.locator('#kill-chain-label')).toHaveText(label); await expect(page.locator('#kill-chain-count')).toHaveText(`×${chain}`);
      await expect(page.locator('#mastery-level')).toContainText('Lv.1'); await expect(page.locator('#mastery-count')).toHaveText(`${chain - 1} / 100 KILLS → Lv.2`);
    }
    const placement = await page.evaluate(() => ({ clock: document.querySelector('.match-clock').getBoundingClientRect().bottom, banner: document.getElementById('kill-announcement').getBoundingClientRect().top, width: parseFloat(document.getElementById('mastery-fill').style.width) }));
    expect(placement.banner).toBeGreaterThan(placement.clock); expect(placement.width).toBe(3);
    await page.screenshot({ path: 'artifacts/kill-chain-mastery.png' });
  } finally { await dispose(page); }
});

test('local camera and remote operator crouch animate over about 100ms rather than snapping', async ({ page }) => {
  await fixture(page);
  try {
    const result = await page.evaluate(() => {
      const { game, timer } = window.__rules; clearInterval(timer); cancelAnimationFrame(game.frameId);
      game.keys.add('KeyC'); game.predicted.crouchAmount = 0; game.predicted.crouching = false;
      const remote = game.remote.get('other'); remote.target.crouching = true; remote.target.crouchAmount = 1;
      const start = performance.now(); game.previousFrame = start; const samples = [];
      for (let i = 1; i <= 6; i++) { game.animate(start + i * 1000 / 60); cancelAnimationFrame(game.frameId); samples.push({ crouch: game.predicted.crouchAmount, eye: game.camera.position.y - game.predicted.y, remote: remote.crouchAmount }); }
      return samples;
    });
    expect(result[0].crouch).toBeGreaterThan(0); expect(result[0].crouch).toBeLessThan(0.3); expect(result[0].eye).toBeGreaterThan(0.92); expect(result[0].remote).toBeLessThan(0.3);
    expect(result.at(-1).crouch).toBeCloseTo(1); expect(result.at(-1).eye).toBeCloseTo(0.92); expect(result.at(-1).remote).toBeCloseTo(1);
  } finally { await dispose(page); }
});

test('a server-first burst shot aligns later predictions and an old-life ACK cannot fire after respawn', async ({ page }) => {
  await fixture(page);
  try {
    const result = await page.evaluate(async () => {
      const { game, player, room, timer, sounds } = window.__rules; clearInterval(timer); cancelAnimationFrame(game.frameId);
      const { getWeapon } = await import('/shared/catalog.js'), weapon = getWeapon('famas');
      Object.assign(player, { weaponId: 'famas', nextWeaponId: 'famas', ammo: 25 }); game.applySnapshot(room.snapshot());
      game.fireSeq++; game.localShotIndex = 0; game.fireHeld = true; game.localBurstLeft = 0;
      const event = { type: 'shot', id: 'viewer', weaponId: 'famas', spawnCount: player.spawnCount, shotId: 'server-first-1', fireSeq: game.fireSeq, shotIndex: 1, origin: { x: 24, y: 1.62, z: 10 }, rays: [{ end: { x: 24, y: 1.62, z: 0 }, hit: null }] };
      game.handleEvent(event); const remaining = game.localBurstLeft, firstIndex = game.localShotIndex;
      for (const shotIndex of [2, 3]) { game.playLocalShot(weapon, performance.now()); game.localBurstLeft--; game.handleEvent({ ...event, shotId: `server-first-${shotIndex}`, shotIndex }); }
      game.handleEvent({ ...event, shotId: 'old-life-late', fireSeq: game.fireSeq - 1, spawnCount: player.spawnCount - 1 });
      return { remaining, firstIndex, sounds: sounds.filter((id) => id === 'famas').length };
    });
    expect(result).toEqual({ remaining: 2, firstIndex: 1, sounds: 3 });
  } finally { await dispose(page); }
});
