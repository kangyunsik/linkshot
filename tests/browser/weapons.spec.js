import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { WEAPONS } from '../../shared/catalog.js';

test('all twenty weapon profiles can be previewed and render distinct sculpted gun assemblies', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1640 });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  await page.getByRole('button', { name: '무기 및 스킨 선택', exact: true }).click(); await expect(page.locator('#weapon-choices button')).toHaveCount(20);
  for (const weapon of WEAPONS.slice(7)) { await page.locator(`#weapon-choices [data-weapon=${weapon.id}]`).click(); await expect(page.locator('#armory-weapon-name')).toHaveText(weapon.name); }
  await page.getByRole('button', { name: '장비 저장', exact: true }).click();
  await page.evaluate(async () => {
    const [THREE, { WeaponModels }, { WEAPONS }] = await Promise.all([import('/vendor/three.module.js'), import('/weapon-model.js'), import('/shared/catalog.js')]);
    const host = document.createElement('div'); host.id = 'real-weapons'; host.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#13212b;color:#c9d9df;font:13px monospace';
    const title = document.createElement('h2'); title.textContent = 'LINKSHOT / 20 SCULPTED WEAPON PROFILES'; title.style.cssText = 'margin:25px 30px;letter-spacing:2px;font-size:18px'; host.append(title);
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'display:block;position:absolute;top:70px;width:1600px;height:1500px'; host.append(canvas); document.body.append(host);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); renderer.setSize(1600, 1500); renderer.setScissorTest(true); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
    const models = new WeaponModels(), scenes = [];
    for (const [i, weapon] of WEAPONS.entries()) {
      const scene = new THREE.Scene(); scene.background = new THREE.Color(i % 2 ? '#152832' : '#182e39');
      const camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.01, 20); camera.position.set(weapon.type === 'SNIPER' ? 2.05 : 1.75, 0.5, 1.25); camera.lookAt(0, -0.02, -0.25);
      scene.add(new THREE.HemisphereLight('#d4edff', '#3a4140', 3)); const key = new THREE.DirectionalLight('#ffdec1', 4); key.position.set(3, 4, 2); scene.add(key);
      const model = models.create(weapon.id, 'standard'); scene.add(model); scenes.push(scene);
      const col = i % 4, row = Math.floor(i / 4); renderer.setViewport(col * 400, (4 - row) * 300, 400, 300); renderer.setScissor(col * 400, (4 - row) * 300, 400, 300); renderer.render(scene, camera);
      const label = document.createElement('span'); label.textContent = `${weapon.name} / ${weapon.action} / ${weapon.magazine} RDS`; label.style.cssText = `position:absolute;left:${col * 400}px;top:${70 + (row + 1) * 300 - 34}px;width:400px;text-align:center;color:#b9d0d5;letter-spacing:1px;font-size:12px`; host.append(label);
    }
    window.__weaponSheet = { host, renderer, models, scenes };
  });
  try { await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/real-world-weapons.png' }); expect(errors).toEqual([]); }
  finally { await page.evaluate(async () => { const { disposeModel } = await import('/weapon-model.js'), sheet = window.__weaponSheet; sheet.scenes.forEach(disposeModel); sheet.models.dispose(); sheet.renderer.dispose(); sheet.host.remove(); delete window.__weaponSheet; }); }
});

test('all gun bodies have shaped profiles, real muzzle bores, open sights and owner-managed shared geometry', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const result = await page.evaluate(async () => {
    const [THREE, { WeaponModels, disposeModel }, { WEAPONS, SKINS }] = await Promise.all([import('/vendor/three.module.js'), import('/weapon-model.js'), import('/shared/catalog.js')]);
    const models = new WeaponModels(), checks = [];
    for (const weapon of WEAPONS) for (const skin of SKINS) {
      const model = models.create(weapon.id, skin.id), body = model.userData.firearmBody, meshes = []; body.traverse((object) => { if (object.isMesh && object.name !== 'sight-reference') meshes.push(object); }); model.updateMatrixWorld(true);
      const muzzle = model.userData.muzzle.position, bore = new THREE.Raycaster(new THREE.Vector3(0, .02, muzzle.z - .1), new THREE.Vector3(0, 0, 1), 0, .2).intersectObjects(meshes, false)[0];
      const clearSight = ['ASSAULT', 'SMG', 'LMG', 'DMR'].includes(weapon.type) ? new THREE.Raycaster(new THREE.Vector3(0, model.userData.aimHeight, .25), new THREE.Vector3(0, 0, -1), 0, .4).intersectObjects(meshes.filter((mesh) => !mesh.material.transparent), false).length === 0 : true;
      checks.push({ id: weapon.id, skin: skin.id, design: model.userData.design, muzzle: muzzle.toArray(), meshes: meshes.length, profiles: body.userData.features.filter((f) => f.kind === 'chamfered-profile').length, holes: body.userData.features.filter((f) => f.holes).length, bore: bore?.distance, clearSight, finite: meshes.every((mesh) => ['position', 'normal'].every((name) => [...mesh.geometry.getAttribute(name).array].every(Number.isFinite))), triangles: meshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count / 3, 0) });
      disposeModel(model);
    }
    const a = models.create('rifle', 'standard'), b = models.create('rifle', 'circuit'), geometry = a.getObjectByName('frame-coat').geometry; let disposals = 0;
    geometry.addEventListener('dispose', () => disposals++); const shared = geometry === b.getObjectByName('frame-coat').geometry; disposeModel(a); disposeModel(b); const beforeOwner = disposals; models.dispose();
    return { checks, shared, beforeOwner, afterOwner: disposals };
  });
  expect(result.checks).toHaveLength(120);
  for (const check of result.checks) {
    const weapon = WEAPONS.find((weapon) => weapon.id === check.id), muzzle = { rifle: -.82, smg: -.58, shotgun: -.97, sniper: -1.3, pistol: -.36, lmg: -1.09, dmr: -1.06 };
    expect(check.muzzle).toEqual([0, .02, check.id === 'm82' ? -1.52 : check.id === 'deagle' ? -.40 : muzzle[weapon.model || weapon.id]]);
    expect(check.design).toBe('sculpted-firearms-v2'); expect(check.profiles).toBeGreaterThanOrEqual(5); expect(check.holes).toBeGreaterThan(0); expect(check.meshes).toBeLessThan(16);
    expect(check.finite && check.clearSight).toBe(true); expect(check.bore).toBeGreaterThan(.11); expect(check.triangles).toBeLessThan(8000);
  }
  expect(result.shared).toBe(true); expect(result.beforeOwner).toBe(0); expect(result.afterOwner).toBe(1);
});

test('FAMAS uses one low carry handle and keeps the horizon clear with a centered integrated sight', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const result = await page.evaluate(async () => {
    const [THREE, { WeaponModels, disposeModel }] = await Promise.all([import('/vendor/three.module.js'), import('/weapon-model.js')]);
    const models = new WeaponModels(), model = models.create('famas', 'standard', true), body = model.userData.firearmBody;
    const bounds = new THREE.Box3().setFromObject(body), features = body.userData.features;
    const canvas = document.createElement('canvas'), renderer = new THREE.WebGLRenderer({ canvas }); renderer.setSize(400, 300);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#13212b'); scene.add(new THREE.HemisphereLight('#e1eeff', '#53605e', 3)); scene.add(model);
    const camera = new THREE.PerspectiveCamera(82, 4 / 3, .04, 10); model.position.set(.18, -.20, -.54);
    const target = new THREE.WebGLRenderTarget(400, 300); renderer.setRenderTarget(target); renderer.render(scene, camera);
    const pixels = new Uint8Array(400 * 300 * 4); renderer.readRenderTargetPixels(target, 0, 0, 400, 300, pixels); let above = 0, gun = 0;
    for (let row = 0; row < 300; row++) for (let col = 0; col < 400; col++) { const i = (row * 400 + col) * 4; if (Math.abs(pixels[i] - pixels[0]) + Math.abs(pixels[i + 1] - pixels[1]) + Math.abs(pixels[i + 2] - pixels[2]) > 12) { gun++; if (row >= 150) above++; } }
    model.position.set(0, -model.userData.aimHeight, -.35); model.updateMatrixWorld(true); camera.updateMatrixWorld(true); const sight = model.localToWorld(model.userData.aimPoint.clone()).project(camera);
    const result = { top: bounds.max.y, aimHeight: model.userData.aimHeight, handles: features.filter((feature) => feature.name === 'famas-low-carry-handle').length, highHolo: features.some((feature) => feature.name === 'open-reflex-sight'), above, gun, error: Math.hypot(sight.x, sight.y) };
    renderer.setRenderTarget(null); target.dispose(); disposeModel(model); models.dispose(); renderer.dispose(); return result;
  });
  expect(result.top).toBeLessThan(.16); expect(result.aimHeight).toBeLessThan(.15); expect(result.handles).toBe(1); expect(result.highHolo).toBe(false); expect(result.error).toBeLessThan(.00001); expect(result.gun).toBeGreaterThan(2000); expect(result.above).toBe(0);
});

test('MP5 cocking handle and sights, scope rings and magazines have physical attachment paths to their receivers', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const checks = await page.evaluate(async () => {
    const [{ WeaponModels, disposeModel }] = await Promise.all([import('/weapon-model.js')]); const models = new WeaponModels(), checks = [];
    const required = { mp5: ['mp5-cocking-handle', 'rear-sight-ear', 'front-sight-post', 'front-sight-hood'], sniper: ['scope-mount-ring', 'scope-main-tube', 'scope-eyepiece'], awp: ['scope-mount-ring', 'scope-main-tube'], m82: ['scope-mount-ring', 'scope-main-tube'], p90: ['p90-horizontal-magazine'], rifle: ['open-reflex-sight'], smg: ['open-reflex-sight'] };
    for (const [id, names] of Object.entries(required)) {
      const model = models.create(id, 'standard'), body = model.userData.firearmBody, features = body.userData.features.map((feature) => { const offset = model.getObjectByName(`firearm-${feature.parent}`).position; return { ...feature, min: feature.min.map((x, i) => x + offset.getComponent(i)), max: feature.max.map((x, i) => x + offset.getComponent(i)) }; });
      const root = features.findIndex((feature) => ['contoured-receiver', 'mp5-round-receiver', 'p90-integrated-thumbhole-shell'].includes(feature.name));
      const connected = new Set([root]), queue = [root];
      for (const i of queue) for (let j = 0; j < features.length; j++) if (!connected.has(j) && [0, 1, 2].every((axis) => features[i].min[axis] <= features[j].max[axis] + .001 && features[j].min[axis] <= features[i].max[axis] + .001)) { connected.add(j); queue.push(j); }
      for (const name of names) checks.push({ id, name, attached: features.some((feature, index) => feature.name === name && connected.has(index)) });
      disposeModel(model);
    }
    models.dispose(); return checks;
  });
  for (const check of checks) expect(check.attached, `${check.id}: ${check.name} must not float`).toBe(true);
});

test('AK/FAMAS blades and rifle optic mounts keep the lower sight picture open without moving the aim axis', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const checks = await page.evaluate(async () => {
    const [THREE, { WeaponModels, disposeModel }] = await Promise.all([import('/vendor/three.module.js'), import('/weapon-model.js')]); const models = new WeaponModels(), checks = [];
    for (const id of ['ak47', 'famas', 'mp5', 'rifle', 'm4a1', 'dmr', 'm14', 'lmg', 'm249']) {
      const model = models.create(id, 'standard'), features = model.userData.firearmBody.userData.features, height = model.userData.aimHeight, meshes = []; model.updateMatrixWorld(true); model.userData.firearmBody.traverse((object) => { if (object.isMesh && object.name !== 'sight-reference' && !object.material.transparent) meshes.push(object); });
      const iron = ['ak47', 'famas', 'mp5'].includes(id), marksman = ['dmr', 'm14'].includes(id), z = iron ? id === 'famas' ? -.394 : id === 'mp5' ? -.404 : -.524 : marksman ? -.035 : .003;
      const clear = (x, y) => { const origin = new THREE.Vector3(0, height, .35), target = new THREE.Vector3(x, y, z), ray = target.clone().sub(origin), distance = ray.length(); return new THREE.Raycaster(origin, ray.normalize(), 0, distance).intersectObjects(meshes, false).length === 0; };
      const tower = features.find((feature) => feature.name === 'front-sight-tower'), blade = features.find((feature) => feature.name === 'front-sight-post'), carry = features.find((feature) => feature.name === 'famas-low-carry-handle');
      const rearOpening = id !== 'mp5' || (() => { const origin = new THREE.Vector3(0, height, .35), target = new THREE.Vector3(0, height - .04, .115), ray = target.clone().sub(origin); return new THREE.Raycaster(origin, ray.clone().normalize(), 0, ray.length()).intersectObjects(meshes, false).length === 0; })();
      checks.push({ id, height, lower: iron ? [-.006, .006].every((x) => clear(x, height - .015)) : [-.014, .014].every((x) => clear(x, height - (marksman ? .030 : .0255))), rearOpening, riser: iron || clear(0, height - .045), towerHeight: tower && tower.max[1] - tower.min[1], bladeWidth: blade && blade.max[0] - blade.min[0], bladeTip: blade?.max[1], bladeBase: blade?.min[1], towerTop: tower?.max[1], carryTop: carry?.max[1] }); disposeModel(model);
    }
    models.dispose(); return checks;
  });
  for (const check of checks) { expect(check.lower, check.id).toBe(true); expect(check.riser, check.id).toBe(true); expect(check.rearOpening, check.id).toBe(true); if (['ak47', 'famas', 'mp5'].includes(check.id)) { expect(check.towerHeight).toBeLessThan(.065); expect(check.bladeWidth).toBeLessThan(.006); expect(check.bladeTip).toBeCloseTo(check.height, 6); expect(check.bladeBase).toBeLessThanOrEqual(check.towerTop + .00001); } }
  expect(checks.find((check) => check.id === 'famas').height).toBe(.132); expect(checks.find((check) => check.id === 'ak47').height).toBe(.14); expect(checks.find((check) => check.id === 'famas').carryTop).toBeLessThan(.115);
});
