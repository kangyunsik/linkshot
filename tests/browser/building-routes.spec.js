import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('architectural routes render as the same open doors, stairs and solid skywalk decks used by the simulation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('/');
  const checks = await page.evaluate(async () => {
    const [THREE, { FPSGame }, { wallDistance }, { drawTacticalMap }] = await Promise.all([
      import('/vendor/three.module.js'), import('/game.js'), import('/shared/world.js'), import('/map.js'),
    ]);
    document.getElementById('game-shell').hidden = false;
    const sheet = document.createElement('div');
    sheet.style.cssText = 'position:fixed;inset:0;z-index:9990;background:#15242c;color:#dceae4;padding:24px;font:14px system-ui';
    const title = document.createElement('h2'); title.textContent = 'LINKSHOT / NEW BUILDING ROUTES'; title.style.margin = '0 0 16px'; sheet.append(title);
    const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px'; sheet.append(grid);
    document.body.append(sheet);
    const results = [];
    for (const [mapId, label, from, to] of [
      ['drydock', '드라이독 / 하역 창고 · 두 계단', [-2.6, 1.7, 6.28], [-1.6, 1.8, -2]],
      ['blocknine', '블록 나인 / 시청 옥상 연결교', [-16.5, 10.8, -19.9], [-9.4, 9.8, -20.5]],
      ['whiteout', '화이트아웃 / 동쪽 연구동 연결교', [28.5, 10, 3.3], [24, 6.7, 10]],
      ['nightmarket', '야시장 / 지붕 있는 식당 연결교', [30.8, 10.2, 11.7], [24.3, 7.1, 12.7]],
    ]) {
      const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), mapId,
        settings: { sensitivity: 1, fov: 84, volume: 0, quality: 'balanced' }, audio: {}, send() {}, onMenu() {}, onFatal(message) { throw new Error(message); } });
      cancelAnimationFrame(game.frameId); game.weapon.visible = false; game.renderer.setPixelRatio(1);
      game.renderer.setSize(900, 470, false); game.camera.aspect = 900 / 470;
      game.camera.position.set(...from); game.camera.lookAt(...to); game.camera.updateProjectionMatrix();
      game.renderFrame();
      const { world } = game, link = world.roofBridges[0], warehouse = world.buildings.find(b => b.id === 'warehouse');
      if (link) {
        const origin = new THREE.Vector3(link.x, link.height + .45, link.z), down = new THREE.Vector3(0, -1, 0);
        const bridgeMesh = game.scene.getObjectByName('architecture-bridge');
        const render = new THREE.Raycaster(origin, down, 0, 1).intersectObject(bridgeMesh, false)[0]?.distance;
        const collision = wallDistance(origin, down, 1, world);
        const chart = document.createElement('canvas'); chart.width = 500; chart.height = 400;
        drawTacticalMap(chart, { world, detailed: true });
        const scale = Math.min((chart.width - 90) / world.width, (chart.height - 90) / world.depth);
        const bridgeColor = chart.getContext('2d').getImageData(Math.round(chart.width / 2 + link.x * scale), Math.round(chart.height / 2 + link.z * scale), 1, 1).data;
        results.push({ mapId, render, collision, hasBridgeTint: bridgeColor[2] > bridgeColor[0] * 1.35 && bridgeColor[1] > 115 });
      } else {
        const wallMesh = game.scene.getObjectByName('architecture-wall');
        const portals = warehouse.doors.map(door => {
          const axis = door.axis === 'x' ? 'z' : 'x';
          const origin = new THREE.Vector3(door.x, 1.62, door.z); origin[axis] += door.side * .62;
          const inward = new THREE.Vector3(); inward[axis] = -door.side;
          return new THREE.Raycaster(origin, inward, 0, 1.24).intersectObject(wallMesh, false).length === 0;
        });
        results.push({ mapId, stairs: warehouse.stairs.length, portals });
      }
      const card = document.createElement('figure'); card.style.cssText = 'margin:0;background:#20343d;border:1px solid #46636a';
      const image = new Image(); image.alt = label; image.src = game.canvas.toDataURL('image/png'); image.style.cssText = 'width:100%;display:block'; await image.decode();
      const caption = document.createElement('figcaption'); caption.textContent = label; caption.style.padding = '8px 12px';
      card.append(image, caption); grid.append(card); await game.dispose();
    }
    document.getElementById('game-shell').hidden = true;
    return results;
  });
  expect(checks[0]).toEqual({ mapId: 'drydock', stairs: 2, portals: [true, true, true] });
  for (const result of checks.slice(1)) {
    expect(result.render, result.mapId).toBeCloseTo(result.collision, 4);
    expect(result.collision).toBeCloseTo(.45, 5); expect(result.hasBridgeTint, result.mapId).toBe(true);
  }
  expect(errors).toEqual([]);
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/building-routes.png' });
});
