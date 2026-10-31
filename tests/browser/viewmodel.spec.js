import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('anatomical first-person hands keep correct depth, remain visible near walls and follow the shotgun pump', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  try {
    const result = await page.evaluate(async () => {
      const [THREE, { FPSGame }, { Room }] = await Promise.all([import('/vendor/three.module.js'), import('/game.js'), import('/shared/simulation.js')]);
      const room = new Room('HANDS', { bots: 0 }), player = room.addPlayer('viewer', 'VIEWER', false, { weaponId: 'shotgun' });
      Object.assign(player, { x: 24, y: 0, z: 10, yaw: 0, pitch: 0 }); document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
      const manager = THREE.DefaultLoadingManager, oldStart = manager.onStart, oldLoad = manager.onLoad; let loading = false;
      const loaded = new Promise((resolve) => { manager.onLoad = resolve; }); manager.onStart = () => { loading = true; };
      const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), mapId: 'foundry', weaponId: 'shotgun', settings: { sensitivity: 1, fov: 82, volume: 0, quality: 'low' }, audio: { step() {} }, send() {}, onMenu() {}, onFatal(message) { throw new Error(message); } });
      window.__handGame = game; game.applySnapshot(room.snapshot(), player.id); if (loading) await loaded; manager.onStart = oldStart; manager.onLoad = oldLoad;
      await game.prepareGraphics(); cancelAnimationFrame(game.frameId); game.switchAnimation = 0; game.lastFire = -10000; game.previousFrame = performance.now() - 16;
      game.animate(performance.now()); cancelAnimationFrame(game.frameId);
      const target = new THREE.WebGLRenderTarget(320, 240), pixels = () => { const data = new Uint8Array(320 * 240 * 4); game.renderFrame(); game.renderer.readRenderTargetPixels(target, 0, 0, 320, 240, data); return data; };
      game.renderer.setRenderTarget(target); game.weapon.visible = false; const world = pixels(); game.weapon.visible = true; const hands = pixels();
      const blocker = new THREE.Mesh(new THREE.BoxGeometry(4, 4, .02), new THREE.MeshBasicMaterial({ color: '#ff00ee' })); blocker.position.z = -.1; game.camera.add(blocker);
      game.weapon.visible = false; const wall = pixels(); game.weapon.visible = true; const nearWall = pixels();
      let changed = 0, preserved = 0, worldChangedAbove = 0;
      for (let i = 0; i < hands.length; i += 4) {
        const differs = Math.abs(hands[i] - world[i]) + Math.abs(hands[i + 1] - world[i + 1]) + Math.abs(hands[i + 2] - world[i + 2]) > 12;
        if (differs) { changed++; if (Math.abs(nearWall[i] - hands[i]) + Math.abs(nearWall[i + 1] - hands[i + 1]) + Math.abs(nearWall[i + 2] - hands[i + 2]) < 8) preserved++; }
        if (i / 4 / 320 > 180 && differs) worldChangedAbove++;
      }
      game.camera.remove(blocker); blocker.geometry.dispose(); blocker.material.dispose(); game.renderer.setRenderTarget(null); target.dispose();
      const { pump, supportArm } = game.activeModel.userData, left = game.activeModel.getObjectByName('left-hand');
      game.scene.updateMatrixWorld(true); const before = left.getWorldPosition(new THREE.Vector3()).sub(pump.getWorldPosition(new THREE.Vector3()));
      const now = performance.now(); game.lastFire = now - 300; game.previousFrame = now - 16; game.animate(now); cancelAnimationFrame(game.frameId); game.scene.updateMatrixWorld(true);
      const after = left.getWorldPosition(new THREE.Vector3()).sub(pump.getWorldPosition(new THREE.Vector3())); game.renderFrame();
      const lights = []; game.scene.traverse((object) => { if (object.isLight) lights.push(object); });
      return { changed, preserved: preserved / Math.max(1, changed), worldChangedAbove, pumpOffset: supportArm.position.z, gripError: before.distanceTo(after), lightsShared: lights.every((light) => (light.layers.mask & 3) === 3), restored: game.camera.layers.mask === 1 && game.scene.background !== null && game.renderer.autoClear && game.renderer.info.autoReset, wallVisible: wall.some((value, i) => i % 4 === 0 && value > 150) };
    });
    expect(result.changed).toBeGreaterThan(1500); expect(result.preserved).toBeGreaterThan(.98); expect(result.worldChangedAbove).toBe(0); expect(result.wallVisible && result.restored && result.lightsShared).toBe(true);
    expect(result.pumpOffset).toBeCloseTo(.1, 5); expect(result.gripError).toBeLessThan(1e-6);
    await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/first-person-hands-shotgun.png' }); expect(errors).toEqual([]);
  } finally { await page.evaluate(() => { window.__handGame?.dispose(); delete window.__handGame; }); }
});

test('peers leaving or a local exit during shader preparation cannot dispose in-flight shader materials', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const result = await page.evaluate(async () => {
    const [{ FPSGame }, { Room }] = await Promise.all([import('/game.js'), import('/shared/simulation.js')]);
    const room = new Room('WAIT2', { bots: 0 }), player = room.addPlayer('viewer', 'VIEWER'); room.addPlayer('peer', 'PEER');
    document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
    const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), mapId: 'foundry', settings: { sensitivity: 1, fov: 82, volume: 0, quality: 'low' }, audio: { step() {} }, send() {}, onMenu() {}, onFatal(message) { throw new Error(message); } });
    game.applySnapshot(room.snapshot(), player.id); cancelAnimationFrame(game.frameId);
    const avatar = game.remote.get('peer'), surfaces = new Set(); avatar.group.traverse((object) => { if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) surfaces.add(material); });
    let materialDisposals = 0, rendererDisposals = 0, release; const barrier = new Promise((resolve) => { release = resolve; });
    for (const material of surfaces) material.addEventListener('dispose', () => materialDisposals++);
    const compile = game.renderer.compileAsync.bind(game.renderer), dispose = game.renderer.dispose.bind(game.renderer);
    game.renderer.compileAsync = async (...args) => { const result = compile(...args); await barrier; return result; };
    game.renderer.dispose = () => { rendererDisposals++; dispose(); };
    const preparing = game.prepareGraphics(); room.removePlayer('peer'); game.applySnapshot(room.snapshot());
    const beforeExit = materialDisposals; game.dispose(); const beforeRelease = rendererDisposals;
    release(); await preparing; await game.disposalPromise;
    return { beforeExit, beforeRelease, materialDisposals, rendererDisposals, released: game.graphicsReleased, pending: game.retiredGraphics.length, expected: surfaces.size };
  });
  expect(result.beforeExit).toBe(0); expect(result.beforeRelease).toBe(0); expect(result.materialDisposals).toBe(result.expected); expect(result.rendererDisposals).toBe(1); expect(result.pending).toBe(0); expect(result.released).toBe(true); expect(errors).toEqual([]);
});
