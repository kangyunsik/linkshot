import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createGameServer } from '../../server/index.js';

test('instanced circular scars hug the surface, fade near one minute and release their private GPU resources', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const result = await page.evaluate(async () => {
    const [THREE, { BulletMarks }, { BULLET_MARK_RULES }] = await Promise.all([import('/vendor/three.module.js'), import('/bullet-marks.js'), import('/shared/world.js')]);
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999'; document.body.append(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); renderer.setSize(640, 480); const scene = new THREE.Scene(); scene.background = new THREE.Color('#b9beb8'); scene.add(new THREE.HemisphereLight('#ffffff', '#809087', 2)); const sun = new THREE.DirectionalLight('#fff2df', 2); sun.position.set(-2, 4, 4); scene.add(sun);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 4, .4), new THREE.MeshStandardMaterial({ color: '#b5b9b3', roughness: 1 })); wall.position.set(0, 2, -2); scene.add(wall);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: '#8b918b' })); floor.rotation.x = -Math.PI / 2; scene.add(floor); scene.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(65, 4 / 3, .04, 20); camera.position.set(0, 1.6, 0); camera.lookAt(0, 1.6, -2);
    const marks = new BulletMarks(scene, [wall, floor]), target = new THREE.WebGLRenderTarget(640, 480), now = performance.now(), scar = { id: 'shot-1', surfaceId: 'wall', kind: 'wall', weaponId: 'rifle', point: { x: 0, y: 1.6, z: -1.8 }, normal: { x: 0, y: 0, z: 1 }, bounds: { minX: -2, maxX: 2, minY: 0, maxY: 4, minZ: -2.2, maxZ: -1.8 } };
    marks.prepareWarmup(); await renderer.compileAsync(scene, camera); marks.finishWarmup();
    const pixels = () => { renderer.setRenderTarget(target); renderer.render(scene, camera); const data = new Uint8Array(640 * 480 * 4); renderer.readRenderTargetPixels(target, 0, 0, 640, 480, data); return data; };
    const baseline = pixels(); marks.add(scar, null, now); marks.update(now); const fresh = pixels(), item = marks.items[0];
    const alignment = new THREE.Vector3(0, 0, 1).transformDirection(item.matrix).dot(new THREE.Vector3(0, 0, 1)), offset = item.point.z + .0025;
    const duplicate = marks.add(scar, null, now); marks.add({ ...scar, id: 'shot-2' }, null, now); const grouped = marks.items.length;
    marks.update(now + 59_000); const faded = pixels(); marks.update(now + 60_001); const expired = pixels();
    const difference = (a, b) => { let energy = 0, count = 0; for (let i = 0; i < a.length; i += 4) { const change = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); energy += change; if (change > 12) count++; } return { energy, count }; };
    const full = difference(fresh, baseline), fade = difference(faded, baseline), gone = difference(expired, baseline);
    marks.add({ ...scar, id: 'floor-shot', surfaceId: 'ground', point: { x: 0, y: 0, z: -1 }, normal: { x: 0, y: 1, z: 0 }, bounds: { minX: -5, maxX: 5, minY: 0, maxY: 0, minZ: -5, maxZ: 5 } }); const floorAlignment = marks.items[0].normal.y;
    marks.clear(); for (let i = 0; i < BULLET_MARK_RULES.maxMarks + 2; i++) marks.add({ ...scar, id: `capacity-${i}`, point: { x: -1.9 + i % 128 * .03, y: .1 + Math.floor(i / 128) * .03, z: -1.8 } }); const bounded = marks.items.length;
    marks.clear(); marks.add({ ...scar, id: 'closeup' }); marks.update(performance.now()); renderer.setRenderTarget(null); renderer.setSize(900, 600); camera.aspect = 1.5; camera.position.z = -1.25; camera.updateProjectionMatrix(); renderer.render(scene, camera);
    let releases = 0; for (const resource of [marks.mesh, marks.geometry, marks.material, marks.texture]) resource.addEventListener('dispose', () => releases++);
    window.__scarReview = { renderer, marks, wall, floor, target, canvas, scene, releases: () => releases };
    return { full, fade, gone, grouped, duplicate, alignment, offset, floorAlignment, bounded, limit: BULLET_MARK_RULES.maxMarks };
  });
  expect(result.full.count).toBeGreaterThan(15); expect(result.fade.energy).toBeGreaterThan(0); expect(result.fade.energy).toBeLessThan(result.full.energy * .6); expect(result.gone.count).toBe(0); expect(result.grouped).toBe(1); expect(result.duplicate).toBe(false);
  expect(result.alignment).toBeGreaterThan(.9999); expect(result.offset).toBeCloseTo(-1.7975, 4); expect(result.floorAlignment).toBeGreaterThan(.9999); expect(result.bounded).toBeLessThanOrEqual(result.limit);
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/circular-bullet-scars.png' });
  const disposed = await page.evaluate(() => { const f = window.__scarReview; f.marks.dispose(); const result = { releases: f.releases(), detached: !f.scene.children.includes(f.marks.mesh), count: f.marks.mesh.count, refiners: f.marks.worldMeshes.length, cells: f.marks.cells.size }; f.wall.geometry.dispose(); f.wall.material.dispose(); f.floor.geometry.dispose(); f.floor.material.dispose(); f.target.dispose(); f.renderer.dispose(); f.canvas.remove(); delete window.__scarReview; return result; });
  expect(disposed).toEqual({ releases: 4, detached: true, count: 0, refiners: 0, cells: 0 }); expect(errors).toEqual([]);
});

test('real LAN shot events stamp the game scene and late joins restore the remaining lifetime without repeating full history', async ({ page }) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1', loop: false }), info = await app.listen(), errors = []; page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto(`http://127.0.0.1:${info.port}`);
    const first = await page.evaluate(async () => {
      const [{ FPSGame }] = await Promise.all([import('/game.js')]);
      const connect = () => new Promise((resolve) => { const socket = new WebSocket(`ws://${location.host}/play`); socket.addEventListener('message', function hello(event) { if (JSON.parse(event.data).type === 'hello') { socket.removeEventListener('message', hello); resolve(socket); } }); });
      const wait = (socket, type) => new Promise((resolve) => { socket.addEventListener('message', function receive(event) { const data = JSON.parse(event.data); if (data.type === type) { socket.removeEventListener('message', receive); resolve(data); } }); });
      const create = async (joined) => {
        const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), mapId: joined.room.mapId, settings: { sensitivity: 1, fov: 82, volume: 0, quality: 'low' }, audio: { step() {}, shot() {}, reload() {}, hit() {}, hurt() {}, kill() {} }, send() {}, onMenu() {}, onFatal(message) { throw new Error(message); } });
        game.applySnapshot(joined, joined.id); await game.prepareGraphics(); return game;
      };
      document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
      const a = await connect(), ready = wait(a, 'joined'); a.send(JSON.stringify({ type: 'create', bots: 0 })); const joined = await ready, game = await create(joined);
      const f = { a, game, connect, wait, create, latest: joined }; a.addEventListener('message', (event) => { const data = JSON.parse(event.data); if (data.type === 'state') { f.latest = data; f.game.applySnapshot(data); } }); window.__lanScars = f; return { code: joined.room.code, id: joined.id };
    });
    const room = app.rooms.get(first.code), player = room.players.get(first.id); Object.assign(player, { x: 24, y: 0, z: 12, yaw: 0, pitch: -.65, protectedUntil: 0 }); room.shoot(player, Date.now(), true); app.broadcast();
    await expect.poll(() => page.evaluate(() => window.__lanScars.game.bulletMarks.items.length)).toBe(1);
    expect(await page.evaluate(() => 'impacts' in window.__lanScars.latest)).toBe(false);
    const mark = room.impactHistory()[0]; expect(mark).toBeTruthy(); mark.at = Date.now() - 58_000;
    const restored = await page.evaluate(async (code) => {
      const f = window.__lanScars, b = await f.connect(), ready = f.wait(b, 'joined'); f.b = b; b.send(JSON.stringify({ type: 'join', code })); const joined = await ready; await f.game.dispose(); f.game = await f.create(joined);
      const items = f.game.bulletMarks.items; return { history: joined.impacts.length, count: items.length, age: performance.now() - items[0].born, normal: items[0].normal.y, round: joined.room.roundId };
    }, first.code);
    expect(restored.history).toBe(1); expect(restored.count).toBe(1); expect(restored.age).toBeGreaterThanOrEqual(58_000); expect(restored.age).toBeLessThan(60_000); expect(restored.normal).toBeGreaterThan(.999);
    room.restart(first.id); app.broadcast(); await expect.poll(() => page.evaluate(() => window.__lanScars.game.bulletMarks.items.length)).toBe(0); expect(errors).toEqual([]);
  } finally { await page.evaluate(async () => { const f = window.__lanScars; if (!f) return; await f.game.dispose(); f.a.close(); f.b?.close(); delete window.__lanScars; }); await app.close(); }
});

test('online scoreboards label disconnected players and put abandoned players behind finishers', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const rows = await page.evaluate(async () => { const { renderScoreboard } = await import('/game.js'); const table = document.createElement('div'); renderScoreboard(table, [{ id: 'left', name: 'LEAVER', kills: 20, deaths: 0, abandoned: true }, { id: 'stay', name: 'FINISHER', kills: 1, deaths: 5, connected: false }], 'stay'); return [...table.querySelectorAll('tbody tr')].map((row) => row.textContent); });
  expect(rows[0]).toContain('FINISHER'); expect(rows[0]).toContain('재접속 대기'); expect(rows[1]).toContain('LEAVER'); expect(rows[1]).toContain('탈주');
});
