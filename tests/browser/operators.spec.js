import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('every outfit and weapon finish retains human anatomy, facial features and the same body dimensions', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  const result = await page.evaluate(async () => {
    const [THREE, { createOperator, poseOperator }, { WeaponModels, disposeModel }, { OUTFITS }, { SKINS, WEAPONS }] = await Promise.all([
      import('/vendor/three.module.js'), import('/operator-model.js'), import('/weapon-model.js'), import('/shared/outfits.js'), import('/shared/catalog.js'),
    ]);
    const models = new WeaponModels(), checks = [], firstPerson = [];
    for (const outfit of OUTFITS) for (const skin of SKINS) {
      const operator = createOperator({ outfitId: outfit.id, skinId: skin.id }, models);
      const head = operator.group.getObjectByName('human-head'), face = head.getObjectByName('face');
      const humanMeshes = []; operator.group.traverse((child) => { if (child.isMesh && !operator.weapon.getObjectById(child.id)) humanMeshes.push(child); });
      const standing = new THREE.Box3().setFromObject(operator.group);
      poseOperator(operator, 1); operator.group.updateMatrixWorld(true);
      const crouched = new THREE.Box3().setFromObject(operator.group), facePosition = face.getWorldPosition(new THREE.Vector3());
      checks.push({ outfit: outfit.id, skin: skin.id, rig: operator.group.userData.rig, eyes: head.children.filter((child) => child.name === 'eye').length, faceColor: face.material.color.getHexString(), boxAnatomy: humanMeshes.some((mesh) => mesh.geometry.type === 'BoxGeometry'), headShape: face.geometry.type, standingTop: standing.max.y, crouchedTop: crouched.max.y, feet: crouched.min.y, crouchedFace: facePosition.y, fingers: operator.group.getObjectByName('right-hand').userData.fingers });
      disposeModel(operator.group);
    }
    for (const outfit of OUTFITS) for (const weapon of WEAPONS) {
      const model = models.create(weapon.id, 'standard', true, outfit.id), arms = model.getObjectByName('first-person-human-arms');
      firstPerson.push({ outfit: outfit.id, weapon: weapon.id, hands: arms.children.filter((child) => child.userData.fingers === 5).length, rounded: arms.getObjectByName('right-sleeve').geometry.type !== 'BoxGeometry', noDepth: arms.getObjectByName('palm').material.depthTest === false });
      disposeModel(model);
    }
    models.dispose(); return { checks, firstPerson };
  });
  expect(result.checks).toHaveLength(30); expect(result.firstPerson).toHaveLength(35);
  for (const check of result.checks) {
    expect(check.rig).toBe('human-v1'); expect(check.eyes).toBe(2); expect(check.faceColor).toBe('bf9278');
    expect(check.boxAnatomy).toBe(false); expect(check.headShape).toBe('LatheGeometry'); expect(check.fingers).toBe(5);
    expect(check.standingTop).toBeGreaterThan(1.77); expect(check.standingTop).toBeLessThanOrEqual(1.801);
    expect(check.crouchedTop).toBeLessThanOrEqual(1.101); expect(check.crouchedFace).toBeCloseTo(0.92, 6); expect(check.feet).toBeGreaterThan(-0.005);
  }
  for (const check of result.firstPerson) { expect(check.hands).toBe(2); expect(check.rounded).toBe(true); expect(check.noDepth).toBe(true); }
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
