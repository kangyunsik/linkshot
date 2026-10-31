// Isolated first-person contact sheet; captures never enter the public build.
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createGameServer } from '../server/index.js';

const tag = String(process.env.VIEWMODEL_TAG || 'review').replace(/[^a-z0-9-]/gi, '');
const character = process.env.VIEWMODEL_CHARACTER === 'female' ? 'female' : 'male', pose = ['hip', 'ads', 'reload', 'grip'].includes(process.env.VIEWMODEL_POSE) ? process.env.VIEWMODEL_POSE : 'hip';
const app = createGameServer({ port: 0, host: '127.0.0.1', loop: false }); let browser;
try {
  const info = await app.listen(), chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto(`http://127.0.0.1:${info.port}`);
  const metrics = await page.evaluate(async ({ character, pose }) => {
    const [THREE, { WeaponModels, disposeModel }] = await Promise.all([import('/vendor/three.module.js'), import('/weapon-model.js')]);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#263945;color:#dae9e7;font:12px monospace'; document.body.append(host);
    const canvas = document.createElement('canvas'); host.append(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); renderer.setSize(1600, 1080); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#263945'); const camera = new THREE.PerspectiveCamera(82, 400 / 360, .04, 10); scene.add(camera);
    if (pose === 'grip') { camera.position.set(.38, .04, .45); camera.lookAt(0, -.13, -.12); camera.fov = 42; camera.updateProjectionMatrix(); }
    scene.add(new THREE.HemisphereLight('#d6eaf0', '#4a4038', 2.2));
    const light = new THREE.DirectionalLight('#ffe2c0', 3.5); light.position.set(-2, 3, 2); scene.add(light);
    const fill = new THREE.DirectionalLight('#a5d5ed', .7); fill.position.set(2, 1, -2); scene.add(fill);
    const ids = ['rifle', 'pistol', 'shotgun', 'sniper', 'smg', 'lmg', 'dmr', 'p90', 'glock18c', 'm82', 'famas', 'm4a1'];
    const models = new WeaponModels(), manager = THREE.DefaultLoadingManager, oldStart = manager.onStart, oldLoad = manager.onLoad; let loading = false;
    const ready = new Promise((resolve) => { manager.onLoad = resolve; }); manager.onStart = () => { loading = true; };
    const entries = ids.map((id) => { const model = models.create(id, 'standard', true, 'field', character); model.visible = false; scene.add(model); return model; });
    if (loading) await ready; manager.onStart = oldStart; manager.onLoad = oldLoad;
    renderer.setScissorTest(true); const checks = [];
    for (const [index, model] of entries.entries()) {
      const col = index % 4, row = Math.floor(index / 4); model.visible = true;
      model.position.set(pose === 'ads' ? 0 : .18, pose === 'ads' ? -model.userData.aimHeight : -.20 - (pose === 'reload' ? .18 : 0), pose === 'ads' ? -.35 : -.54);
      if (pose === 'grip') model.position.set(0, 0, 0);
      if (pose === 'reload') model.rotation.set(-.25, 0, -.65);
      renderer.setViewport(col * 400, (2 - row) * 360, 400, 360); renderer.setScissor(col * 400, (2 - row) * 360, 400, 360); renderer.render(scene, camera);
      const label = document.createElement('div'); label.textContent = `${ids[index].toUpperCase()} / ${character} / ${pose}`; label.style.cssText = `position:absolute;left:${col * 400 + 14}px;top:${row * 360 + 12}px;letter-spacing:1px`; host.append(label);
      checks.push({ id: ids[index], calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }); model.visible = false;
    }
    window.__viewmodelSheet = { entries, models, renderer, disposeModel, host }; return checks;
  }, { character, pose });
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  const file = `artifacts/viewmodels-${character}-${pose}-${tag}.png`; await page.screenshot({ path: file });
  await page.evaluate(() => { const f = window.__viewmodelSheet; f.entries.forEach(f.disposeModel); f.models.dispose(); f.renderer.dispose(); f.host.remove(); delete window.__viewmodelSheet; });
  console.log(JSON.stringify({ file, metrics }, null, 2));
} finally { await browser?.close(); await app.close(); }
