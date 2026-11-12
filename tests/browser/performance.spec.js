import { test, expect } from '@playwright/test';

test.use({ deviceScaleFactor: 2 });

async function fixture(page) {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  await page.evaluate(async () => {
    const [{ FPSGame }, { Room }] = await Promise.all([import('/game.js'), import('/shared/simulation.js')]);
    const room = new Room('PERF', { bots: 0 }), player = room.addPlayer('viewer', 'VIEWER'); room.addPlayer('other', 'OTHER'); room.events.length = 0;
    const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), settings: { sensitivity: 1, fov: 82, quality: 'low' }, audio: { step() {}, stopReload() {} }, send() {}, onMenu() {}, onFatal(message) { throw new Error(message); } });
    game.applySnapshot(room.snapshot(), player.id); await game.prepareGraphics(); cancelAnimationFrame(game.frameId); window.__performance = { game, room, player };
  });
}

test('balanced quality survives saved settings and browser reloads', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  await page.locator('[data-open="settings-dialog"]').first().click(); await page.locator('#quality').selectOption('balanced');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sector07-settings')).quality)).toBe('balanced');
  await page.reload(); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  await page.locator('[data-open="settings-dialog"]').first().click(); await expect(page.locator('#quality')).toHaveValue('balanced');
});

test('quality switches resize and release shadow maps without changing the camera or weapon', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const { game } = window.__performance, checks = []; let releases = 0;
    for (const quality of ['normal', 'balanced', 'low', 'normal']) {
      const previous = game.sun.shadow.map; if (previous) previous.addEventListener('dispose', () => releases++);
      const before = releases; game.settings.quality = quality; game.applySettings(); game.renderFrame();
      checks.push({ quality, ratio: game.renderer.getPixelRatio(), shadows: game.renderer.shadowMap.enabled, shadowSize: game.sun.shadow.map?.width, lamps: game.lamps.every((lamp) => lamp.visible), released: releases > before, fov: game.camera.fov, weapon: game.activeWeaponId });
    }
    await game.dispose(); delete window.__performance; return { checks, releases };
  });
  expect(result.checks.map((check) => check.ratio)).toEqual([1.65, 1, .75, 1.65]);
  expect(result.checks[0].shadowSize).toBe(2048); expect(result.checks[1].shadowSize).toBe(1024); expect(result.checks[1].released).toBe(true);
  expect(result.checks[2].shadows).toBe(false); expect(result.checks[2].lamps).toBe(false); expect(result.checks[3].shadowSize).toBe(2048);
  expect(result.checks.every((check) => check.fov === 82 && check.weapon === 'rifle')).toBe(true); expect(result.releases).toBeGreaterThanOrEqual(2);
});

test('menu FPS counts actual renders and dead avatars do not run visual IK', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const { FrameStats } = await import('/performance.js'), { game } = window.__performance;
    const avatar = game.remote.get('other'); avatar.target.hp = 0; avatar.targetTime += 2000; const beforeTime = avatar.renderTime; let poses = 0;
    const update = avatar.poseSchedule.update.bind(avatar.poseSchedule); avatar.poseSchedule.update = (...args) => { poses++; return update(...args); };
    game.renderFrame = () => {}; game.frameStats = new FrameStats(); const start = performance.now(); game.lastRender = game.previousFrame = game.fpsTime = start;
    for (let i = 1; i <= 121; i++) { game.animate(start + i * 1000 / 60); cancelAnimationFrame(game.frameId); }
    const result = { poses, frames: game.frameStats.count, fps: game.performanceStats.fps, title: game.hud['hud-fps'].title, deadHidden: !avatar.group.visible, timeAdvanced: avatar.renderTime > beforeTime + 1900 };
    await game.dispose(); delete window.__performance; return result;
  });
  expect(result.poses).toBe(0); expect(result.frames).toBeGreaterThan(10); expect(result.frames).toBeLessThan(21);
  expect(result.fps).toBeGreaterThanOrEqual(8); expect(result.fps).toBeLessThanOrEqual(10); expect(result.title).toContain('CPU p95'); expect(result.deadHidden && result.timeAdvanced).toBe(true);
});

test('corpse warmup and retirement reuse models, restore opacity and release bounded pools', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const { game, player } = window.__performance, combat = game.combat;
    const warmed = combat.corpsePool[0]; combat.death(player); const first = combat.corpses[0], prewarmed = first === warmed;
    combat.update(first.born + 9000, .016); const faded = first.materials.some(({ material, opacity }) => material.opacity < opacity);
    combat.update(first.born + 10001, .016); combat.death(player); const second = combat.corpses[0];
    const reused = second === first, restored = second.materials.every(({ material, opacity }) => material.opacity === opacity), reset = !second.settled && second.pivot.rotation.x === 0;
    const [{ SKINS }, { OUTFITS }] = await Promise.all([import('/shared/catalog.js'), import('/shared/outfits.js')]);
    for (let i = 0; i < 24; i++) { combat.death({ ...player, skinId: SKINS[i % SKINS.length].id, outfitId: OUTFITS[Math.floor(i / SKINS.length)].id }); combat.update(performance.now() + 11000, .016); }
    const pooled = combat.corpsePool.length;
    for (let i = 0; i < 12; i++) combat.death(player);
    const active = combat.corpses.length, resources = new Set(), disposed = new Set();
    const collect = (root) => root.traverse((object) => { if (object.isInstancedMesh) resources.add(object); if (object.geometry) resources.add(object.geometry); for (const material of object.material ? Array.isArray(object.material) ? object.material : [object.material] : []) { resources.add(material); for (const value of Object.values(material)) if (value?.isTexture) resources.add(value); } });
    collect(game.scene); collect(combat.warmup); for (const corpse of combat.corpsePool) collect(corpse.pivot);
    for (const resource of resources) resource.addEventListener('dispose', () => disposed.add(resource));
    await game.dispose(); delete window.__performance;
    return { prewarmed, faded, reused, restored, reset, pooled, active, poolAfterDispose: combat.corpsePool.length, released: [...resources].every((resource) => disposed.has(resource)) };
  });
  expect(result.prewarmed && result.faded && result.reused && result.restored && result.reset && result.released).toBe(true);
  expect(result.pooled).toBeLessThanOrEqual(8); expect(result.active).toBe(8); expect(result.poolAfterDispose).toBe(0);
});

test('impact refinement only raycasts nearby instances and preserves transformed surface alignment', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const result = await page.evaluate(async () => {
    const [THREE, { BulletMarks }] = await Promise.all([import('/vendor/three.module.js'), import('/bullet-marks.js')]);
    const scene = new THREE.Scene(), geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.MeshBasicMaterial(), batch = new THREE.InstancedMesh(geometry, material, 2000), matrix = new THREE.Matrix4();
    for (let i = 0; i < batch.count; i++) batch.setMatrixAt(i, matrix.makeTranslation(i * 3, 0, 0));
    batch.position.set(2, 1, -4); batch.rotation.y = .4; batch.scale.set(1.5, 1, .8); scene.add(batch); scene.updateMatrixWorld(true);
    const expected = new THREE.Vector3(0, 0, .5).applyMatrix4(batch.matrixWorld), normal = new THREE.Vector3(0, 0, 1).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(batch.matrixWorld)), origin = expected.clone().addScaledVector(normal, 1);
    const marks = new BulletMarks(scene, [batch]); let casts = 0; const raycast = THREE.Mesh.prototype.raycast;
    THREE.Mesh.prototype.raycast = function (...args) { casts++; return raycast.apply(this, args); };
    let refined;
    try { refined = marks.refine({ point: expected, normal }, origin); } finally { THREE.Mesh.prototype.raycast = raycast; }
    const result = { casts, error: refined.point.distanceTo(expected), normal: refined.normal.dot(normal), indexed: marks.worldMeshes.length };
    marks.add({ id: 'partial', surfaceId: 'test', kind: 'wall', point: expected, normal, bounds: { minX: -10, maxX: 10, minY: 0, maxY: 2, minZ: -10, maxZ: 10 } }, origin);
    result.matrixRange = marks.mesh.instanceMatrix.updateRanges.at(-1); result.birthRange = marks.geometry.getAttribute('markBorn').updateRanges.at(-1);
    marks.dispose(); result.cleared = marks.impactIndex.cells.size === 0 && marks.worldMeshes.length === 0;
    geometry.dispose(); material.dispose(); batch.dispose(); return result;
  });
  expect(result.casts).toBeLessThanOrEqual(2); expect(result.indexed).toBe(2000); expect(result.error).toBeLessThan(1e-6); expect(result.normal).toBeGreaterThan(.999999);
  expect(result.matrixRange).toEqual({ start: 0, count: 16 }); expect(result.birthRange).toEqual({ start: 0, count: 1 }); expect(result.cleared).toBe(true);
});

test('static scenery batching reduces draw calls while retaining transforms, shadows and rendered silhouettes', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const result = await page.evaluate(async () => {
    const [THREE, { batchStaticBoxes }] = await Promise.all([import('/vendor/three.module.js'), import('/static-scenery.js')]);
    const renderer = new THREE.WebGLRenderer({ antialias: false }); renderer.setSize(320, 240);
    const target = new THREE.WebGLRenderTarget(320, 240), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, 4 / 3, .1, 100);
    scene.background = new THREE.Color('#17242d'); scene.position.set(1, 0, 2); scene.add(new THREE.HemisphereLight('#ffffff', '#344554', 2));
    const geometry = new THREE.BoxGeometry(1, 1, 1), materials = [new THREE.MeshStandardMaterial({ color: '#cc8855' }), new THREE.MeshStandardMaterial({ color: '#5599aa' })];
    const parent = new THREE.Group(); parent.rotation.y = .2; parent.scale.set(.8, 1.2, 1); scene.add(parent); const originals = [];
    for (let i = 0; i < 400; i++) {
      const mesh = new THREE.Mesh(geometry, materials[i % 2]); mesh.position.set((i % 20 - 9.5) * 1.5, .5, (Math.floor(i / 20) - 9.5) * 1.5); mesh.castShadow = i % 3 === 0; mesh.receiveShadow = true; parent.add(mesh); originals.push(mesh);
    }
    const hidden = new THREE.Group(), hiddenBox = new THREE.Mesh(geometry, materials[0]); hidden.visible = false; hidden.add(hiddenBox); scene.add(hidden);
    scene.updateMatrixWorld(true); const beforeMatrices = originals.map((mesh) => mesh.matrixWorld.clone());
    camera.position.set(20, 22, 30); camera.lookAt(1, 0, 2); renderer.setRenderTarget(target);
    const pixels = () => { renderer.render(scene, camera); const result = new Uint8Array(320 * 240 * 4); renderer.readRenderTargetPixels(target, 0, 0, 320, 240, result); return result; };
    const before = pixels(), beforeCalls = renderer.info.render.calls, stats = batchStaticBoxes(scene, geometry), after = pixels(), afterCalls = renderer.info.render.calls;
    let changed = 0, checked = 0, maxError = 0, flags = true; const matrix = new THREE.Matrix4();
    scene.traverse((object) => { if (object.name === 'static-scenery') for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrix); matrix.premultiply(object.matrixWorld);
      const index = beforeMatrices.findIndex((original) => Math.hypot(original.elements[12] - matrix.elements[12], original.elements[13] - matrix.elements[13], original.elements[14] - matrix.elements[14]) < 1e-4);
      if (index < 0) { flags = false; continue; }
      for (let j = 0; j < 16; j++) maxError = Math.max(maxError, Math.abs(matrix.elements[j] - beforeMatrices[index].elements[j]));
      flags &&= object.material === originals[index].material && object.castShadow === originals[index].castShadow && object.receiveShadow === originals[index].receiveShadow; checked++;
    } });
    for (let i = 0; i < before.length; i += 4) if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) > 12) changed++;
    scene.traverse((object) => { if (object.isInstancedMesh) object.dispose(); }); geometry.dispose(); materials.forEach((material) => material.dispose()); target.dispose(); renderer.dispose();
    return { beforeCalls, afterCalls, stats, maxError, flags, checked, retained: originals.filter((mesh) => mesh.parent !== null).length, changed, hiddenPreserved: hiddenBox.parent === hidden && !hidden.visible };
  });
  expect(result.stats.sources).toBe(400); expect(result.checked).toBe(result.stats.instances); expect(result.checked + result.retained).toBe(400); expect(result.afterCalls).toBeLessThan(result.beforeCalls / 4);
  expect(result.maxError).toBeLessThan(1e-5); expect(result.flags && result.hiddenPreserved).toBe(true); expect(result.changed).toBeLessThan(320 * 240 * .005);
});

test('scratch-based IK matches the original solver across character, grip, crouch and parent transforms', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const result = await page.evaluate(async () => {
    const [THREE, { createOperator, poseOperator }, { WeaponModels, disposeModel }] = await Promise.all([import('/vendor/three.module.js'), import('/operator-model.js'), import('/weapon-model.js')]);
    // Independent pre-optimization reference: verifies all bone matrices, not
    // just a bounding box, so faster IK cannot silently change aiming/grips.
    function reference(operator, crouch, stride) {
      const v = (array) => new THREE.Vector3(...array);
      const turn = (bone, rotation) => { const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(rotation); bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world)); bone.updateWorldMatrix(false, true); };
      const translate = (bone, delta) => { const target = bone.getWorldPosition(new THREE.Vector3()).add(delta); bone.position.copy(bone.parent.worldToLocal(target)); bone.updateWorldMatrix(false, true); };
      const point = (bone, child, target) => { const origin = bone.getWorldPosition(new THREE.Vector3()); turn(bone, new THREE.Quaternion().setFromUnitVectors(child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize(), target.clone().sub(origin).normalize())); };
      const two = (upper, lower, end, target, pole) => {
        const a = upper.getWorldPosition(new THREE.Vector3()), b = lower.getWorldPosition(new THREE.Vector3()), c = end.getWorldPosition(new THREE.Vector3());
        const first = a.distanceTo(b), second = b.distanceTo(c), direction = target.clone().sub(a), distance = Math.min(first + second - .0001, Math.max(.001, direction.length()));
        direction.normalize(); const along = (first ** 2 - second ** 2 + distance ** 2) / (2 * distance), bend = pole.clone().sub(a); bend.addScaledVector(direction, -bend.dot(direction)).normalize();
        point(upper, lower, a.clone().addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, first ** 2 - along ** 2)))); point(lower, end, target);
      };
      const { group, bones, weapon } = operator;
      for (const rest of operator.rest) { rest.bone.position.copy(rest.position); rest.bone.quaternion.copy(rest.quaternion); } group.updateMatrixWorld(true);
      const up = v([0, 1, 0]).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion())), axis = v([1, 0, 0]).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
      translate(bones.pelvis, up.clone().multiplyScalar(-crouch * .43)); turn(bones.spine_01, new THREE.Quaternion().setFromAxisAngle(axis, -.85 * crouch)); turn(bones.Head, new THREE.Quaternion().setFromAxisAngle(axis, .65 * crouch));
      const top = group.worldToLocal(bones.Head.getWorldPosition(new THREE.Vector3())).y + operator.headTop; translate(bones.pelvis, up.clone().multiplyScalar(-Math.max(0, top - (1.8 - crouch * .7)))); group.updateMatrixWorld(true);
      for (const [i, side] of ['l', 'r'].entries()) {
        const foot = operator.feet[i].clone(), swing = i ? -stride : stride; foot.z += swing * .45 * (1 - crouch * .6); foot.y += Math.max(0, swing) * .14;
        two(bones[`thigh_${side}`], bones[`calf_${side}`], bones[`foot_${side}`], group.localToWorld(foot), group.localToWorld(v([i ? .2 : -.2, .45, -.65])));
        bones[`foot_${side}`].quaternion.copy(bones[`foot_${side}`].parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(group.getWorldQuaternion(new THREE.Quaternion()).multiply(operator.footRotations[i]))); bones[`foot_${side}`].updateWorldMatrix(false, true);
      }
      weapon.position.set(.1, 1.19 - crouch * .52, -.16);
      for (const [side, grip] of [['r', [.055, -.13, .13]], ['l', weapon.userData.modelBase === 'knife' ? [-.2, -.12, -.08] : weapon.userData.modelBase === 'pistol' ? [-.04, -.13, .1] : [-.06, -.05, -.12]]]) {
        two(bones[`upperarm_${side}`], bones[`lowerarm_${side}`], bones[`hand_${side}`], group.localToWorld(v(grip).applyEuler(weapon.rotation).add(weapon.position)), group.localToWorld(v([side === 'l' ? -.4 : .4, .98 - crouch * .5, .08]))); turn(bones[`hand_${side}`], new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2));
      }
      group.updateMatrixWorld(true);
    }
    const models = new WeaponModels(); let error = 0, checks = 0;
    for (const characterId of ['male', 'female']) for (const weaponId of ['rifle', 'pistol', 'knife']) {
      const a = createOperator({ characterId, weaponId }, models), b = createOperator({ characterId, weaponId }, models), parent = new THREE.Group(); parent.rotation.y = -.3; parent.position.set(3, 2, -4); parent.add(a.group, b.group);
      for (const crouch of [0, .25, .75, 1]) {
        for (const operator of [a, b]) { operator.group.position.set(2, 1, -3); operator.group.rotation.y = .7; operator.weapon.rotation.x = crouch - .5; } parent.updateMatrixWorld(true);
        reference(a, crouch, .3); poseOperator(b, crouch, .3);
        for (const name of Object.keys(a.bones)) for (let i = 0; i < 16; i++) error = Math.max(error, Math.abs(a.bones[name].matrixWorld.elements[i] - b.bones[name].matrixWorld.elements[i]));
        checks++;
      }
      disposeModel(a.group); disposeModel(b.group);
    }
    models.dispose(); return { error, checks };
  });
  expect(result.checks).toBe(24); expect(result.error).toBeLessThan(1e-6);
});
