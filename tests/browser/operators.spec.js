import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('every outfit and weapon finish retains human anatomy, facial features and the same body dimensions', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  const result = await page.evaluate(async () => {
    const [THREE, { createOperator, poseOperator }, { WeaponModels, disposeModel }, { OUTFITS, CHARACTERS }, { SKINS, WEAPONS }] = await Promise.all([
      import('/vendor/three.module.js'), import('/operator-model.js'), import('/weapon-model.js'), import('/shared/outfits.js'), import('/shared/catalog.js'),
    ]);
    const models = new WeaponModels(), checks = [], firstPerson = [];
    for (const character of CHARACTERS) for (const outfit of OUTFITS) for (const skin of SKINS) {
      const operator = createOperator({ outfitId: outfit.id, skinId: skin.id, characterId: character.id }, models);
      const head = operator.bones.Head;
      let body; operator.group.traverse((child) => { if (child.isSkinnedMesh && child.name === character.bodyMesh) body = child; });
      operator.group.traverse((child) => { if (child.isSkinnedMesh) child.computeBoundingBox(); });
      const standing = new THREE.Box3().setFromObject(operator.group);
      poseOperator(operator, 1); operator.group.updateMatrixWorld(true);
      operator.group.traverse((child) => { if (child.isSkinnedMesh) child.computeBoundingBox(); });
      const crouched = new THREE.Box3().setFromObject(operator.group), facePosition = head.getWorldPosition(new THREE.Vector3());
      checks.push({ outfit: outfit.id, characterId: operator.group.userData.characterId, skin: skin.id, rig: operator.group.userData.rig, bones: Object.keys(operator.bones).length, skinned: !!body, materials: body.material.length, triangles: body.geometry.index.count / 3, standingTop: standing.max.y, crouchedTop: crouched.max.y, headTop: facePosition.y + operator.headTop, engineMaterials: operator.group.userData.engineMaterials });
      disposeModel(operator.group);
    }
    for (const character of CHARACTERS) for (const outfit of OUTFITS) for (const weapon of WEAPONS) {
      const model = models.create(weapon.id, 'standard', true, outfit.id, character.id), arms = model.getObjectByName('first-person-human-arms');
      const bounds = new THREE.Box3().setFromObject(model);
      firstPerson.push({ outfit: outfit.id, weapon: weapon.id, hands: arms.children.filter((child) => child.userData.fingers === 5).length, rounded: arms.getObjectByName('right-sleeve').geometry.type !== 'BoxGeometry', noDepth: arms.getObjectByName('palm').material.depthTest === false, finite: [...bounds.min.toArray(), ...bounds.max.toArray(), ...model.userData.muzzle.position.toArray()].every(Number.isFinite) });
      disposeModel(model);
    }
    models.dispose(); return { checks, firstPerson };
  });
  expect(result.checks).toHaveLength(60); expect(result.firstPerson).toHaveLength(200); expect(new Set(result.checks.map((check) => check.characterId)).size).toBe(2);
  for (const check of result.checks) {
    expect(check.rig).toBe('human-v3'); expect(check.skinned).toBe(true); expect(check.bones).toBeGreaterThan(50); expect(check.materials).toBe(3); expect(check.triangles).toBeGreaterThan(10000);
    expect(check.standingTop).toBeGreaterThan(1.77); expect(check.standingTop).toBeLessThanOrEqual(1.85);
    expect(check.headTop).toBeLessThanOrEqual(1.101); expect(check.engineMaterials).toContain('operator-fabric.png');
  }
  for (const check of result.firstPerson) { expect(check.hands).toBe(2); expect(check.rounded).toBe(true); expect(check.noDepth).toBe(true); expect(check.finite).toBe(true); }
  expect(errors).toEqual([]);
});

test('human operator collection renders visible faces and themed clothing', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 720 });
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  await page.evaluate(async () => {
    const [THREE, { createOperator, poseOperator }, { WeaponModels }, { OUTFITS }] = await Promise.all([import('/vendor/three.module.js'), import('/operator-model.js'), import('/weapon-model.js'), import('/shared/outfits.js')]);
    const host = document.createElement('div'); host.id = 'human-collection'; host.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#13212b;color:#c8d7d9;font:14px monospace';
    const title = document.createElement('h2'); title.textContent = 'LINKSHOT / HUMAN OPERATOR COLLECTION'; title.style.cssText = 'margin:24px 32px 0;font-size:18px;letter-spacing:3px'; host.append(title);
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 600; canvas.style.cssText = 'display:block;width:1600px;height:600px'; host.append(canvas); document.body.append(host);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#13212b');
    const camera = new THREE.PerspectiveCamera(25, 1600 / 600, 0.02, 30); camera.position.set(0, 1.45, -5.4); camera.lookAt(0, 0.95, 0);
    scene.add(new THREE.HemisphereLight('#d4e9ff', '#384540', 2.6));
    const key = new THREE.DirectionalLight('#ffe3c5', 3); key.position.set(-2, 4, -4); scene.add(key);
    const rim = new THREE.DirectionalLight('#8cdadf', 2); rim.position.set(3, 2, 2); scene.add(rim);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); renderer.setSize(1600, 600); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    const oldOnLoad = THREE.DefaultLoadingManager.onLoad;
    const ready = new Promise((resolve) => { THREE.DefaultLoadingManager.onLoad = resolve; });
    const models = new WeaponModels(), operators = [];
    for (const [i, outfit] of OUTFITS.entries()) {
      const operator = createOperator({ outfitId: outfit.id, skinId: 'standard' }, models); operator.group.position.x = (2 - i) * 1.25; operator.group.rotation.y = Math.atan2(operator.group.position.x, 5.4); scene.add(operator.group); operators.push(operator);
      const label = document.createElement('span'); label.textContent = outfit.name; label.style.cssText = `position:absolute;bottom:26px;left:${i * 20}%;width:20%;text-align:center;font-size:13px;letter-spacing:1px;color:#a3c7c9`; host.append(label);
    }
    // Allow material images to finish without waiting on arbitrary timeouts.
    await ready; THREE.DefaultLoadingManager.onLoad = oldOnLoad;
    renderer.render(scene, camera);
    window.__operatorCollection = { scene, camera, renderer, models, operators, poseOperator, host };
  });
  try {
    await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/human-operators.png' });
    await page.evaluate(() => { const { operators, poseOperator, renderer, scene, camera } = window.__operatorCollection; for (const operator of operators) poseOperator(operator, 1); renderer.render(scene, camera); });
    await page.screenshot({ path: 'artifacts/human-operators-crouched.png' });
    expect(await page.locator('#human-collection canvas').evaluate((canvas) => canvas.width)).toBe(1600);
    const portraits = await page.evaluate(async () => {
      const { OUTFITS } = await import('/shared/outfits.js'), { host } = window.__operatorCollection;
      const cards = document.createElement('div'); cards.style.cssText = 'position:absolute;inset:70px 0 55px;display:grid;grid-template-columns:repeat(5,1fr);gap:8px;background:#13212b;align-items:center';
      const images = OUTFITS.map((outfit) => { const image = new Image(); image.src = `/assets/${outfit.image}`; image.alt = outfit.name; image.style.cssText = 'width:100%;height:auto;display:block'; cards.append(image); return image; });
      host.append(cards); await Promise.all(images.map((image) => image.decode()));
      return images.map((image) => ({ width: image.naturalWidth, height: image.naturalHeight }));
    });
    for (const image of portraits) { expect(image.width).toBe(768); expect(image.height).toBe(1024); }
    await page.screenshot({ path: 'artifacts/human-outfit-portraits.png' });
  } finally {
    await page.evaluate(async () => { const { disposeModel } = await import('/weapon-model.js'); const fixture = window.__operatorCollection; fixture.operators.forEach((operator) => disposeModel(operator.group)); fixture.models.dispose(); fixture.renderer.dispose(); fixture.host.remove(); delete window.__operatorCollection; });
  }
});

test('both character models render all five outfits with distinct styled hair and fully clothed bodies', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 }); await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  const result = await page.evaluate(async () => {
    const [THREE, { createOperator }, { WeaponModels }, { OUTFITS, CHARACTERS }] = await Promise.all([import('/vendor/three.module.js'), import('/operator-model.js'), import('/weapon-model.js'), import('/shared/outfits.js')]);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#13212b;color:#d8e5eb;font:12px monospace'; document.body.append(host);
    const canvas = document.createElement('canvas'); host.append(canvas); const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); renderer.setSize(1600, 1000); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#13212b'); const camera = new THREE.OrthographicCamera(-3.52, 3.52, 2.2, -2.2, 0.02, 30); camera.position.set(0, 2.05, -6); camera.lookAt(0, 2.05, 0);
    scene.add(new THREE.HemisphereLight('#e1eeff', '#53605e', 2.6));
    for (const [color, intensity, x] of [['#ffe9da', 2.2, -3], ['#d5eaff', 1.25, 3]]) { const light = new THREE.DirectionalLight(color, intensity); light.position.set(x, 4, -4); scene.add(light); }
    const models = new WeaponModels(), operators = [], checks = [], oldOnLoad = THREE.DefaultLoadingManager.onLoad; const ready = new Promise((resolve) => { THREE.DefaultLoadingManager.onLoad = resolve; });
    for (const [row, character] of CHARACTERS.entries()) for (const [col, outfit] of OUTFITS.entries()) {
      const operator = createOperator({ characterId: character.id, outfitId: outfit.id }, models); operator.group.position.set((2 - col) * 1.25, (1 - row) * 2.1, 0); scene.add(operator.group); operators.push(operator);
      const body = operator.group.getObjectByName(character.bodyMesh); checks.push({ characterId: operator.group.userData.characterId, groups: body.geometry.groups.length, hair: !!operator.group.getObjectByName('styled-hair') });
      const label = document.createElement('span'); label.textContent = `${character.name} / ${outfit.name}`; label.style.cssText = `position:absolute;left:${col * 20}%;top:${row * 48 + 3}%;width:20%;text-align:center;color:#adc6d2`; host.append(label);
    }
    await ready; THREE.DefaultLoadingManager.onLoad = oldOnLoad; renderer.render(scene, camera); window.__bothCharacters = { host, renderer, models, operators }; return checks;
  });
  try {
    expect(result).toHaveLength(10); for (const check of result) { expect(check.groups).toBe(3); expect(check.hair).toBe(true); }
    await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/operators-male-female.png' });
  } finally { await page.evaluate(async () => { const { disposeModel } = await import('/weapon-model.js'), f = window.__bothCharacters; f.operators.forEach((operator) => disposeModel(operator.group)); f.models.dispose(); f.renderer.dispose(); f.host.remove(); delete window.__bothCharacters; }); }
});
