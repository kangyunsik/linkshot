import { test, expect } from '@playwright/test';

test('incoming cues render in stereo, soften with distance, and obey the sound controls', async ({ page }) => {
  await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/assets/sounds/*.wav?*', route => route.abort());
  await page.goto('/');
  const output = await page.evaluate(async () => {
    const { GameAudio } = await import('/audio.js');
    const NativeAudio = window.AudioContext, rate = 48000, offline = new OfflineAudioContext(2, rate * 2, rate);
    let at = 0;
    window.AudioContext = function () {
      return new Proxy(offline, { get(context, key) {
        if (key === 'state') return 'running';
        if (key === 'resume') return async () => {};
        if (key === 'currentTime') return at;
        const value = Reflect.get(context, key, context); return typeof value === 'function' ? value.bind(context) : value;
      } });
    };
    try {
      const audio = new GameAudio({ volume: 100 }); await audio.unlock();
      at = .16; audio.bulletPass({ distance: .35, pan: -.8 });
      at = .40; audio.bulletPass({ distance: 1.55, pan: .8 });
      at = .64; audio.bulletPass({ distance: .35, pan: -.8, endPan: .8 });
      at = .88; const body = audio.hurt({ damage: 30 });
      at = 1.12; const head = audio.hurt({ damage: 90, headshot: true });
      audio.muted = true; const muted = audio.hurt() === null && audio.bulletPass({ distance: .3 }) === null;
      audio.muted = false; audio.settings.volume = 0;
      const silent = audio.hurt() === null && audio.bulletPass({ distance: .3 }) === null;
      const rendered = await offline.startRendering();
      const rms = (from, to) => [0, 1].map(channel => {
        const frames = rendered.getChannelData(channel).subarray(Math.round(from * rate), Math.round(to * rate));
        return Math.sqrt(frames.reduce((sum, sample) => sum + sample ** 2, 0) / frames.length);
      });
      return {
        near: rms(.16, .30), far: rms(.40, .54), approach: rms(.649, .668), departure: rms(.685, .716),
        body: rms(.88, 1.04), head: rms(1.12, 1.28), muted, silent,
        distinct: head.source.buffer !== body.source.buffer && head.gain.gain.value > body.gain.gain.value,
        peak: Math.max(...[0, 1].map(channel => rendered.getChannelData(channel).reduce((max, sample) => Math.max(max, Math.abs(sample)), 0))),
      };
    } finally { window.AudioContext = NativeAudio; }
  });
  expect(output.near[0]).toBeGreaterThan(output.near[1] * 3);
  expect(output.far[1]).toBeGreaterThan(output.far[0] * 3);
  expect(output.near[0]).toBeGreaterThan(output.far[1] * 2);
  expect(output.approach[0]).toBeGreaterThan(output.approach[1]);
  expect(output.departure[1]).toBeGreaterThan(output.departure[0]);
  expect(output.body[0]).toBeGreaterThan(.008); expect(output.head[0]).toBeGreaterThan(.008);
  expect(output.peak).toBeLessThan(.98); expect(output.muted && output.silent && output.distinct).toBe(true);
});

test('incoming voices cap rapid overlaps, release when they finish, and can be stopped on exit', async ({ page }) => {
  await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { GameAudio } = await import('/audio.js'), audio = new GameAudio({ volume: 100 });
    await audio.unlock();
    audio.master.gain.cancelScheduledValues(audio.context.currentTime); audio.master.gain.value = 0;
    for (let i = 0; i < 10; i++) { audio.bulletPass({ distance: .4 }); audio.hurt(); }
    const { pass, impact } = audio.incomingVoices, count = () => [pass.size, impact.size];
    const capped = count();
    await Promise.all([...pass, ...impact].map(({ source }) => new Promise(resolve => source.addEventListener('ended', resolve, { once: true }))));
    const finished = count();
    audio.bulletPass({ distance: .4 }); audio.hurt(); audio.stopIncoming();
    await audio.context.close();
    return { capped, finished, stopped: count() };
  });
  expect(result).toEqual({ capped: [3, 4], finished: [0, 0], stopped: [0, 0] });
});
