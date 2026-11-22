import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('real operator rigs blend from combat stance to empty hands, bent knees, and a grounded backward fall', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 720 });
  await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const result = await page.evaluate(async () => {
    const [THREE, { CombatEffects }, { createOperator, poseOperator, lightOperator }, { WeaponModels, disposeModel }, { FALL_DURATION_MS }] = await Promise.all([
      import('/vendor/three.module.js'), import('/combat-effects.js'), import('/operator-model.js'), import('/weapon-model.js'), import('/operator-fall.js'),
    ]);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;background:#18292d;z-index:9999;color:white;font:13px monospace'; document.body.append(host);
    const heading = document.createElement('h2'); heading.textContent = 'LINKSHOT  /  OPERATOR FALL'; heading.style.cssText = 'font-size:17px;letter-spacing:2px;margin:20px 28px'; host.append(heading);
    const canvas = document.createElement('canvas'); host.append(canvas);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#243941'); lightOperator(scene);
    const camera = new THREE.PerspectiveCamera(35, 1.11, .02, 30);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); renderer.setSize(1440, 540); renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const models = new WeaponModels(), plate = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: '#5e6661', roughness: 1 }));
    const key = scene.children.find(object => object.isDirectionalLight);
    renderer.shadowMap.enabled = true; key.castShadow = true; key.shadow.mapSize.set(1024,1024);
    key.shadow.normalBias = .007;
    plate.rotation.x = -Math.PI / 2; plate.receiveShadow = true; scene.add(plate);
    const grid = new THREE.GridHelper(16, 32, '#667571', '#667571'); grid.position.y = .001; scene.add(grid);
    const modelsToCheck = ['nari', 'jin'], modelChecks = [];
    const modelAt = (id, age, crouch) => {
      const live = createOperator({ characterId: id, outfitId: 'field' }, models);
      poseOperator(live, crouch, .11);
      live.group.position.set(.25, 0, -.11); live.group.rotation.y = 0; live.group.updateWorldMatrix(true, true);
      const liveHands = ['hand_l','hand_r'].map(key => live.bones[key].getWorldPosition(new THREE.Vector3()));
      const combat = new CombatEffects(scene, models, { width: 20, depth: 20, obstacles: [] });
      combat.death({ characterId: id, outfitId: 'field', crouchAmount: crouch, x: 0, y: 0, z: 0, yaw: 0 }, live, { x: 0, z: -4 });
      const corpse = combat.corpses[0];
      const measure = (key) => corpse.operator.bones[key].getWorldPosition(new THREE.Vector3());
      const handMatch = liveHands.every((position, i) => measure(i ? 'hand_r' : 'hand_l').distanceTo(position) < 1e-6);
      const separation = age => { combat.update(corpse.born + age, .016); return measure('hand_l').distanceTo(measure('hand_r')); };
      const handsStart = separation(0), handsMid = separation(410);
      const footPlanted = Math.min(measure('foot_l').y, measure('foot_r').y) < .15;
      const handsRest = separation(FALL_DURATION_MS);
      const bodyBack = measure('Head').z - measure('pelvis').z, headHeight = measure('Head').y, hipHeight = measure('pelvis').y;
      const stopped = corpse.pivot.matrixWorld.clone();
      combat.update(corpse.born + FALL_DURATION_MS + 300, .016);
      const settled = corpse.settled && corpse.pivot.matrixWorld.equals(stopped);
      const kneeAngle = ['l','r'].map(side => measure(`thigh_${side}`).sub(measure(`calf_${side}`)).angleTo(measure(`foot_${side}`).sub(measure(`calf_${side}`))));
      const valid = { id, handMatch, handsStart, handsMid, handsRest, footPlanted, bodyBack, headHeight, hipHeight, kneeAngle, settled, weaponFree: !corpse.operator.weapon };
      disposeModel(live.group);
      if (age != null) { corpse.settled = false; combat.updateCorpse(corpse, age); }
      return { combat, valid };
    };
    for (const id of modelsToCheck) { const { combat, valid } = modelAt(id, null, id === 'jin' ? .65 : 0); modelChecks.push(valid); combat.dispose(); }
    renderer.setScissorTest(true);
    for (const [i, [age, title]] of [[90, '01  /  IMPACT'], [410, '02  /  RELEASE'], [720, '03  /  FALL'], [1120, '04  /  REST']].entries()) {
      const { combat } = modelAt('nari', age, 0);
      // Keep only this corpse in the frame; the gameplay mesh and pose are
      // otherwise identical to the normal combat effect.
      camera.aspect = 360 / 540; camera.position.set(3.5, 1.9, -2.35); camera.lookAt(0, .86, .44); camera.updateProjectionMatrix();
      renderer.setViewport(i * 360, 0, 360, 540); renderer.setScissor(i * 360, 0, 360, 540); renderer.render(scene, camera);
      const label = document.createElement('span'); label.textContent = title; label.style.cssText = `position:absolute;top:624px;left:${i * 360}px;width:360px;text-align:center;color:#c4dcd8;`; host.append(label);
      combat.dispose();
    }
    plate.geometry.dispose(); plate.material.dispose(); grid.geometry.dispose(); grid.material.dispose(); models.dispose();
    window.__disposeFallReview = () => { renderer.dispose(); host.remove(); }; return modelChecks;
  });
  for (const row of result) {
    expect(row.handMatch && row.settled && row.weaponFree && row.footPlanted, JSON.stringify(row)).toBe(true);
    expect(row.handsMid).toBeGreaterThan(row.handsStart + .27); expect(row.handsRest).toBeGreaterThan(.63);
    expect(row.bodyBack).toBeGreaterThan(.48); expect(row.headHeight).toBeLessThan(.36); expect(row.headHeight).toBeGreaterThan(.065);
    expect(row.hipHeight).toBeLessThan(.36); expect(Math.abs(row.kneeAngle[0] - row.kneeAngle[1])).toBeGreaterThan(.15);
  }
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/operator-fall.png' });
  await page.evaluate(() => window.__disposeFallReview());
  expect(errors).toEqual([]);
});
