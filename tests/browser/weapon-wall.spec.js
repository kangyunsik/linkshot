import { test, expect } from '@playwright/test';

test('world-visible barrels and muzzle flashes cannot protrude through a solid wall; real openings and viewmodels remain unaffected', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const result = await page.evaluate(async () => {
    const [THREE, { WeaponModels, disposeModel }, { WeaponWallGuard }] = await Promise.all([import('/vendor/three.module.js'), import('/weapon-model.js'), import('/weapon-wall.js')]);
    const renderer = new THREE.WebGLRenderer({ antialias: false }); renderer.localClippingEnabled = true; renderer.setSize(320, 240);
    const target = new THREE.WebGLRenderTarget(320, 240), scene = new THREE.Scene(); scene.background = new THREE.Color('#33434e'); scene.add(new THREE.HemisphereLight('#ffffff', '#708080', 3));
    const wallGeometry = new THREE.BoxGeometry(4, 3, .2), wallMaterial = new THREE.MeshBasicMaterial({ color: '#8899aa' }), wall = new THREE.Mesh(wallGeometry, wallMaterial); wall.position.y = 1.5; scene.add(wall);
    const models = new WeaponModels(), weapon = models.create('m82', 'standard'), group = new THREE.Group(); group.position.z = .5; weapon.position.set(.1, 1.19, -.16); group.add(weapon); scene.add(group);
    const camera = new THREE.PerspectiveCamera(60, 4 / 3, .05, 20); camera.position.set(1.8, 1.55, -3); camera.lookAt(0, 1.2, 0); renderer.setRenderTarget(target);
    const pixels = () => { renderer.render(scene, camera); const bytes = new Uint8Array(320 * 240 * 4); renderer.readRenderTargetPixels(target, 0, 0, 320, 240, bytes); return bytes; };
    const difference = (a, b) => { let count = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) count++; return count; };
    weapon.visible = false; const baseline = pixels(); weapon.visible = true; const leaking = pixels();
    const guard = new WeaponWallGuard(weapon), world = { width: 20, depth: 20, obstacles: [{ x: 0, y: 0, z: 0, w: 4, h: 3, d: .2 }] };
    guard.update(world, group.position, 0); const clipped = pixels(), keptInside = guard.planes.every((plane) => plane.distanceToPoint(new THREE.Vector3(.1, 1.2, .34)) > 0), cutOutside = guard.planes.some((plane) => plane.distanceToPoint(new THREE.Vector3(.1, 1.2, -.8)) < 0);
    weapon.userData.flash.visible = true; const flashClipped = pixels(); weapon.userData.flash.visible = false;
    world.obstacles = [{ x: -1.2, y: 0, z: 0, w: 1.6, h: 3, d: .2 }, { x: 1.2, y: 0, z: 0, w: 1.6, h: 3, d: .2 }]; guard.update(world, group.position, 0); const opening = guard.planes.every((plane) => plane.constant === 10000);
    const local = models.create('rifle', 'standard', true); let localUntouched = true; local.traverse((object) => { for (const material of object.material ? Array.isArray(object.material) ? object.material : [object.material] : []) localUntouched &&= material.clippingPlanes === null; });
    const result = { leaking: difference(leaking, baseline), clipped: difference(clipped, baseline), flashClipped: difference(flashClipped, baseline), keptInside, cutOutside, opening, localUntouched };
    disposeModel(weapon); disposeModel(local); models.dispose(); wallGeometry.dispose(); wallMaterial.dispose(); target.dispose(); renderer.dispose(); return result;
  });
  expect(result.leaking).toBeGreaterThan(30); expect(result.clipped).toBeLessThan(5); expect(result.flashClipped).toBeLessThan(5);
  expect(result.keptInside && result.cutOutside && result.opening && result.localUntouched).toBe(true);
});
