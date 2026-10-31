import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

for (const mapId of ['overgrowth', 'nightmarket']) test(`${mapId} renders its own batched landmarks, matches every solid collider and releases scene resources`, async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('/');
  try {
    const result = await page.evaluate(async (mapId) => {
      const [{ FPSGame }, { Room }] = await Promise.all([import('/game.js'), import('/shared/simulation.js')]);
      const room = new Room('THEME', { mapId, bots: 0 }), player = room.addPlayer('viewer', 'VIEWER');
      document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
      const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), mapId, settings: { sensitivity: 1, fov: 82, volume: 0, quality: 'normal' }, audio: { step() {}, stopReload() {} }, send() {}, onMenu() {}, onFatal(message) { throw new Error(message); } });
      game.applySnapshot(room.snapshot(), player.id); await game.prepareGraphics(); cancelAnimationFrame(game.frameId); window.__themedGame = game;
      const themed = game.scene.getObjectByName(`themed-${mapId}`), objects = [], names = [], labels = [];
      themed.traverse((object) => { if (object.isInstancedMesh) { objects.push(object); names.push(object.name); } if (object.userData.text) labels.push(object.userData.text); });
      game.camera.position.set(mapId === 'overgrowth' ? 9 : 4, mapId === 'overgrowth' ? 11 : 7, mapId === 'overgrowth' ? 27 : 24); game.camera.lookAt(mapId === 'overgrowth' ? 0 : 11, mapId === 'overgrowth' ? 8 : 3, mapId === 'overgrowth' ? -9 : 10);
      game.weapon.visible = false; game.renderer.render(game.scene, game.camera);
      return { batches: objects.length, instances: objects.reduce((sum, object) => sum + object.count, 0), names, labels, conservatory: themed.userData.conservatory, market: themed.userData.market, colliders: themed.userData.colliderIds, expected: game.world.obstacles.filter((box) => !box.buildingId).map((box) => box.id), calls: game.renderer.info.render.calls, triangles: game.renderer.info.render.triangles, ready: game.graphicsReady };
    }, mapId);
    expect(result.ready).toBe(true); expect(result.colliders).toEqual(result.expected);
    expect(result.batches).toBeLessThan(25); expect(result.instances).toBeGreaterThan(200); expect(result.calls).toBeLessThan(150); expect(result.triangles).toBeLessThan(150000);
    if (mapId === 'overgrowth') { expect(result.names).toContain('themed-vault-box'); expect(result.names).toContain('themed-leaf-leaf'); expect(result.names).toContain('themed-vine-tube'); expect(result.names).toContain('themed-orchid-leaf'); expect(result.labels).toContain('THE FIRST TREE'); expect(result.labels).toContain('CANOPY WALK'); expect(result.conservatory.pavilions).toBe(3); expect(result.conservatory.brokenPanes).toBeGreaterThan(0); expect(result.conservatory.hangingVines).toBeGreaterThan(10); }
    else { expect(result.names).toContain('themed-red-box'); expect(result.names).toContain('themed-teal-box'); expect(result.names).toContain('themed-ginkgo-leaf'); expect(result.labels).toContain('밤빛시장'); expect(result.labels).toContain('떡볶이'); expect(result.market.doglegStreet && result.market.ginkgoCourtyard).toBe(true); }
    await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: `artifacts/arena-${mapId}.png` });
    const released = await page.evaluate(() => {
      const game = window.__themedGame, geometries = new Set(), materials = new Set(), textures = new Set(), disposed = new Set();
      game.scene.traverse((object) => { if (object.geometry) geometries.add(object.geometry); if (object.material) for (const surface of Array.isArray(object.material) ? object.material : [object.material]) { materials.add(surface); for (const value of Object.values(surface)) if (value?.isTexture) textures.add(value); } });
      for (const value of [...geometries, ...materials, ...textures]) value.addEventListener('dispose', () => disposed.add(value));
      game.dispose(); delete window.__themedGame;
      return [...geometries, ...materials, ...textures].every((value) => disposed.has(value));
    });
    expect(released).toBe(true); expect(errors).toEqual([]);
  } finally { await page.evaluate(() => { window.__themedGame?.dispose(); delete window.__themedGame; }); }
});
