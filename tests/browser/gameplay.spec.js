import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { WEAPONS } from '../../shared/catalog.js';

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
    game.applySnapshot(room.snapshot(), player.id); await game.prepareGraphics(); document.getElementById('pause-overlay').hidden = false;
    let ticks = 0; const timer = setInterval(() => { room.tick(1 / 60); if (++ticks % 3 === 0) game.applySnapshot(room.snapshot()); }, 1000 / 60);
    const start = () => game.lock(); document.getElementById('resume-button').addEventListener('click', start);
    window.__rules = { room, game, player, timer, start, sounds };
  }, mapId);
  await page.getByRole('button', { name: '교전 시작', exact: true }).click(); await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game-canvas');
}
async function dispose(page) {
  await page.evaluate(() => { const f = window.__rules; if (f) { clearInterval(f.timer); document.getElementById('resume-button').removeEventListener('click', f.start); f.game.dispose(); delete window.__rules; } });
}

test('live weapons stay locked; Shift is silent walking, grounded crouch works and airborne crouch stays blocked', async ({ page }) => {
  await fixture(page);
  try {
    await page.keyboard.press('Digit4'); await page.mouse.wheel(0, 300);
    expect(await page.evaluate(() => window.__rules.player.weaponId)).toBe('rifle');
    await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyC');
    await expect.poll(() => page.evaluate(() => window.__rules.player.walking && window.__rules.player.crouching)).toBe(true);
    expect(await page.evaluate(() => window.__rules.player.sprinting)).toBe(false); await page.keyboard.up('KeyC');
    await expect.poll(() => page.evaluate(() => Math.abs(window.__rules.player.moveSpeed - 2.85))).toBeLessThan(.05);
    await page.mouse.down(); await expect(page.locator('#crosshair')).toHaveAttribute('data-accuracy', 'walking');
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

test('Escape opens the menu while dead, locked or not, without delaying the respawn', async ({ page }) => {
  await fixture(page);
  try {
    const life = await page.evaluate(() => {
      const { game, room, player } = window.__rules, now = Date.now();
      Object.assign(player, { hp: 0, diedAt: now, respawnAt: now + 12000 });
      game.applySnapshot(room.snapshot()); return { spawn: player.spawnCount, deadline: player.respawnAt };
    });
    await expect(page.locator('#respawn-overlay')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('#pause-overlay')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
    await page.evaluate(() => { document.getElementById('pause-overlay').hidden = true; });
    await page.keyboard.press('Escape'); await expect(page.locator('#pause-overlay')).toBeVisible();
    expect(await page.evaluate(() => window.__rules.player.respawnAt)).toBe(life.deadline);
    await page.evaluate(() => {
      const { game, room, player } = window.__rules;
      player.respawnAt = Date.now() - 1; room.tick(1 / 60); game.applySnapshot(room.snapshot());
    });
    await expect(page.locator('#respawn-overlay')).toBeHidden(); await expect(page.locator('#pause-overlay')).toBeVisible();
    expect(await page.evaluate(() => window.__rules.player.spawnCount)).toBe(life.spawn + 1);
    await page.locator('#resume-button').click(); await expect(page.locator('#pause-overlay')).toBeHidden();
  } finally { await dispose(page); }
});

test('death camera eases toward the last attacker position without moving the player or following the attacker', async ({ page }) => {
  await fixture(page);
  try {
    const turns = await page.evaluate(async () => {
      const { getWeapon } = await import('/shared/catalog.js');
      const { game, room, player, timer } = window.__rules;
      clearInterval(timer); cancelAnimationFrame(game.frameId);
      game.yaw = 0; game.pitch = 0;
      const attacker = room.players.get('other'), origin = { x: 15, y: 2, z: 15 };
      room.applyDamage(attacker, player, 100, false, origin, getWeapon('rifle'), Date.now());
      game.applySnapshot(room.snapshot());
      const { startedAt, duration } = game.deathLook;
      const sample = time => {
        game.previousFrame = time - 60; game.animate(time); cancelAnimationFrame(game.frameId);
        return { yaw: game.camera.rotation.y, x: game.camera.position.x, z: game.camera.position.z };
      };
      const first = sample(startedAt), middle = sample(startedAt + duration / 2), end = sample(startedAt + duration);
      attacker.x = 27; attacker.z = -17;
      game.applySnapshot(room.snapshot());
      const later = sample(startedAt + duration + 200), playerYaw = game.yaw;
      room.spawn(player); game.applySnapshot(room.snapshot());
      const respawn = sample(startedAt + duration + 260);
      return { first, middle, end, later, playerYaw, victim: { x: 24, z: 10 }, expectedYaw: Math.atan2(9, -5), reset: game.deathLook === null, respawnYaw: player.yaw, respawn };
    });
    expect(turns.first.yaw).toBeCloseTo(0);
    expect(turns.middle.yaw).toBeCloseTo(turns.expectedYaw / 2);
    expect(turns.end.yaw).toBeCloseTo(turns.expectedYaw);
    expect(turns.later.yaw).toBe(turns.end.yaw);
    expect(turns.end.x).toBeCloseTo(turns.victim.x); expect(turns.end.z).toBeCloseTo(turns.victim.z);
    expect(turns.playerYaw).toBe(0);
    expect(turns.reset).toBe(true);
    expect(turns.respawn.yaw).toBeCloseTo(turns.respawnYaw);
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
  expect(result.counts).toHaveLength(WEAPONS.length); for (const count of result.counts) { expect(count.count).toBe(1); expect(count.duration).toBeGreaterThan(0.3); }
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
    const result = { walk: walk.gain.gain.value, run: run.gain.gain.value, crouch: crouch.gain.gain.value, pan: walk.panner.pan.value, filtered: wall.filter.frequency.value < walk.filter.frequency.value, walkCutoff: walk.filter.frequency.value, crouchCutoff: crouch.filter.frequency.value, stepRate: walk.source.playbackRate.value, steps: audio.stepVoices.size, killDistinct: single.source.buffer !== triple.source.buffer, killRate: triple.source.playbackRate.value, sniperSeconds: ['sniper', 'awp', 'm82'].map((id) => audio.samples.get(id)[0].duration) };
    audio.muted = true; result.mutedStep = audio.step() === null; result.mutedKill = audio.kill(2) === null;
    audio.muted = false; audio.settings.volume = 0; result.zeroVolume = audio.step() === null && audio.kill() === null;
    await audio.context.close(); return result;
  });
  expect(result.run).toBeGreaterThan(result.walk); expect(result.walk).toBeGreaterThan(result.crouch); expect(result.pan).toBeCloseTo(-0.8, 6); expect(result.filtered).toBe(true); expect(result.steps).toBeLessThanOrEqual(16);
  expect(result.walkCutoff).toBe(2600); expect(result.crouchCutoff).toBe(1900); expect(result.stepRate).toBe(1);
  expect(result.killDistinct).toBe(true); expect(result.killRate).toBe(1); expect(result.mutedStep && result.mutedKill && result.zeroVolume).toBe(true);
  expect(result.sniperSeconds[0]).toBeCloseTo(1.65, 2); expect(result.sniperSeconds[1]).toBeCloseTo(1.95, 2); expect(result.sniperSeconds[2]).toBeCloseTo(2.2, 2);
});

test('all weapon-specific recorded reloads match the server timer, seek correctly and stop on cancellation', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  const result = await page.evaluate(async () => {
    const [{ GameAudio }, { WEAPONS }] = await Promise.all([import('/audio.js'), import('/shared/catalog.js')]);
    const audio = new GameAudio({ volume: 100 }); await audio.unlock(); await audio.reloadReady; audio.master.gain.cancelScheduledValues(audio.context.currentTime); audio.master.gain.value = 0;
    const profiles = WEAPONS.map((weapon) => { const voice = audio.reload(weapon.id, weapon.reloadSeconds); return { id: voice.weaponId, duration: voice.source.buffer.duration, expected: weapon.reloadSeconds, rate: voice.source.playbackRate.value, offset: voice.offset }; });
    const seek = audio.reload('pistol', .5).offset; audio.stopReload(); const stopped = audio.reloadVoice === null;
    let allowed = true; const rifle = audio.reloadSamples.get('rifle'); audio.reloadSamples.delete('rifle'); audio.reloadReady = Promise.resolve().then(() => { allowed = false; audio.reloadSamples.set('rifle', rifle); });
    audio.reload('rifle', 1, () => allowed); await audio.reloadReady; await Promise.resolve(); const staleCancelled = audio.reloadVoice === null;
    const rejected = audio.reload('rifle', 1, () => false) === null; audio.muted = true; const muted = audio.reload('rifle') === null;
    const count = audio.reloadSamples.size; await audio.context.close(); return { profiles, seek, stopped, staleCancelled, rejected, muted, count };
  });
  expect(result.count).toBe(WEAPONS.length); expect(result.profiles).toHaveLength(WEAPONS.length);
  for (const profile of result.profiles) { expect(profile.duration).toBeCloseTo(profile.expected, 4); expect(profile.rate).toBe(1); expect(profile.offset).toBe(0); }
  expect(result.seek).toBeCloseTo(.65, 4); expect(result.stopped && result.staleCancelled && result.rejected && result.muted).toBe(true);
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
      for (let i = 1; i <= 120; i++) { avatar.target.z = 6 - i * 5.7 / 60; avatar.target.stepDistance = i * 5.7 / 60; game.animate(start + i * 1000 / 60); cancelAnimationFrame(game.frameId); }
      const local = steps.filter((step) => !step.remote), remote = steps.filter((step) => step.remote), beforeWalk = steps.length;
      game.keys.add('ShiftLeft'); avatar.target.walking = true;
      for (let i = 121; i <= 240; i++) { avatar.target.z -= 2.85 / 60; game.animate(start + i * 1000 / 60); cancelAnimationFrame(game.frameId); }
      const afterWalk = steps.length, beforeDeath = steps.length;
      game.local.hp = 0; avatar.target.hp = 0;
      for (let i = 241; i <= 300; i++) { avatar.target.z -= 0.1; game.animate(start + i * 1000 / 60); cancelAnimationFrame(game.frameId); }
      return { local, remote, beforeWalk, afterWalk, beforeDeath, afterDeath: steps.length };
    });
    expect(result.local.length).toBeGreaterThanOrEqual(3); expect(result.remote.length).toBeGreaterThanOrEqual(3); expect(result.afterWalk).toBe(result.beforeWalk); expect(result.afterDeath).toBe(result.beforeDeath);
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

test('rifle spread marks stay tight and Shift only narrows the guide while walking upright', async ({ page }) => {
  await fixture(page);
  try {
    const values = await page.evaluate(async () => {
      const { getWeapon } = await import('/shared/catalog.js');
      const { game, room, player, timer } = window.__rules;
      clearInterval(timer); cancelAnimationFrame(game.frameId);
      game.world = room.world = { ...room.world, obstacles: [] };
      let clock = performance.now() + 50;
      const measure = (id, ads = false, walk = false, heat = 0, moving = false, crouching = false) => {
        const weapon = getWeapon(id);
        Object.assign(player, { x: 24, y: 0, z: 10, grounded: true, moveSpeed: 0, weaponId: id, reloadUntil: 0, switchUntil: 0, shotHeat: heat, crouching, crouchAmount: Number(crouching) });
        game.predicted = null; game.applySnapshot(room.snapshot());
        game.keys.clear(); if (walk) game.keys.add('ShiftLeft'); if (moving) game.keys.add('KeyW');
        if (crouching) game.keys.add('KeyC');
        game.ads = ads; game.camera.fov = game.settings.fov * (ads ? weapon.zoom : 1);
        game.previousFrame = clock - 1000 / 60; game.animate(clock); clock += 33; cancelAnimationFrame(game.frameId);
        const dot = document.querySelector(weapon.type === 'SNIPER' ? '.scope-lens>i' : '#ads-reticle');
        const r = dot.getBoundingClientRect(), center = Math.hypot(r.x + r.width / 2 - innerWidth / 2, r.y + r.height / 2 - innerHeight / 2);
        return { gap: parseFloat(document.getElementById('crosshair').style.getPropertyValue('--crosshair-gap')),
          ring: parseFloat(getComputedStyle(dot, '::after').width), center };
      };
      return { m4: measure('m4a1'), ak: measure('ak47'), walk: measure('m4a1', false, true),
        run: measure('m4a1', false, false, 0, true), walkMoving: measure('m4a1', false, true, 0, true),
        crouch: measure('m4a1', false, false, 0, true, true), crouchShift: measure('m4a1', false, true, 0, true, true),
        m4Ads: measure('m4a1', true), akAds: measure('ak47', true), hot: measure('ak47', true, false, .9),
        scope: measure('sniper', true), heavyScope: measure('m82', true) };
    });
    expect(values.ak.gap).toBeGreaterThan(values.m4.gap + 4);
    expect(values.walk.gap).toBe(values.m4.gap);
    expect(values.crouchShift.gap).toBe(values.crouch.gap);
    expect(values.run.gap - values.m4.gap).toBeGreaterThan(2);
    expect(values.run.gap - values.m4.gap).toBeLessThan(3.5);
    expect(values.walkMoving.gap).toBeLessThan(values.run.gap);
    expect(values.akAds.ring).toBeGreaterThan(values.m4Ads.ring + 3);
    expect(values.hot.ring).toBeGreaterThan(values.akAds.ring + 8);
    expect(values.scope.ring).toBeGreaterThan(6); expect(values.heavyScope.ring).toBeGreaterThan(values.scope.ring);
    for (const profile of [values.m4Ads, values.akAds, values.scope, values.heavyScope]) expect(profile.center).toBeLessThan(.01);
  } finally { await dispose(page); }
});

test('a lethal shot leaves a temporary unarmed falling body and one independently dropped weapon', async ({ page }) => {
  await fixture(page);
  try {
    await page.evaluate(async () => {
      const { getWeapon } = await import('/shared/catalog.js');
      const { game, room, player } = window.__rules, victim = room.players.get('other'), origin = { x: 24, y: 1.6, z: 10 };
      Object.assign(victim, { x: 24.45, y: 0, z: 6.8, yaw: Math.PI });
      game.remote.get(victim.id).group.position.set(victim.x, victim.y, victim.z);
      room.applyDamage(player, victim, 100, false, origin, getWeapon('rifle'), Date.now());
      game.applySnapshot(room.snapshot());
      game.combat.blood({ x: victim.x, y: 1.2, z: victim.z }, origin, 0);
    });
    expect(await page.evaluate(() => window.__rules.game.combat.bursts.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__rules.game.combat.corpses[0]?.settled)).toBe(true);
    const result = await page.evaluate(() => {
      const { game, room } = window.__rules, corpse = game.combat.corpses[0];
      return { count: game.combat.corpses.length, armed: !!corpse.operator.weapon, dropped: room.droppedWeapons.size,
        hidden: !game.remote.get('other').group.visible, falling: corpse.pivot.rotation.x > 0, kills: room.players.get('viewer').kills };
    });
    expect(result).toEqual({ count: 1, armed: false, dropped: 1, hidden: true, falling: true, kills: 1 });
    await page.screenshot({ path: 'artifacts/death-and-corpse.png' });
    expect(await page.evaluate(() => { const { game } = window.__rules; game.combat.update(performance.now() + 11000, 0.016); return game.combat.corpses.length + game.combat.bursts.length + game.combat.stains.length; })).toBe(0);
    await expect(page.locator('#damage-direction-caption')).toBeHidden();
  } finally { await dispose(page); }
});

test('nearby bullets play once and actual hits use a separate incoming cue, including lethal hits', async ({ page }) => {
  await fixture(page);
  try {
    const cues = await page.evaluate(() => {
      const { game, room, player, timer, sounds } = window.__rules, passes = [], impacts = [];
      clearInterval(timer); cancelAnimationFrame(game.frameId);
      let confirmations = 0; game.audio.hit = () => confirmations++;
      game.audio.bulletPass = cue => passes.push(cue); game.audio.hurt = cue => impacts.push(cue);
      const open = { ...room.world, width: 200, depth: 200, obstacles: [] }, shooter = room.players.get('other');
      room.random = () => 0;
      Object.assign(player, { x: 24, y: 0, z: 10, yaw: 0, protectedUntil: 0 }); game.predicted = null;
      Object.assign(shooter, { x: 24.66, y: 0, z: 13, yaw: 0, pitch: 0, weaponId: 'shotgun', ammo: 8, grounded: true, moveSpeed: 0 });
      const shoot = (world = open) => {
        game.world = room.world = world; shooter.shotHeat = 0;
        room.shoot(shooter, Date.now(), true);
        const state = room.snapshot(); game.applySnapshot(state);
        return state.events.find(event => event.type === 'shot');
      };
      const miss = shoot(); game.handleEvent(miss);
      shoot({ ...open, obstacles: [{ id: 'test-cover', x: 25, y: 0, z: 12, w: 3, h: 3, d: .5 }] });
      const heardReports = sounds.length;
      Object.assign(shooter, { x: 24.75, z: 62, weaponId: 'sniper' }); shoot();
      const distantReport = sounds.length !== heardReports;
      Object.assign(shooter, { x: 24, z: 13, weaponId: 'rifle', pitch: -.18 }); shoot();
      Object.assign(shooter, { x: 24.25, weaponId: 'shotgun', pitch: 0 }); player.hp = 20;
      const lethal = shoot();
      game.handleEvent({ ...miss, shotId: 'after-death' });
      return { passes, impacts, confirmations, distantReport, hp: game.local.hp, mixed: lethal.rays.some(ray => !ray.hit) && lethal.rays.some(ray => ray.hit === player.id) };
    });
    expect(cues.passes).toHaveLength(2); expect(cues.distantReport).toBe(false);
    expect(cues.passes[0].distance).toBeLessThan(.7); expect(cues.passes[0].pan).toBeGreaterThan(.6);
    expect(cues.hp).toBe(0); expect(cues.mixed).toBe(true); expect(cues.confirmations).toBe(0);
    expect(cues.impacts).toEqual([expect.objectContaining({ headshot: false }), expect.objectContaining({ headshot: true })]);
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

test('holding ADS through ROUND OVER cannot open browser context menus on overlays and leaving restores normal page interaction', async ({ page }) => {
  await fixture(page);
  try {
    await page.evaluate(() => {
      const { game } = window.__rules; window.__contextMenus = [];
      document.addEventListener('contextmenu', (event) => window.__contextMenus.push({ prevented: event.defaultPrevented, target: event.target.id }), { signal: game.abort.signal });
      document.getElementById('restart-button').addEventListener('click', () => { const { room, player } = window.__rules; room.restart(player.id); game.applySnapshot(room.snapshot()); }, { signal: game.abort.signal });
    });
    await page.mouse.down({ button: 'right' }); await expect(page.locator('#ads-reticle')).toBeVisible();
    await page.evaluate(() => { const { room, game } = window.__rules; room.finish(); game.applySnapshot(room.snapshot()); });
    await expect(page.locator('#round-overlay')).toBeVisible(); await expect(page.locator('#ads-reticle')).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
    await page.mouse.up({ button: 'right' }); await page.locator('#round-table').click({ button: 'right' });
    await page.getByRole('button', { name: '다시 출격', exact: true }).click({ button: 'right' });
    const result = await page.evaluate(() => {
      const dispatch = (id) => { const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }); document.getElementById(id).dispatchEvent(event); return event.defaultPrevented; };
      return { natural: [...window.__contextMenus], overlay: dispatch('round-overlay'), result: dispatch('round-table'), button: dispatch('restart-button'), lobby: dispatch('lobby'), ads: window.__rules.game.ads, phase: window.__rules.room.phase };
    });
    expect(result.natural.length).toBeGreaterThan(0); expect(result.natural.every((event) => event.prevented)).toBe(true);
    expect(result.overlay && result.result && result.button).toBe(true); expect(result.lobby).toBe(false); expect(result.ads).toBe(false); expect(result.phase).toBe('ended');
    await page.getByRole('button', { name: '다시 출격', exact: true }).click(); await expect(page.locator('#round-overlay')).toBeHidden();
    await dispose(page);
    const restored = await page.evaluate(() => { const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }); document.getElementById('game-shell').dispatchEvent(event); return !event.defaultPrevented; });
    expect(restored).toBe(true);
  } finally { await dispose(page); }
});

test('host kill/time settings persist and are displayed in the actual LAN match', async ({ page }) => {
  let state; page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => { try { const data = JSON.parse(String(payload)); if (data.type === 'state') state = data; } catch { /* Non-JSON. */ } }));
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  await page.locator('#create-button').click();
  await page.getByLabel('목표 킬 수', { exact: true }).fill('7'); await page.getByLabel('제한 시간 (분)', { exact: true }).fill('2'); await page.getByLabel('제한 시간 (분)', { exact: true }).press('Tab');
  await page.reload(); await page.locator('#create-button').click(); await expect(page.getByLabel('목표 킬 수', { exact: true })).toHaveValue('7'); await expect(page.getByLabel('제한 시간 (분)', { exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: '봇 한 명 줄이기' }).click(); await page.getByRole('button', { name: '봇 한 명 줄이기' }).click();
  await page.locator('#room-create-confirm').click(); await expect(page.locator('#room-lobby-dialog')).toBeVisible(); await page.locator('#room-lobby-action').click();
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
    expect(await page.locator('#respawn-weapon-choices button').count()).toBe(WEAPONS.length);
    await expect.poll(() => page.evaluate(() => window.__rules.sounds.filter((id) => id === 'famas').length)).toBe(6);
  } finally { await dispose(page); }
});

test('an empty magazine reloads automatically after a tap, updating the HUD and playing one reload sound', async ({ page }) => {
  await fixture(page);
  try {
    await page.evaluate(() => {
      const f = window.__rules; f.player.ammo = 1; f.player.magazines.rifle = 1; f.game.applySnapshot(f.room.snapshot());
      f.reloads = 0; f.game.audio.reload = (id) => { f.reloads++; f.reloadWeapon = id; };
    });
    await page.mouse.down(); await page.mouse.up(); await expect(page.locator('#reload-indicator')).toBeVisible();
    expect(await page.evaluate(() => window.__rules.game.fireHeld)).toBe(false);
    await expect(page.locator('#hud-ammo')).toHaveText('30'); await expect(page.locator('#reload-indicator')).toBeHidden();
    expect(await page.evaluate(() => window.__rules.reloads)).toBe(1);
    expect(await page.evaluate(() => window.__rules.reloadWeapon)).toBe('rifle');
    expect(await page.evaluate(() => { const { player } = window.__rules; return player.reloadUntil === 0 && player.lastShot > 0; })).toBe(true);
    expect(await page.evaluate(() => window.__rules.sounds.filter((id) => id === 'rifle').length)).toBe(1);
  } finally { await dispose(page); }
});

test('AN-94 has a held fast first pair and a single quick tap never creates extra predicted or authoritative shots', async ({ page }) => {
  await fixture(page);
  try {
    await page.evaluate(() => {
      const f = window.__rules; Object.assign(f.player, { weaponId: 'an94', nextWeaponId: 'an94', ammo: 30, nextFireAt: 0 }); f.game.predicted = null; f.game.applySnapshot(f.room.snapshot());
      f.shotTimes = []; const shoot = f.room.shoot.bind(f.room); f.room.shoot = (...args) => { const ok = shoot(...args); if (ok && args[0].id === f.player.id) f.shotTimes.push(args[1]); return ok; };
    });
    await page.mouse.down(); await expect.poll(() => page.evaluate(() => window.__rules.shotTimes.length)).toBeGreaterThanOrEqual(4); await page.mouse.up();
    const times = await page.evaluate(() => window.__rules.shotTimes); expect(times[1] - times[0]).toBeGreaterThanOrEqual(40); expect(times[1] - times[0]).toBeLessThan(120); for (let i = 2; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(120);
    await page.evaluate(() => { const f = window.__rules; f.game.cancelAttack(); f.game.localNextFire = 0; f.player.ammo = 30; f.player.nextFireAt = 0; f.shotTimes.length = 0; f.sounds.length = 0; f.game.applySnapshot(f.room.snapshot()); });
    await page.mouse.down(); await page.mouse.up(); await expect(page.locator('#hud-ammo')).toHaveText('29'); const started = Date.now(); await expect.poll(async () => { expect(await page.evaluate(() => window.__rules.shotTimes.length)).toBe(1); return Date.now() - started; }).toBeGreaterThan(200);
    await expect.poll(() => page.evaluate(() => window.__rules.sounds.filter((id) => id === 'an94').length)).toBe(1);
  } finally { await dispose(page); }
});

test('a real hit applies a synchronized one-second movement slow without changing aim sensitivity', async ({ page }) => {
  await fixture(page);
  try {
    await page.evaluate(() => {
      const { room, player, game } = window.__rules, attacker = room.players.get('other'); room.world = { ...room.world, width: 100, depth: 100, obstacles: [] }; game.world = room.world;
      Object.assign(player, { x: 24, y: 0, z: 10, yaw: 0, pitch: 0, hp: 100, protectedUntil: 0 });
      Object.assign(attacker, { x: 24, y: 0, z: 14, yaw: 0, pitch: Math.atan2(1.05 - 1.62, 4), protectedUntil: 0, ammo: 30 });
      game.predicted = null; game.applySnapshot(room.snapshot()); room.shoot(attacker, Date.now(), true); game.applySnapshot(room.snapshot());
    });
    await page.keyboard.down('KeyW'); await expect.poll(() => page.evaluate(() => window.__rules.player.moveSpeed)).toBeCloseTo(3.99, 4);
    expect(await page.evaluate(() => window.__rules.game.predicted.hitSlowUntil === window.__rules.player.hitSlowUntil)).toBe(true);
    expect(await page.evaluate(() => window.__rules.game.settings.sensitivity)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__rules.player.moveSpeed), { timeout: 3000 }).toBeCloseTo(5.7, 4); await page.keyboard.up('KeyW');
  } finally { await dispose(page); }
});

for (const reducedMotion of ['no-preference', 'reduce']) test(`the redesigned SVG hitmarker is hollow, centered and distinguishes normal, head and protected hits (${reducedMotion})`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion });
  await fixture(page);
  try {
    await page.setViewportSize({ width: 1279, height: 799 });
    const states = [];
    for (const type of ['body', 'head', 'protected']) {
      states.push(await page.evaluate((type) => {
        const { game } = window.__rules, protectedHit = type === 'protected';
        game.handleEvent({ type: 'shot', shotId: `marker-${type}`, id: 'viewer', weaponId: 'rifle', origin: { x: 24, y: 1.62, z: 10 }, hit: protectedHit ? null : 'other', headshot: type === 'head', rays: [{ end: { x: 22, y: 1.1, z: 6 }, hit: protectedHit ? null : 'other', protectedTarget: protectedHit ? 'other' : null }] });
        const animation = game.hitmarkerAnimation, duration = animation.effect.getTiming().duration; animation.pause(); animation.currentTime = duration * .55;
        const marker = document.getElementById('hitmarker'), r = marker.getBoundingClientRect();
        return { text: marker.textContent.trim(), lines: marker.querySelector('.hit-lines').getAttribute('d').match(/M/g).length, center: Math.hypot(r.x + r.width / 2 - innerWidth / 2, r.y + r.height / 2 - innerHeight / 2), color: getComputedStyle(marker).color, crown: getComputedStyle(marker.querySelector('.head-accent')).display !== 'none', shield: getComputedStyle(marker.querySelector('.protected-accent')).display !== 'none', label: marker.getAttribute('aria-label'), width: parseFloat(getComputedStyle(marker).width), foreground: parseFloat(getComputedStyle(marker.querySelector('.hit-lines')).strokeWidth), outline: parseFloat(getComputedStyle(marker.querySelector('.hit-outline')).strokeWidth), holdOpacity: parseFloat(getComputedStyle(marker).opacity), duration };
      }, type));
    }
    for (const state of states) { expect(state.text).toBe(''); expect(state.lines).toBe(4); expect(state.center).toBeLessThan(.01); expect(state.width).toBeGreaterThanOrEqual(38); expect(state.foreground).toBeGreaterThanOrEqual(2.4); expect(state.outline).toBeGreaterThan(state.foreground); expect(state.holdOpacity).toBe(1); }
    expect(states[0].duration).toBeGreaterThanOrEqual(240); expect(states[1].duration).toBeGreaterThanOrEqual(320);
    expect(new Set(states.map((state) => state.color)).size).toBe(3); expect(states[1].crown).toBe(true); expect(states[2].shield).toBe(true); expect(states[2].label).toContain('스폰 보호');
    await expect(page.locator('#hitmarker')).not.toHaveClass(/visible/);
  } finally { await dispose(page); }
});

test('corpse fading reuses prepared shader programs and shared character buffers are released only by their owner', async ({ page }) => {
  await fixture(page);
  try {
    const result = await page.evaluate(async () => {
      const { game, timer } = window.__rules; clearInterval(timer); cancelAnimationFrame(game.frameId);
      const avatar = game.remote.get('other'), body = avatar.group.getObjectByName('SuperHero_Male'), geometry = body.geometry; let disposals = 0;
      geometry.addEventListener('dispose', () => { disposals++; }); game.combat.death(avatar.target);
      const corpse = game.combat.corpses[0], shared = corpse.operator.group.getObjectByName('SuperHero_Male').geometry === geometry;
      const materials = new Set(); corpse.pivot.traverse((object) => { if (object.isMesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); });
      const transparentAtBirth = [...materials].every((material) => material.transparent);
      game.combat.update(corpse.born + 1000, .016); game.renderer.render(game.scene, game.camera); const programs = game.renderer.info.programs.length;
      game.combat.update(corpse.born + 9000, .016); game.renderer.render(game.scene, game.camera); const afterFade = game.renderer.info.programs.length;
      const fading = [...materials].some((material) => material.opacity < .8); game.combat.clear(); const afterClear = disposals;
      await game.dispose(); return { ready: game.graphicsReady, shared, transparentAtBirth, programs, afterFade, fading, afterClear, finalDisposals: disposals };
    });
    expect(result.ready && result.shared && result.transparentAtBirth && result.fading).toBe(true); expect(result.afterFade).toBe(result.programs); expect(result.afterClear).toBe(0); expect(result.finalDisposals).toBe(1);
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
