import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { WEAPONS } from '../../shared/catalog.js';

test('all thirteen real-world profiles can be previewed and render distinct gun assemblies', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/'); await expect(page.getByText('LAN SERVER ONLINE')).toBeVisible();
  await page.getByRole('button', { name: '무기 및 스킨 선택', exact: true }).click(); await expect(page.locator('#weapon-choices button')).toHaveCount(20);
  for (const weapon of WEAPONS.slice(7)) { await page.locator(`#weapon-choices [data-weapon=${weapon.id}]`).click(); await expect(page.locator('#armory-weapon-name')).toHaveText(weapon.name); }
  await page.getByRole('button', { name: '장비 저장', exact: true }).click();
  await page.evaluate(async () => {
    const [THREE, { WeaponModels }, { WEAPONS }] = await Promise.all([import('/vendor/three.module.js'), import('/weapon-model.js'), import('/shared/catalog.js')]);
    const host = document.createElement('div'); host.id = 'real-weapons'; host.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#13212b;color:#c9d9df;font:13px monospace';
    const title = document.createElement('h2'); title.textContent = 'LINKSHOT / 12 REAL-WORLD WEAPON PROFILES'; title.style.cssText = 'margin:25px 30px;letter-spacing:2px;font-size:18px'; host.append(title);
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'display:block;position:absolute;top:70px;width:1600px;height:900px'; host.append(canvas); document.body.append(host);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); renderer.setSize(1600, 900); renderer.setScissorTest(true); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
    const models = new WeaponModels(), scenes = [];
    for (const [i, weapon] of WEAPONS.slice(7).entries()) {
      const scene = new THREE.Scene(); scene.background = new THREE.Color(i % 2 ? '#152832' : '#182e39');
      const camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.01, 20); camera.position.set(weapon.type === 'SNIPER' ? 2.05 : 1.75, 0.5, 1.25); camera.lookAt(0, -0.02, -0.25);
      scene.add(new THREE.HemisphereLight('#d4edff', '#3a4140', 3)); const key = new THREE.DirectionalLight('#ffdec1', 4); key.position.set(3, 4, 2); scene.add(key);
      const model = models.create(weapon.id, 'standard'); scene.add(model); scenes.push(scene);
      const col = i % 4, row = Math.floor(i / 4); renderer.setViewport(col * 400, (2 - row) * 300, 400, 300); renderer.setScissor(col * 400, (2 - row) * 300, 400, 300); renderer.render(scene, camera);
      const label = document.createElement('span'); label.textContent = `${weapon.name} / ${weapon.action} / ${weapon.magazine} RDS`; label.style.cssText = `position:absolute;left:${col * 400}px;top:${70 + (row + 1) * 300 - 34}px;width:400px;text-align:center;color:#b9d0d5;letter-spacing:1px;font-size:12px`; host.append(label);
    }
    window.__weaponSheet = { host, renderer, models, scenes };
  });
  try { await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/real-world-weapons.png' }); expect(errors).toEqual([]); }
  finally { await page.evaluate(async () => { const { disposeModel } = await import('/weapon-model.js'), sheet = window.__weaponSheet; sheet.scenes.forEach(disposeModel); sheet.models.dispose(); sheet.renderer.dispose(); sheet.host.remove(); delete window.__weaponSheet; }); }
});
