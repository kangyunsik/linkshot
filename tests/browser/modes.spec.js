import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => { localStorage.setItem('sector07-settings', JSON.stringify({ sensitivity: 1, fov: 82, volume: 0, quality: 'low' })); });
});

test('all five modes explain their execution paths; unconfigured online modes never start pretend matchmaking', async ({ page }) => {
  const sockets = [], apis = [], errors = []; page.on('websocket', (socket) => sockets.push(socket.url())); page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) apis.push(request.url()); }); page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`); await expect(page.getByRole('tab')).toHaveCount(5);
  for (const name of ['일반', '랭크']) {
    await page.getByRole('tab', { name, exact: true }).click(); await expect(page.locator('#mode-unavailable')).toContainText('Java/Spring Boot'); await expect(page.locator('#create-button')).toBeDisabled();
  }
  await expect(page.locator('#mode-description')).toContainText('AI 보충 없음');
  await page.getByRole('tab', { name: 'LAN 대전', exact: true }).click(); await expect(page.locator('#lan-connect-guide')).toBeVisible(); await expect(page.locator('#mode-unavailable')).toContainText('LAN 서버'); await expect(page.locator('#join-section')).toBeHidden();
  await page.getByRole('tab', { name: '혼자 연습', exact: true }).click(); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible(); await expect(page.locator('#create-button')).toBeEnabled();
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/five-play-modes.png', fullPage: true }); expect(sockets).toEqual([]); expect(apis).toEqual([]); expect(errors).toEqual([]);
});

test('tutorial goals advance from real keyboard/mouse movement; restart and skipping preserve local progression', async ({ page }) => {
  const sockets = [], errors = []; page.on('websocket', (socket) => sockets.push(socket.url())); page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`); const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')));
  await page.getByRole('tab', { name: '튜토리얼', exact: true }).click(); await page.getByRole('button', { name: '튜토리얼 시작', exact: true }).click(); await expect(page.locator('#pause-overlay')).toBeVisible();
  await expect(page.locator('#hud-map-name')).toHaveText('TRAINING RANGE'); await expect(page.locator('#tutorial-title')).toHaveText('시점과 이동');
  await page.getByRole('button', { name: '교전 시작', exact: true }).click(); await page.mouse.move(1000, 300); await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
  await expect(page.locator('#tutorial-title')).toHaveText('지형과 엄폐'); await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/tutorial-training-range.png' });
  await page.evaluate(() => document.exitPointerLock()); await page.getByRole('button', { name: '튜토리얼 다시 시작', exact: true }).click(); await expect(page.locator('#tutorial-title')).toHaveText('시점과 이동');
  await page.evaluate(() => document.exitPointerLock()); await page.getByRole('button', { name: '건너뛰기 · 혼자 연습으로', exact: true }).click(); await expect(page.locator('#lobby')).toBeVisible(); await expect(page.getByRole('tab', { name: '혼자 연습', exact: true })).toHaveAttribute('aria-selected', 'true');
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1'))); for (const key of ['kills', 'deaths', 'points', 'weaponKills', 'roundLedger', 'ownedWeapons']) expect(after[key]).toEqual(profile[key]); expect(sockets).toEqual([]); expect(errors).toEqual([]);
});

test('practice uses the browser worker even on the LAN edition and remains available when the LAN transport fails', async ({ page }) => {
  await page.routeWebSocket('**/play', (socket) => socket.close());
  await page.goto('/'); await page.getByRole('tab', { name: '혼자 연습', exact: true }).click(); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await page.getByRole('button', { name: '연습전 시작', exact: true }).click(); await expect(page.locator('#pause-overlay')).toBeVisible(); await expect(page.locator('#hud-connection-kind')).toHaveText('LOCAL');
  await page.getByRole('button', { name: '로비로 나가기', exact: true }).click(); await page.getByRole('tab', { name: 'LAN 대전', exact: true }).click(); await expect(page.locator('#create-button')).toBeDisabled();
});

test('the real tutorial worker completes all lessons using only ordinary input/equipment messages', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`);
  const result = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker('/solo-worker.js', { type: 'module' }), seen = new Set(); let state, phase = '', phaseAt = 0, action = 0, lastAction = -Infinity;
    const start = performance.now(), cleanup = () => { clearInterval(timer); clearTimeout(timeout); worker.terminate(); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Training stalled: ${JSON.stringify({ phase, lesson: state?.tutorial, player: state?.players.find((p) => p.id === 'local-operator') })}`)); }, 25_000);
    worker.onmessage = ({ data }) => {
      if (data.type === 'hello') worker.postMessage({ type: 'create', mode: 'tutorial', name: 'WORKER STUDENT' });
      if (!data.tutorial) return; state = data; seen.add(data.tutorial.id);
      if (data.tutorial.completed) { cleanup(); resolve({ lessons: [...seen], phase: data.room.phase, result: data.room.result, deaths: data.players.find((p) => p.id === 'local-operator').deaths, elapsed: performance.now() - start }); }
    };
    const timer = setInterval(() => {
      if (!state) return; const p = state.players.find((p) => p.id === 'local-operator'), lesson = state.tutorial, now = performance.now();
      let input = { type: 'input', yaw: p.yaw, pitch: 0, spawnCount: p.spawnCount, equipmentSeq: p.equipmentSeq };
      const moveTo = (x, z) => { const distance = Math.hypot(x - p.x, z - p.z); input.yaw = Math.atan2(-(x - p.x), -(z - p.z)); input.forward = distance > .15 ? Math.min(.8, distance * 2) : 0; return distance; };
      if (lesson.id === 'movement') Object.assign(input, { forward: 1, sprint: true, yaw: .5 });
      if (lesson.id === 'terrain') {
        if (!phase) { phase = 'jump'; phaseAt = now; }
        if (phase === 'jump') { input.jump = now - phaseAt < 100; if (now - phaseAt > 1100 && p.grounded) { phase = 'crouch'; phaseAt = now; } }
        else if (phase === 'crouch') { input.crouch = true; if (now - phaseAt > 200) phase = 'approach'; }
        else if (phase === 'approach') { if (moveTo(6, 7.2) < .18) phase = 'stairs'; }
        else { input.yaw = 0; input.forward = .6; }
      }
      if (lesson.id === 'shooting' || lesson.id === 'combat') {
        const target = state.players.find((player) => player.isBot && player.hp > 0);
        if (target) { input.yaw = Math.atan2(-(target.x - p.x), -(target.z - p.z)); input.pitch = Math.atan2(target.y + 1.58 - p.y - 1.62, Math.hypot(target.x - p.x, target.z - p.z)); input.ads = true; }
        if (lesson.id === 'shooting' && lesson.goals[0].done) input.reload = true; else input.fire = true;
      }
      if (lesson.id === 'equipment') {
        const needsAction = !lesson.goals[0].done || lesson.goals[1].done && !lesson.goals[2].done;
        if (needsAction && now - lastAction > 500) { worker.postMessage({ type: 'equipment', roundId: state.room.roundId, spawnCount: p.spawnCount, equipmentSeq: p.equipmentSeq, actionSeq: ++action }); lastAction = now; }
      }
      if (lesson.id === 'respawn' && lesson.action?.enabled && now - lastAction > 500) { worker.postMessage({ type: 'tutorial-action', action: lesson.action.id, roundId: state.room.roundId, spawnCount: p.spawnCount }); lastAction = now; }
      worker.postMessage(input);
    }, 1000 / 30);
  }));
  expect(result.lessons).toEqual(['movement', 'terrain', 'shooting', 'equipment', 'combat', 'respawn']); expect(result.phase).toBe('training-complete'); expect(result.deaths).toBeGreaterThanOrEqual(1); expect(result.result).toBeNull();
});
