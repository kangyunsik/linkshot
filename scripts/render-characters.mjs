// Reproducible in-engine catalog art, not concept art or a paid image service.
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../server/index.js';

const root = new URL('../', import.meta.url), server = createGameServer({ port: 0, host: '127.0.0.1', loop: false });
let browser;
try {
  const info = await server.listen(), chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}), args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage(); await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(`http://127.0.0.1:${info.port}`);
  const portraits = await page.evaluate(async () => {
    const [THREE, { createOperator, lightOperator }, { WeaponModels, disposeModel }, { CHARACTERS, OUTFITS }] = await Promise.all([import('/vendor/three.module.js'), import('/operator-model.js'), import('/weapon-model.js'), import('/shared/outfits.js')]);
    const shots = [
      ...CHARACTERS.map(character => ({ file: character.image, characterId: character.id, outfitId: 'field', portrait: true, accent: character.accent })),
      ...OUTFITS.map(outfit => ({ file: outfit.image, characterId: 'male', outfitId: outfit.id, accent: outfit.accent })),
    ];
    const results = [], models = new WeaponModels(), renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene(); lightOperator(scene);
    const manager = THREE.DefaultLoadingManager;
    let started = false, resolveLoad;
    manager.onStart = () => { started = true; };
    manager.onLoad = () => resolveLoad();
    for (const shot of shots) {
      const height = shot.portrait ? 384 : 480, width = shot.portrait ? 320 : 360;
      const half = shot.portrait ? .28 : .96, top = shot.portrait ? 1.56 : .92;
      const camera = new THREE.OrthographicCamera(-half * width / height, half * width / height, half, -half, .02, 20);
      camera.position.set(0, top + (shot.portrait ? .15 : .36), -4); camera.lookAt(0, top, 0);
      scene.background = new THREE.Color('#192a37').lerp(new THREE.Color(shot.accent), .035);
      renderer.setSize(width, height);
      started = false; const ready = new Promise(resolve => { resolveLoad = resolve; });
      const operator = createOperator({ ...shot, skinId: 'standard' }, models, { wardrobe: true });
      operator.group.rotation.y = shot.characterId === 'nari' ? .23 : shot.characterId === 'rhea' ? -.44 : -.24;
      scene.add(operator.group); if (started) await ready;
      renderer.render(scene, camera);
      results.push({ file: shot.file, data: renderer.domElement.toDataURL('image/png').split(',')[1] });
      scene.remove(operator.group); disposeModel(operator.group);
    }
    models.dispose(); renderer.dispose();
    return results;
  });
  await mkdir(new URL('public/assets/', root), { recursive: true });
  for (const portrait of portraits) { await writeFile(new URL(`public/assets/${portrait.file}`, root), Buffer.from(portrait.data, 'base64')); console.log(`Prepared ${portrait.file}`); }
  console.log(`Rendered ${portraits.length} catalog images from the actual game models.`);
} finally { await browser?.close(); await server.close(); }
