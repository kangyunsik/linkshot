import { test, expect } from '@playwright/test';

test('SR-1, AWP and M82 leave more of the central arena visible while retaining mirrored left-hand placement', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const checks = await page.evaluate(async () => {
    const [THREE, { FPSGame }, { Room }, { getWeapon }, { VIEWMODEL_HIP_OFFSET, viewmodelHipOffset }] = await Promise.all([import('/vendor/three.module.js'), import('/game.js'), import('/shared/simulation.js'), import('/shared/catalog.js'), import('/viewmodel-renderer.js')]);
    const room = new Room('SCOPE', { bots: 0 }), player = room.addPlayer('viewer', 'VIEWER');
    document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
    const settings = { fov: 82, sensitivity: 1, quality: 'low', weaponHand: 'right' };
    const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), settings, mapId: 'foundry', audio: { step() {}, stopReload() {} }, send() {}, onMenu() {}, onFatal() {} });
    let target;
    try {
      game.applySnapshot(room.snapshot(), player.id); await game.prepareGraphics(); cancelAnimationFrame(game.frameId);
      game.camera.position.set(0, 1.62, 0); game.camera.rotation.set(0, 0, 0);
      target = new THREE.WebGLRenderTarget(320, 240); game.renderer.setRenderTarget(target);
      const pixels = () => { game.renderer.setRenderTarget(target); game.renderFrame(); const data = new Uint8Array(320 * 240 * 4); game.renderer.readRenderTargetPixels(target, 0, 0, 320, 240, data); return data; };
      game.weapon.visible = false; const world = pixels(), checks = [];
      const centralCoverage = (image) => { let covered = 0; for (let y = 75; y < 165; y++) for (let x = 95; x < 225; x++) { const i = (y * 320 + x) * 4; if (Math.abs(image[i] - world[i]) + Math.abs(image[i + 1] - world[i + 1]) + Math.abs(image[i + 2] - world[i + 2]) > 12) covered++; } return covered; };
      for (const id of ['sniper', 'awp', 'm82']) {
        game.activateWeapon(id); game.weapon.visible = true; game.weapon.rotation.set(0, 0, 0);
        game.weapon.position.copy(VIEWMODEL_HIP_OFFSET); const before = centralCoverage(pixels());
        game.weapon.position.copy(viewmodelHipOffset(getWeapon(id))); const after = centralCoverage(pixels());
        game.scene.updateMatrixWorld(true); const right = game.activeModel.userData.muzzle.getWorldPosition(new THREE.Vector3()).applyMatrix4(game.camera.matrixWorldInverse);
        settings.weaponHand = 'left'; game.applySettings(); game.scene.updateMatrixWorld(true);
        const left = game.activeModel.userData.muzzle.getWorldPosition(new THREE.Vector3()).applyMatrix4(game.camera.matrixWorldInverse);
        checks.push({ id, before, after, mirrorError: new THREE.Vector3(-right.x, right.y, right.z).distanceTo(left) });
        settings.weaponHand = 'right'; game.applySettings();
      }
      return checks;
    } finally { game.renderer.setRenderTarget(null); target?.dispose(); await game.dispose(); }
  });
  for (const check of checks) { expect(check.after, JSON.stringify(check)).toBeLessThan(check.before); expect(check.mirrorError).toBeLessThan(1e-8); }
});
