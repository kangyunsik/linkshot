import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createGameServer } from '../server/index.js';

// CPU/DOM microbenchmark only, not a claim about gameplay FPS or a user's GPU.
// Optional first argument: the Git revision to compare with the working tree.
const baseline = execFileSync('git', ['show', `${process.argv[2] || 'HEAD'}:public/game.js`], { encoding: 'utf8' });
const server = createGameServer({ port: 0, host: '127.0.0.1', loop: false });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let browser;
try {
  const { port } = await server.listen();
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  const results = {};
  for (const kind of ['baseline', 'workingTree']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    if (kind === 'baseline') await page.route('**/game.js', route => route.fulfill({ contentType: 'text/javascript', body: baseline }));
    await page.goto(`http://127.0.0.1:${port}`);
    results[kind] = await page.evaluate(async () => {
      const [{ FPSGame }, { Room }] = await Promise.all([import('/game.js'), import('/shared/simulation.js')]);
      const room = new Room('BENCH', { bots: 0, mapId: 'foundry' }), self = room.addPlayer('self', 'SELF');
      for (let i = 0; i < 5; i++) room.addPlayer(`peer-${i}`, `PEER ${i}`);
      const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), mapId: 'foundry', settings: { fov: 82, sensitivity: 1, quality: 'low' }, audio: { step() {}, stopReload() {} }, send() {}, onMenu() {}, onFatal(message) { throw new Error(message); } });
      try {
        game.applySnapshot(room.snapshot(), self.id); await game.prepareGraphics(); cancelAnimationFrame(game.frameId);
        let visualUpdates = 0;
        const update = game.combat.update.bind(game.combat); game.combat.update = (...args) => { visualUpdates++; update(...args); };
        const start = game.previousFrame;
        for (let i = 1; i <= 120; i++) { game.animate(start + i * 1000 / 60); cancelAnimationFrame(game.frameId); }
        room.finish(); game.applySnapshot(room.snapshot());
        let sentInputs = 0; game.send = data => { if (data.type === 'input') sentInputs++; };
        const observer = new MutationObserver(() => {}); observer.observe(document.getElementById('round-table'), { childList: true, subtree: true });
        const times = [];
        for (let i = 0; i < 100; i++) {
          const state = room.snapshot(), began = performance.now(); game.applySnapshot(state); times.push(performance.now() - began);
        }
        const mutations = observer.takeRecords().length; observer.disconnect(); times.sort((a, b) => a - b);
        const began = performance.now(), disposed = game.dispose(), disposeCallMs = performance.now() - began; await disposed;
        return { backgroundVisualUpdatesOver120Frames: visualUpdates, repeatedEndSnapshots: 100, endTableMutations: mutations, repeatedEndInputs: sentInputs, snapshotMedianMs: +times[50].toFixed(3), snapshotP95Ms: +times[95].toFixed(3), disposeCallMs: +disposeCallMs.toFixed(3) };
      } finally { await game.dispose(); }
    });
    await page.close();
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser?.close(); await server.close();
}
