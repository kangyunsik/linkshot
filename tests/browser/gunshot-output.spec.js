import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('the actual Web Audio graph roughly doubles sniper reports, softens suppressors and keeps limiter output below clipping', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const reports = await page.evaluate(async () => {
    const { GameAudio } = await import('/audio.js'), reference = new GameAudio({ volume: 0 }); await reference.unlock(); await reference.ready; await reference.context.close();
    const NativeAudio = window.AudioContext, reports = [];
    try {
      for (const id of ['sniper', 'awp', 'm82', 'vector', 'shotgun', 'spas12', 's686']) for (const variant of ['baseline', 'current', 'suppressed']) {
        let offline;
        window.AudioContext = function () {
          offline = new OfflineAudioContext(2, 44100 * 3, 44100);
          return new Proxy(offline, { get(context, key) {
            if (key === 'state') return 'running'; if (key === 'resume') return async () => {};
            if (key === 'createBufferSource') return () => { const source = context.createBufferSource(), start = source.start.bind(source); source.start = (when = 0, ...args) => start(when + .15, ...args); return source; };
            const value = Reflect.get(context, key, context); return typeof value === 'function' ? value.bind(context) : value;
          } });
        };
        const audio = Object.assign(Object.create(GameAudio.prototype), { ...reference, settings: { volume: 100 }, context: null, ready: null, reloadReady: null, voices: new Set(), bytes: Promise.resolve([]), reloadBytes: Promise.resolve([]) });
        await audio.unlock(); await audio.ready; const voice = audio.shot(1, 0, id, 0, null, variant === 'suppressed'); if (variant === 'baseline') { voice.gain.gain.value = 1; if (voice.bass) voice.bass.gain.value = 0; }
        const gain = voice.gain.gain.value, rate = voice.source.playbackRate.value, output = await offline.startRendering(), data = output.getChannelData(0);
        let energy = 0, peak = 0, tail = 0; for (let i = 0; i < data.length; i++) { energy += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i])); if (i > 44100) tail += data[i] ** 2; }
        reports.push({ id, variant, gain, rate, peak, rms: Math.sqrt(energy / data.length), tail });
      }
      return reports;
    } finally { window.AudioContext = NativeAudio; }
  });
  await writeFile('artifacts/gunshot-output-metrics.json', JSON.stringify(reports, null, 2));
  for (const report of reports) { expect(report.rate).toBe(1); expect(report.peak).toBeGreaterThan(.01); expect(report.peak).toBeLessThan(.98); }
  for (const id of ['sniper', 'awp', 'm82', 'vector', 'shotgun', 'spas12', 's686']) {
    const baseline = reports.find((report) => report.id === id && report.variant === 'baseline'), current = reports.find((report) => report.id === id && report.variant === 'current'), quiet = reports.find((report) => report.id === id && report.variant === 'suppressed');
    expect(quiet.rms, id).toBeLessThan(current.rms * .6); expect(quiet.gain).toBeCloseTo(current.gain * .32, 6);
    if (['sniper', 'awp', 'm82'].includes(id)) { expect(current.gain).toBe(2); expect(current.rms, id).toBeGreaterThan(baseline.rms * 1.8); expect(current.rms, id).toBeLessThan(baseline.rms * 2.4); expect(current.tail, id).toBeGreaterThan(0); }
    else if (id !== 'vector') { expect(current.gain).toBeCloseTo(1.12, 6); expect(current.rms).toBeGreaterThan(baseline.rms); }
  }
});
