import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('Drydock and Whiteout render real below-ground openings, and the tactical view follows the player underground', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const [THREE, { FPSGame }, { wallDistance }, { drawTacticalMap }] = await Promise.all([
      import('/vendor/three.module.js'), import('/game.js'), import('/shared/world.js'), import('/map.js'),
    ]);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:9990;background:#132129;color:#d7ebe3;padding:22px;font:14px system-ui';
    const title = document.createElement('h2'); title.textContent = 'LINKSHOT / RESEARCH WINGS & BASEMENT ROUTES'; title.style.margin = '0 0 14px';
    const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px'; host.append(title, grid); document.body.append(host);
    const shell = document.getElementById('game-shell'); shell.hidden = false;
    const checks = [];
    for (const [mapId, views] of [
      ['whiteout', [
        ['화이트아웃 · 넓어진 연구동과 정비동', [28.5, 11.5, 3.4], [24.5, 6.5, 11.5]],
        ['화이트아웃 B1 · 따뜻한 조명의 정비 우회로', [2.45, -1.98, 3.1], [-3.8, -1.92, 3.1]],
        ['화이트아웃 B1 · 동서 연구 구역을 잇는 통로', [-3.4, -1.98, -7.2], [4, -2, -7.2]],
      ]],
      ['drydock', [['드라이독 B1 · 하역동으로 이어지는 통로', [-7.2, -1.98, -4.85], [-7.2, -1.92, -13.7]]]],
    ]) {
      const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), mapId,
        settings: { sensitivity: 1, fov: 85, volume: 0, quality: 'balanced' }, audio: {}, send() {}, onMenu() {}, onFatal(message) { throw new Error(message); } });
      cancelAnimationFrame(game.frameId); game.weapon.visible = false;
      game.renderer.setPixelRatio(1); game.renderer.setSize(850, 443, false); game.camera.aspect = 850 / 443; game.camera.updateProjectionMatrix();
      for (const [label, from, to] of views) {
        game.camera.position.set(...from); game.camera.lookAt(...to); game.renderFrame();
        const card = document.createElement('figure'); card.style.cssText = 'margin:0;border:1px solid #496270;background:#203540';
        const img = new Image(); img.src = game.canvas.toDataURL('image/png'); img.alt = label; img.style.cssText = 'display:block;width:100%'; await img.decode();
        const caption = document.createElement('figcaption'); caption.textContent = label; caption.style.padding = '8px 12px';
        card.append(img, caption); grid.append(card);
      }
      const { world } = game, u = world.underground, [entry] = u.entrances, corridor = u.path[2];
      const down = new THREE.Vector3(0, -1, 0);
      const meshes = ['cellar-ground-slab', 'cellar-basement-step', 'cellar-basement-floor'].map(name => game.scene.getObjectByName(name));
      const ray = ({ x, z }) => {
        const origin = new THREE.Vector3(x, 1.5, z), drawn = new THREE.Raycaster(origin, down, 0, 7).intersectObjects(meshes, false)[0]?.distance;
        return { drawn, collision: wallDistance(origin, down, 7, world) };
      };
      const chart = document.createElement('canvas'); chart.width = 480; chart.height = 360;
      const self = { ...corridor, id: 'operator', hp: 100, yaw: 0 };
      drawTacticalMap(chart, { world, self, detailed: true });
      const scale = Math.min((chart.width - 90) / world.width, (chart.height - 90) / world.depth);
      const [r, g, b] = chart.getContext('2d').getImageData(Math.round(chart.width / 2 + (corridor.x + 1) * scale), Math.round(chart.height / 2 + (corridor.z + .8) * scale), 1, 1).data;
      const service = u.branches[0], serviceZ = service?.path.at(-1).z;
      const serviceColor = service && chart.getContext('2d').getImageData(chart.width / 2, Math.round(chart.height / 2 + serviceZ * scale), 1, 1).data;
      // Sample inside a tread, not at the shared edge of two adjacent risers.
      const tread = { ...entry.hole, [entry.axis]: entry.hole[entry.axis] + entry.dir * .16 };
      checks.push({ mapId, shaft: ray(tread), closed: ray(corridor), tunnelMap: g > 68 && b > r,
        serviceMap: !service || serviceColor[0] > 180 && serviceColor[0] > serviceColor[1] && serviceColor[1] > serviceColor[2],
        serviceLights: !service || !!game.scene.getObjectByName('cellar-service-lamp') });
      await game.dispose();
    }
    shell.hidden = true;
    return checks;
  });
  for (const check of result) {
    expect(check.shaft.collision).toBeGreaterThan(3);
    expect(check.shaft.drawn, check.mapId).toBeCloseTo(check.shaft.collision, 3);
    expect(check.closed.collision).toBeCloseTo(1.5, 4); expect(check.closed.drawn).toBeCloseTo(1.5, 4);
    expect(check.tunnelMap).toBe(true);
    expect(check.serviceMap && check.serviceLights).toBe(true);
  }
  expect(errors).toEqual([]);
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/whiteout-bypass.png' });
});
