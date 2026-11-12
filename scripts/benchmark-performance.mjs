import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createGameServer } from '../server/index.js';

// Isolated, repeatable CPU microbenchmarks, not a claim about real gameplay FPS.
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server = createGameServer({ port: 0, host: '127.0.0.1', loop: false });
let browser;
try {
  const { port } = await server.listen();
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(`http://127.0.0.1:${port}`);
  const result = await page.evaluate(async () => {
    const [{ FPSGame }, { Room }, { poseOperator }] = await Promise.all([import('/game.js'), import('/shared/simulation.js'), import('/operator-model.js')]);
    const room = new Room('BENCH', { mapId: 'blocknine', bots: 0 });
    const player = room.addPlayer('viewer', 'VIEWER');
    for (let i = 0; i < 7; i++) room.addPlayer(`other-${i}`, `OTHER ${i}`);
    const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), mapId: room.world.id, settings: { sensitivity: 1, fov: 82, quality: 'normal' }, audio: { step() {}, stopReload() {} }, send() {}, onMenu() {}, onFatal(message) { throw new Error(message); } });
    try {
      game.applySnapshot(room.snapshot(), player.id); await game.prepareGraphics(); cancelAnimationFrame(game.frameId);
      const sample = (run, count = 120) => {
        for (let i = 0; i < 20; i++) run(i);
        const times = [];
        for (let i = 0; i < count; i++) { const start = performance.now(); run(i); times.push(performance.now() - start); }
        times.sort((a, b) => a - b);
        return { medianMs: +times[Math.floor(times.length / 2)].toFixed(3), p95Ms: +times[Math.floor(times.length * .95)].toFixed(3) };
      };
      const avatars = [...game.remote.values()];
      const pose = sample((i) => { for (const avatar of avatars) poseOperator(avatar, (i % 30) / 30, Math.sin(i * .1) * .3); });
      const box = room.world.obstacles.find((box) => box.buildingId && box.h > 1), surface = { point: { x: box.x, y: box.y + box.h / 2, z: box.z + box.d / 2 }, normal: { x: 0, y: 0, z: 1 } };
      const origin = { ...surface.point, z: surface.point.z + 1 };
      const impact = sample(() => { for (let i = 0; i < 10; i++) game.bulletMarks.refine(surface, origin); });
      const death = sample(() => { game.combat.death(player); game.combat.update(performance.now() + 11_000, 1 / 60); }, 60);
      return { map: room.world.id, remotePlayers: avatars.length, staticScenery: game.sceneryStats, poseSevenPlayers: pose, refineTenImpacts: impact, createAndRetireCorpse: death };
    } finally { await game.dispose(); }
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
