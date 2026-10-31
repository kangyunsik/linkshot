import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => { try { localStorage.setItem('sector07-settings', JSON.stringify({ sensitivity: 1, fov: 82, volume: 0, quality: 'low' })); } catch { /* about:blank */ } });
});

async function componentGame(page) {
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  await page.evaluate(async () => {
    const [{ FPSGame }, { Room }] = await Promise.all([import('/game.js'), import('/shared/simulation.js')]);
    const room = new Room('HUD22', { bots: 0 });
    const player = room.addPlayer('viewer', 'VIEWER'), attacker = room.addPlayer('attacker', 'ATTACKER');
    Object.assign(player, { x: 24, y: 0, z: 10, yaw: Math.PI / 2, pitch: 0, protectedUntil: 0 });
    Object.assign(attacker, { x: 24, y: 0, z: 0, yaw: Math.PI, pitch: 0, protectedUntil: 0 });
    room.events.length = 0;
    const audio = { unlock: async () => {}, shot() {}, hit() {}, hurt() {}, kill() {}, step() {}, reload() {} };
    document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
    const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), settings: { sensitivity: 1, fov: 82, volume: 0, quality: 'low' }, audio, mapId: 'foundry', send() {}, onMenu: (show) => { document.getElementById('pause-overlay').hidden = !show; }, onFatal: (message) => { throw new Error(message); } });
    game.applySnapshot(room.snapshot(), player.id); await game.prepareGraphics();
    document.getElementById('pause-overlay').hidden = false;
    const start = () => game.lock(); document.getElementById('resume-button').addEventListener('click', start);
    window.__tacticalTest = { game, room, player, attacker, start };
  });
  await page.getByRole('button', { name: '교전 시작', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('game-canvas');
}

async function disposeComponent(page) {
  await page.evaluate(() => {
    const fixture = window.__tacticalTest;
    if (fixture) { document.getElementById('resume-button').removeEventListener('click', fixture.start); fixture.game.dispose(); delete window.__tacticalTest; }
    document.getElementById('game-shell').hidden = true; document.getElementById('lobby').hidden = false;
  });
}

test('rifle ADS reticle stays centered and visual recoil cannot change authoritative aim', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await componentGame(page);
  try {
    await page.mouse.down({ button: 'right' });
    await expect.poll(() => page.evaluate(async () => {
      const { Vector3 } = await import('/vendor/three.module.js');
      const { game } = window.__tacticalTest;
      if (!game.sightAligned) return 1;
      const point = game.activeModel.localToWorld(game.activeModel.userData.aimPoint.clone()).project(game.camera);
      return Math.hypot(point.x, point.y);
    })).toBeLessThan(0.001);
    const recoilError = await page.evaluate(async () => {
      const { game } = window.__tacticalTest; game.recoil = 2;
      await new Promise(requestAnimationFrame);
      return Math.abs(game.camera.rotation.x - game.input().pitch);
    });
    expect(recoilError).toBeLessThan(1e-9);
    await page.keyboard.down('KeyC');
    await expect.poll(() => page.evaluate(() => window.__tacticalTest.game.predicted.crouching)).toBe(true);
    await expect.poll(() => page.evaluate(() => { const { game } = window.__tacticalTest; return game.camera.position.y - game.predicted.y; })).toBeCloseTo(0.92, 5);
    await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/rifle-ads-crouched.png' });
    await page.keyboard.up('KeyC'); await page.mouse.up({ button: 'right' });
    expect(errors).toEqual([]);
  } finally { await disposeComponent(page); }
});

test('real damage events show a red incoming direction, rotate with the camera and expire', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await componentGame(page);
  try {
    const impactMeshes = await page.evaluate(() => {
      const { game, room, attacker } = window.__tacticalTest;
      room.shoot(attacker, Date.now(), true); game.applySnapshot(room.snapshot());
      return game.effects.filter((effect) => effect.object.isMesh).length;
    });
    expect(impactMeshes).toBe(0); // A head impact at the camera must not obscure the warning with a giant spark.
    await expect(page.locator('.damage-direction')).toHaveCount(1);
    await expect(page.locator('.damage-direction')).toHaveAttribute('data-direction', 'right');
    await expect(page.locator('#damage-direction-caption')).toBeHidden();
    await page.evaluate(() => { window.__tacticalTest.game.yaw = 0; });
    await expect(page.locator('.damage-direction')).toHaveAttribute('data-direction', 'front');
    await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/incoming-damage.png' });
    await expect(page.locator('.damage-direction')).toHaveCount(0); await expect(page.locator('#damage-direction-caption')).toBeHidden();
    expect(errors).toEqual([]);
  } finally { await disposeComponent(page); }
});

test('elevated stairs and jumps remain stable with delayed 20Hz snapshots', async ({ page }) => {
  await componentGame(page);
  try {
    const results = await page.evaluate(async () => {
      const { movePlayer, EMPTY_INPUT } = await import('/shared/movement.js');
      const { bounds, RULES, playerPose } = await import('/shared/world.js');
      const { game, room, player } = window.__tacticalTest; cancelAnimationFrame(game.frameId);
      const platform = room.world.platforms[0], results = [];
      for (const hz of [30, 60, 144]) {
        Object.assign(player, { x: platform.approach.x, y: 0, z: platform.approach.z, vy: 0, grounded: true, jumpHeld: false, crouching: false, yaw: Math.PI });
        game.predicted = null; game.applySnapshot(room.snapshot(), player.id);
        let accumulator = 0, ticks = 0, peak = 0, penetrating = false; const pending = [];
        for (let frame = 0; frame < hz * 3.1; frame++) {
          const time = frame / hz, input = { ...EMPTY_INPUT, yaw: Math.PI, forward: time < 0.9 ? 1 : 0, jump: time >= 1.4 && time < 1.55 };
          movePlayer(game.predicted, input, 1 / hz, game.world); accumulator += 1 / hz;
          while (accumulator >= 1 / 60 - 1e-9) {
            room.setInput(player.id, input); room.tick(1 / 60); accumulator -= 1 / 60; ticks++;
            if (ticks % 3 === 0) pending.push({ at: time + 0.075, snapshot: room.snapshot() });
          }
          while (pending[0]?.at <= time) game.applySnapshot(pending.shift().snapshot);
          peak = Math.max(peak, game.predicted.y);
          penetrating ||= game.world.obstacles.some((box) => {
            const b = bounds(box, RULES.playerRadius - 0.0001), p = game.predicted;
            return p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && p.y < b.maxY - 0.0001 && p.y + playerPose(p).height > b.minY + 0.0001;
          });
        }
        results.push({ hz, peak, penetrating, y: game.predicted.y, grounded: game.predicted.grounded, serverY: player.y });
      }
      return results;
    });
    for (const result of results) {
      expect(result.penetrating, `${result.hz}Hz`).toBe(false); expect(result.peak).toBeGreaterThan(3.8);
      expect(result.y).toBeCloseTo(1.8, 6); expect(result.serverY).toBeCloseTo(1.8, 6); expect(result.grounded).toBe(true);
    }
  } finally { await disposeComponent(page); }
});

test('a quick Space tap is sent immediately and survives the next network input interval', async ({ page }) => {
  await componentGame(page);
  try {
    await page.evaluate(() => { const { game } = window.__tacticalTest; game.__sent = []; game.send = (input) => game.__sent.push(input); });
    await page.keyboard.press('Space');
    const sent = await page.evaluate(() => { const { game } = window.__tacticalTest; return { jumpMessages: game.__sent.filter((input) => input.jump).length, released: !game.keys.has('Space') }; });
    expect(sent.jumpMessages).toBeGreaterThan(0); expect(sent.released).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__tacticalTest.game.predicted.y)).toBeGreaterThan(1.8);
    await expect.poll(() => page.evaluate(() => window.__tacticalTest.game.predicted.grounded)).toBe(true);
    expect(await page.evaluate(() => window.__tacticalTest.game.predicted.y)).toBe(0);
  } finally { await disposeComponent(page); }
});
