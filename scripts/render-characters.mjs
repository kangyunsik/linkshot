// Reproducible in-engine portraits, not concept art or a paid image service.
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../server/index.js';
import { CHARACTERS } from '../shared/outfits.js';

const root = new URL('../', import.meta.url), server = createGameServer({ port: 0, host: '127.0.0.1', loop: false });
let browser;
try {
  const info = await server.listen(), chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }); await page.goto(`http://127.0.0.1:${info.port}`);
  const portraits = await page.evaluate(async () => {
    const [THREE, { createOperator }, { WeaponModels, disposeModel }, { CHARACTERS }] = await Promise.all([import('/vendor/three.module.js'), import('/operator-model.js'), import('/weapon-model.js'), import('/shared/outfits.js')]);
    const results = [];
    for (const character of CHARACTERS) {
      const canvas = document.createElement('canvas'), renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); renderer.setSize(512, 640); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
      const scene = new THREE.Scene(); scene.background = new THREE.Color('#172b38');
      const camera = new THREE.PerspectiveCamera(28, 0.8, 0.02, 20); camera.position.set(0.14, 1.60, -1.43); camera.lookAt(0, 1.51, 0);
      scene.add(new THREE.HemisphereLight('#e1eeff', '#53605e', 2.6));
      for (const [color, intensity, position] of [['#ffe9da', 2.2, [-2, 3, -4]], ['#d5eaff', 1.25, [2, 2, -3]], ['#a2d9ee', 1.5, [1, 2, 2]]]) { const light = new THREE.DirectionalLight(color, intensity); light.position.set(...position); scene.add(light); }
      const models = new WeaponModels(), oldOnLoad = THREE.DefaultLoadingManager.onLoad;
      const ready = new Promise((resolve) => { THREE.DefaultLoadingManager.onLoad = resolve; });
      const operator = createOperator({ characterId: character.id, outfitId: 'field', skinId: 'standard' }, models); operator.weapon.visible = false; scene.add(operator.group);
      await ready; THREE.DefaultLoadingManager.onLoad = oldOnLoad; renderer.render(scene, camera);
      results.push({ file: character.image, data: canvas.toDataURL('image/png').split(',')[1] });
      disposeModel(operator.group); models.dispose(); renderer.dispose();
    }
    return results;
  });
  await mkdir(new URL('public/assets/', root), { recursive: true });
  for (const portrait of portraits) { await writeFile(new URL(`public/assets/${portrait.file}`, root), Buffer.from(portrait.data, 'base64')); console.log(`Prepared ${portrait.file}`); }
  console.log(`Rendered ${CHARACTERS.length} character portraits from the actual game models.`);
} finally { await browser?.close(); await server.close(); }
