// Isolated real-browser frame/CPU benchmark. Artifacts never enter the build.
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGameServer } from '../server/index.js';
import { getMap } from '../shared/world.js';

const mapId = getMap(process.env.BENCH_MAP).id, seconds = Math.max(3, Math.min(120, Number(process.env.BENCH_SECONDS) || 10));
const tag = String(process.env.BENCH_TAG || '').replace(/[^A-Za-z0-9-]/g, '');
const server = createGameServer({ port: 0, host: '127.0.0.1', loop: false }); let browser;
try {
  const info = await server.listen(), chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(`http://127.0.0.1:${info.port}`);
  await page.evaluate(async (mapId) => {
    const [{ FPSGame }, { GameAudio }, { SoloConnection }] = await Promise.all([import('/game.js'), import('/audio.js'), import('/solo-connection.js')]);
    document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
    const connection = new SoloConnection(), settings = { sensitivity: 1, fov: 82, volume: 0, quality: 'normal' }, audio = new GameAudio(settings);
    const measure = { frames: [], work: [], snapshot: [], avatar: [], death: [], render: [], events: 0 }; let game, previous;
    function timed(object, method, array) { const original = object[method].bind(object); object[method] = (...args) => { const start = performance.now(); const value = original(...args); array.push(performance.now() - start); return value; }; }
    connection.addEventListener('message', ({ data: raw }) => {
      const data = JSON.parse(raw);
      if (data.type === 'hello') connection.send(JSON.stringify({ type: 'create', name: 'BENCHMARK', mapId, mode: 'practice', bots: 7, botDifficulty: 'advanced', fragLimit: 200, roundSeconds: 3600 }));
      if (data.type === 'joined') {
        game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), settings, audio, mapId, send: (data) => connection.send(JSON.stringify(data)), onMenu: (show) => { document.getElementById('pause-overlay').hidden = !show; }, onFatal: (message) => { throw new Error(message); } });
        timed(game, 'applySnapshot', measure.snapshot); timed(game, 'makeAvatar', measure.avatar); timed(game.combat, 'death', measure.death); timed(game, 'renderFrame', measure.render);
        const original = game.animate; game.animate = (now) => { const start = performance.now(); original(now); measure.work.push(performance.now() - start); if (previous) measure.frames.push(now - previous); previous = now; };
        game.applySnapshot(data, data.id); game.prepareGraphics(); document.getElementById('pause-overlay').hidden = false;
        document.getElementById('resume-button').addEventListener('click', () => game.lock()); window.__benchmark = { game, connection, measure, reset: () => { previous = undefined; for (const value of Object.values(measure)) if (Array.isArray(value)) value.length = 0; measure.events = 0; } };
      }
      if (data.type === 'state' && game) { game.applySnapshot(data); measure.events += data.events.length; }
    });
  }, mapId);
  await page.waitForFunction(() => window.__benchmark?.game.graphicsReady); await page.getByRole('button', { name: '교전 시작', exact: true }).click(); await page.evaluate(() => window.__benchmark.reset());
  const cdp = await page.context().newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
  await page.waitForTimeout(seconds * 1000); const profile = (await cdp.send('Profiler.stop')).profile;
  const result = await page.evaluate(() => {
    const { game, measure, connection } = window.__benchmark;
    const summary = (values) => { const sorted = [...values].sort((a, b) => a - b); return { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)] || 0, p95: sorted[Math.floor(sorted.length * .95)] || 0, max: sorted.at(-1) || 0 }; };
    const result = Object.fromEntries(Object.entries(measure).map(([key, values]) => [key, Array.isArray(values) ? summary(values) : values]));
    result.drawCalls = game.renderer.info.render.calls; result.triangles = game.renderer.info.render.triangles; result.corpses = game.combat.corpses.length; result.bulletMarks = game.bulletMarks.items.length;
    game.dispose(); connection.close(); return result;
  });
  const root = new URL('../artifacts/', import.meta.url); await mkdir(root, { recursive: true });
  await writeFile(new URL(`benchmark-${mapId}${tag ? `-${tag}` : ''}.cpuprofile`, root), JSON.stringify(profile)); await writeFile(new URL(`benchmark-${mapId}${tag ? `-${tag}` : ''}.json`, root), JSON.stringify(result, null, 2) + '\n');
  const top = [...profile.nodes].filter((node) => node.hitCount).sort((a, b) => b.hitCount - a.hitCount).slice(0, 12).map((node) => ({ fn: node.callFrame.functionName, hits: node.hitCount, file: node.callFrame.url.split('/').at(-1) }));
  console.log(JSON.stringify({ mapId, seconds, ...result, top }, null, 2));
} finally { await browser?.close(); await server.close(); }
