import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('the six revised arena outlines appear in tactical diagrams and the two alley layouts render as real structures', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /THREE|shader/i.test(message.text())) errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 970 });
  await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('/');
  const capture = await page.evaluate(async () => {
    const [THREE, { FPSGame }, { MATCHMAKING_MAPS, wallDistance }, { drawTacticalMap }] = await Promise.all([
      import('/vendor/three.module.js'), import('/game.js'), import('/shared/world.js'), import('/map.js'),
    ]);
    const host = document.createElement('div'); host.id = 'layout-review'; host.style.cssText = 'position:fixed;inset:0;z-index:9990;background:#14252b;color:#dceae4;padding:24px;box-sizing:border-box;font:14px monospace';
    const heading = document.createElement('h2'); heading.textContent = 'LINKSHOT  /  REVISED ARENAS'; heading.style.cssText = 'margin:0 0 18px;font-size:22px;letter-spacing:3px'; host.append(heading);
    const sheet = document.createElement('div'); sheet.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px'; host.append(sheet); document.body.append(host);
    const maps = MATCHMAKING_MAPS.filter(map => map.arenaProfile);
    for (const map of maps) {
      const card = document.createElement('section'); card.style.cssText = 'border:1px solid #42575d;background:#182b30;padding:9px;min-width:0';
      const title = document.createElement('h3'); title.textContent = `${map.name} / ${map.label}`; title.style.cssText = 'margin:4px 0 10px;font-size:14px';
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 390; canvas.style.cssText = 'width:100%;display:block';
      drawTacticalMap(canvas, { world: map, detailed: true });
      const caption = document.createElement('p'); caption.textContent = map.description; caption.style.cssText = 'margin:10px 0 2px;color:#b6c8c5;font:12px/1.55 system-ui';
      card.append(title, canvas, caption); sheet.append(card);
    }
    const gameShell = document.getElementById('game-shell'); gameShell.hidden = false;
    const frames = [];
    for (const [id, view] of [
      ['longrail', { from: [-1.75, 2.05, -13.8], to: [-1.75, 2, 4] }],
      ['blocknine', { from: [1, 18.5, -17.5], to: [1, 1.1, 1.1] }],
    ]) {
      const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), mapId: id,
        settings: { sensitivity: 1, fov: 76, quality: 'balanced', volume: 0 }, audio: { stopReload() {} }, send() {}, onMenu() {}, onFatal(message) { throw new Error(message); } });
      cancelAnimationFrame(game.frameId); game.weapon.visible = false;
      game.renderer.setSize(900, 600, false); game.camera.aspect = 1.5;
      game.camera.position.set(...view.from); game.camera.lookAt(...view.to); game.camera.updateProjectionMatrix();
      const { world } = game, { crossing } = world;
      const origin = new THREE.Vector3(crossing.lanes[0].center, 1.64, crossing.at), direction = new THREE.Vector3(-1, 0, 0);
      const collision = wallDistance(origin, direction, 20, world);
      const meshes = [];
      game.scene.traverseVisible(object => { if (object.isMesh && object.layers.test(game.camera.layers)) meshes.push(object); });
      const hit = new THREE.Raycaster(origin, direction, 0, 20).intersectObjects(meshes, false)[0];
      game.renderFrame();
      frames.push({ id, collision, visible: hit?.distance, groups: world.obstacles.filter(box => box.kind === 'arena-setback').every(box => game.scene.getObjectByName(box.id)), png: game.canvas.toDataURL('image/png') });
      await game.dispose();
    }
    gameShell.hidden = true;
    window.__profileFrames = frames.map(({ id, png }) => ({ id, png }));
    return { maps: maps.length, frames: frames.map(({ png, ...checks }) => checks) };
  });
  expect(capture.maps).toBe(6);
  for (const { id, collision, visible, groups } of capture.frames) {
    expect(groups, id).toBe(true); expect(collision, id).toBeGreaterThan(2);
    expect(Math.abs(visible - collision), id).toBeLessThan(.06);
  }
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/arena-new-outlines.png' });
  await page.evaluate(async () => {
    const host = document.getElementById('layout-review'); host.replaceChildren();
    const title = document.createElement('h2'); title.textContent = 'LINKSHOT  /  SINGLE AND DOUBLE ALLEYS'; host.append(title);
    const row = document.createElement('div'); row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px'; host.append(row);
    for (const frame of window.__profileFrames) {
      const figure = document.createElement('figure'); figure.style.cssText = 'margin:0;border:1px solid #4b656c;background:#1c3036';
      const image = new Image(); image.src = frame.png; image.alt = ''; await image.decode(); image.style.cssText = 'width:100%;display:block';
      const text = document.createElement('figcaption'); text.textContent = frame.id === 'longrail' ? 'LONGRAIL  /  정비 골목 1개' : 'BLOCK NINE  /  중앙 상가 양옆 골목 2개'; text.style.padding = '14px';
      figure.append(image, text); row.append(figure);
    }
  });
  await page.screenshot({ path: 'artifacts/arena-new-alleys.png' });
  expect(errors).toEqual([]);
});
