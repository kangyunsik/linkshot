import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FootstepTracker, footstepMix } from '../public/footsteps.js';
import { footstepSignal, killSignal } from '../public/sound-design.js';

const player = (extra = {}) => ({ x: 0, y: 0, z: 0, hp: 100, grounded: true, moveSpeed: 5.7, spawnCount: 1, ...extra });
const hash = (signal) => createHash('sha256').update(Buffer.from(signal.buffer)).digest('hex');

test('footsteps follow grounded travel distance at 30–144Hz and running is faster than crouching', () => {
  const counts = {};
  for (const [mode, speed] of [['walk', 5.7], ['sprint', 8.55], ['crouch', 2.565]]) for (const hz of [30, 60, 144]) {
    const tracker = new FootstepTracker(), steps = [];
    for (let frame = 0; frame <= hz * 3; frame++) {
      const step = tracker.update(player({ z: -speed * frame / hz, moveSpeed: speed, sprinting: mode === 'sprint', crouching: mode === 'crouch' }), frame * 1000 / hz);
      if (step) steps.push(step);
    }
    assert.ok(steps.length > 4); assert.ok(steps.every((step, i) => step.foot === i % 2)); counts[`${mode}/${hz}`] = steps.length;
  }
  for (const mode of ['walk', 'sprint', 'crouch']) assert.ok(Math.max(...[30, 60, 144].map((hz) => counts[`${mode}/${hz}`])) - Math.min(...[30, 60, 144].map((hz) => counts[`${mode}/${hz}`])) <= 1);
  assert.ok(counts['sprint/60'] > counts['walk/60'] && counts['walk/60'] > counts['crouch/60']);
});

test('standing, death, blocked movement and air travel never create queued or phantom footsteps', () => {
  const tracker = new FootstepTracker(); let now = 0;
  for (const state of [player({ moveSpeed: 0 }), player({ hp: 0 }), player({ grounded: false }), player()]) {
    for (let i = 0; i < 120; i++) { now += 1000 / 60; assert.equal(tracker.update({ ...state, x: state.grounded && state.hp > 0 ? 0 : i * 0.1 }, now), null); }
  }
  for (let i = 0; i < 60; i++) { now += 1000 / 60; assert.equal(tracker.update(player({ x: 0 }), now, { active: false }), null); }
  tracker.update(player({ x: 0, moveSpeed: 0 }), now + 16); assert.equal(tracker.update(player({ x: 0, moveSpeed: 0 }), now + 32), null);
});

test('respawn, teleports, invalid positions and stalled render frames reset footstep distance safely', () => {
  const tracker = new FootstepTracker(); tracker.update(player(), 0); tracker.update(player({ z: -1.5 }), 200);
  assert.equal(tracker.update(player({ x: 20, z: -1.5 }), 216, { teleport: true }), null);
  assert.equal(tracker.update(player({ x: 21, spawnCount: 2 }), 232), null);
  assert.equal(tracker.update(player({ x: 23, spawnCount: 2 }), 1232), null);
  assert.equal(tracker.update(player({ x: NaN }), 1248), null); assert.equal(tracker.position, null);
});

test('nearby footsteps are panned with the camera, attenuated by distance/height and quieter behind cover', () => {
  const listener = player(), right = footstepMix(listener, player({ x: 4 }));
  assert.equal(right.pan, 1); assert.equal(footstepMix(listener, player({ x: -4 })).pan, -1);
  assert.ok(footstepMix(listener, player({ x: 4 }), Math.PI).pan < -0.99);
  assert.ok(right.volume > footstepMix(listener, player({ x: 12 })).volume);
  assert.ok(right.volume > footstepMix(listener, player({ x: 4, y: 6 })).volume);
  const covered = footstepMix(listener, player({ x: 4 }), 0, true); assert.ok(covered.volume > 0 && covered.volume < right.volume);
  assert.equal(footstepMix(listener, player({ x: 27 })).volume, 0); assert.ok(footstepMix(listener, player({ x: 27, sprinting: true })).volume > 0);
  assert.equal(footstepMix(listener, player({ x: 15, crouching: true })).volume, 0); assert.equal(footstepMix({}, player()).volume, 0);
});

test('dry clacking heel/toe samples alternate feet, have two short contacts and no dragging noise tail', () => {
  const left = footstepSignal(), right = footstepSignal(44100, 1); assert.equal(hash(left), hash(footstepSignal())); assert.notEqual(hash(left), hash(right));
  for (const sampleRate of [22050, 44100, 48000]) for (const foot of [0, 1]) {
    const signal = footstepSignal(sampleRate, foot);
    assert.equal(signal.length, Math.round(sampleRate * .12)); assert.equal(signal[0], 0); assert.equal(signal.at(-1), 0);
    const peak = Math.max(...signal.map(Math.abs)), rms = Math.sqrt(signal.reduce((sum, value) => sum + value * value, 0) / signal.length);
    assert.ok(peak > 0.85 && peak < 0.9); assert.ok(rms > 0.08 && rms < 0.25);
    const energy = (from, to) => { const slice = signal.slice(Math.floor(from * sampleRate), Math.floor(to * sampleRate)); return Math.sqrt(slice.reduce((sum, value) => sum + value * value, 0) / slice.length); };
    assert.ok(energy(0, .025) > .1 && energy(.032, .06) > .08); assert.ok(energy(.09, .12) < energy(0, .025) * .025);
  }
});

test('footsteps emphasize a lower contact pitch rather than bright wood-block harmonics', () => {
  for (const foot of [0, 1]) {
    const signal = footstepSignal(44100, foot); let low = 0, lowEnergy = 0, total = 0;
    const alpha = 1 - Math.exp(-2 * Math.PI * 500 / 44100);
    for (const value of signal) { total += value * value; low += (value - low) * alpha; lowEnergy += low * low; }
    assert.ok(lowEnergy / total > .7, 'most step energy is in the lower body of the impact');
    let dominant = 0, largest = 0;
    for (let frequency = 150; frequency <= 1500; frequency += 25) {
      let real = 0, imaginary = 0;
      for (let i = 0; i < 1058; i++) { const angle = 2 * Math.PI * frequency * i / 44100; real += signal[i] * Math.cos(angle); imaginary += signal[i] * Math.sin(angle); }
      const power = real * real + imaginary * imaginary; if (power > largest) { largest = power; dominant = frequency; }
    }
    assert.ok(dominant >= 200 && dominant <= 350, `heel pitch ${dominant}Hz`);
  }
});

test('kill/multikill/headshot confirmations have distinct deterministic cues without clipping', () => {
  const profiles = new Set();
  for (let chain = 1; chain <= 8; chain++) for (const headshot of [false, true]) {
    const signal = killSignal(44100, chain, headshot); profiles.add(hash(signal)); assert.equal(hash(signal), hash(killSignal(44100, chain, headshot)));
    assert.ok(signal.length >= 44100 * 0.4 && signal.length <= 44100 * 0.6); assert.equal(signal[0], 0); assert.equal(signal.at(-1), 0);
    const peak = Math.max(...signal.map(Math.abs)); assert.ok(peak > 0.85 && peak < 0.9);
  }
  assert.equal(profiles.size, 16);
});
