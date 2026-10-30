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
    game.applySnapshot(room.snapshot(), player.id);
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
      const { game } = window.__tacticalTest, reticle = game.activeModel.userData.reticle;
      if (!reticle.visible) return 1;
      const point = reticle.getWorldPosition(new Vector3()).project(game.camera);
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
    expect(await page.evaluate(() => { const { game } = window.__tacticalTest; return game.camera.position.y - game.predicted.y; })).toBeCloseTo(0.92, 5);
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
    await expect(page.locator('#damage-direction-caption')).toHaveText('오른쪽에서 피격');
    await page.evaluate(() => { window.__tacticalTest.game.yaw = 0; });
    await expect(page.locator('.damage-direction')).toHaveAttribute('data-direction', 'front');
    await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/incoming-damage.png' });
    await expect(page.locator('.damage-direction')).toHaveCount(0); await expect(page.locator('#damage-direction-caption')).toBeHidden();
    expect(errors).toEqual([]);
  } finally { await disposeComponent(page); }
});
