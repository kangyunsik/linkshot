import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('physical front sight tips, rear openings and optic centers share the ADS aim axis for every firearm', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const checks = await page.evaluate(async () => {
    const [THREE, { WeaponModels, disposeModel }, { WEAPONS }] = await Promise.all([import('/vendor/three.module.js'), import('/weapon-model.js'), import('/shared/catalog.js')]);
    const models = new WeaponModels(), checks = [];
    for (const weapon of WEAPONS) {
      const model = models.create(weapon.id, 'standard'), body = model.userData.firearmBody, features = body.userData.features, height = model.userData.aimHeight;
      const find = (name) => features.find((part) => part.name === name), center = (part) => part.min.map((value, i) => (value + part.max[i]) / 2), landmarks = [];
      const front = find('front-sight-post') || find('front-pistol-sight');
      if (front) {
        const tip = center(front); tip[1] = front.max[1]; landmarks.push({ name: 'front-tip', point: tip, parent: front.parent });
        const ears = features.filter((part) => part.name === (find('rear-sight-notch') ? 'rear-sight-ear' : 'rear-pistol-sight'));
        const bottom = find('rear-sight-notch')?.max[1] ?? find('contoured-pistol-slide').max[1], top = Math.min(...ears.map((part) => part.max[1]));
        const rear = center(ears[0]); rear[0] = 0; rear[1] = (bottom + top) / 2; landmarks.push({ name: 'rear-opening-center', point: rear, parent: ears[0].parent });
        const hood = find('front-sight-hood'); if (hood) landmarks.push({ name: 'front-hood-center', point: center(hood), parent: hood.parent });
      } else {
        const optic = find('open-reflex-sight') || find('compact-marksman-optic') || find('scope-main-tube'); landmarks.push({ name: 'optic-center', point: center(optic), parent: optic.parent });
      }
      model.position.set(0, -height, -.35);
      for (const hand of [1, -1]) for (const fov of [65, 82, 105]) {
        model.scale.x = hand; model.updateMatrixWorld(true); const camera = new THREE.PerspectiveCamera(fov * weapon.zoom, 1440 / 1000, .04, 20); camera.updateMatrixWorld(true);
        for (const landmark of landmarks) {
          const point = model.getObjectByName(`firearm-${landmark.parent}`).localToWorld(new THREE.Vector3(...landmark.point)).project(camera);
          checks.push({ id: weapon.id, landmark: landmark.name, hand, fov, errorPixels: Math.hypot(point.x * 720, point.y * 500) });
        }
      }
      model.position.set(0, 0, 0); model.scale.x = 1; model.updateMatrixWorld(true);
      const meshes = []; body.traverse((part) => { if (part.isMesh && part.name !== 'sight-reference' && !part.material.transparent) { part.material.side = THREE.DoubleSide; meshes.push(part); } });
      const origin = new THREE.Vector3(0, height, .35), end = front ? model.getObjectByName(`firearm-${front.parent}`).localToWorld(new THREE.Vector3(0, 0, front.max[2])).z + .01 : -.02;
      checks.push({ id: weapon.id, landmark: 'clear-eye-to-front-sight', clear: new THREE.Raycaster(origin, new THREE.Vector3(0, 0, -1), 0, .35 - end).intersectObjects(meshes, false).length === 0 });
      disposeModel(model);
    }
    models.dispose(); return checks;
  });
  for (const check of checks) {
    if (check.clear !== undefined) expect(check.clear, JSON.stringify(check)).toBe(true);
    else expect(check.errorPixels, JSON.stringify(check)).toBeLessThan(.1);
  }
});

test('the live hip pose moves down and outward, reducing central occlusion without hiding any firearm', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  try {
    const result = await page.evaluate(async () => {
      const [THREE, { FPSGame }, { Room }, { WEAPONS }] = await Promise.all([import('/vendor/three.module.js'), import('/game.js'), import('/shared/simulation.js'), import('/shared/catalog.js')]);
      const room = new Room('CLEARVIEW', { bots: 0 }), player = room.addPlayer('viewer', 'VIEWER'); Object.assign(player, { x: 24, y: 0, z: 10, yaw: 0, pitch: 0 });
      document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
      const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), mapId: 'foundry', settings: { fov: 82, sensitivity: 1, quality: 'low' }, audio: { step() {}, stopReload() {} }, send() {}, onMenu() {}, onFatal(message) { throw new Error(message); } });
      window.__clearViewGame = game; game.applySnapshot(room.snapshot(), player.id); await game.prepareGraphics(); cancelAnimationFrame(game.frameId);
      game.switchAnimation = 0; game.weapon.position.set(.18, -.20, -.54); let now = performance.now();
      // This fixture has no pointer lock, so it deliberately runs at the
      // menu's 30 Hz cap rather than submitting only skipped 60 Hz frames.
      for (let frame = 0; frame < 36; frame++) { now += 1000 / 30; game.previousFrame = now - 1000 / 30; game.animate(now); cancelAnimationFrame(game.frameId); }
      const hip = game.weapon.position.clone(), target = new THREE.WebGLRenderTarget(320, 240), checks = [];
      const pixels = () => { game.renderer.setRenderTarget(target); game.renderFrame(); const data = new Uint8Array(320 * 240 * 4); game.renderer.readRenderTargetPixels(target, 0, 0, 320, 240, data); return data; };
      const coverage = (image, background) => { let visible = 0, center = 0; for (let y = 0; y < 240; y++) for (let x = 0; x < 320; x++) { const i = (y * 320 + x) * 4; if (Math.abs(image[i] - background[i]) + Math.abs(image[i + 1] - background[i + 1]) + Math.abs(image[i + 2] - background[i + 2]) <= 12) continue; visible++; if (x >= 80 && x < 240 && y >= 60 && y < 156) center++; } return { visible, center }; };
      game.weapon.visible = false; const background = pixels(); game.weapon.visible = true;
      for (const weapon of WEAPONS) {
        game.activateWeapon(weapon.id); game.weapon.rotation.set(0, 0, 0); game.weapon.position.set(.18, -.20, -.54); const before = coverage(pixels(), background);
        game.weapon.position.copy(hip); const after = coverage(pixels(), background); checks.push({ id: weapon.id, before, after });
      }
      game.renderer.setRenderTarget(null); target.dispose(); game.local.weaponId = game.requestedWeaponId = 'ak47'; game.activateWeapon('ak47'); game.weapon.position.copy(hip); game.updateHud(); game.renderFrame();
      return { hip: hip.toArray(), checks, totalBefore: checks.reduce((sum, value) => sum + value.before.center, 0), totalAfter: checks.reduce((sum, value) => sum + value.after.center, 0) };
    });
    expect(result.hip[0]).toBeCloseTo(.26, 5); expect(result.hip[1]).toBeCloseTo(-.28, 5); expect(result.hip[2]).toBeCloseTo(-.54, 5);
    for (const check of result.checks) expect(check.after.visible, JSON.stringify(check)).toBeGreaterThan(200);
    expect(result.totalAfter, JSON.stringify(result)).toBeLessThan(result.totalBefore * .75); expect(errors).toEqual([]);
    await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/ak47-hip-clearance.png' });
    await page.evaluate(async () => {
      const { getWeapon } = await import('/shared/catalog.js'), { VIEWMODEL_ADS_Z } = await import('/viewmodel-renderer.js'), game = window.__clearViewGame;
      game.weapon.position.set(0, -game.activeModel.userData.aimHeight, VIEWMODEL_ADS_Z); game.camera.fov = 82 * getWeapon('ak47').zoom; game.camera.updateProjectionMatrix(); game.activeModel.userData.reticle.visible = false; document.getElementById('crosshair').style.opacity = '0'; document.getElementById('ads-reticle').hidden = false; game.renderFrame();
    });
    await page.screenshot({ path: 'artifacts/ak47-ads-centered.png' });
  } finally { await page.evaluate(async () => { await window.__clearViewGame?.dispose(); delete window.__clearViewGame; }); }
});
