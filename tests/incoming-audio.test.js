import test from 'node:test';
import assert from 'node:assert/strict';
import { BULLET_PASS_RADIUS, incomingBulletPass, incomingImpactPan } from '../public/incoming-audio.js';
import { bulletPassSignal, incomingImpactSignal } from '../public/sound-design.js';

const standing = { x: 0, y: 0, z: 0 }, world = { width: 22, depth: 22, obstacles: [] };
const ray = (x = .66, from = 8, to = -8, y = 1.45) => ({
  id: 'someone-else', origin: { x, y, z: from }, rays: [{ end: { x, y, z: to } }],
});
const listen = (event, listener = standing, yaw = 0, map = world) => incomingBulletPass(event, listener, yaw, 'viewer', map);

test('near misses pan at the closest point, and side-to-side bullets sweep the stereo field', () => {
  const right = listen(ray()), left = listen(ray(-.66));
  assert.equal(right.distance, .66); assert.ok(right.pan > .7 && right.endPan === right.pan);
  assert.equal(left.pan, -right.pan);
  assert.ok(Math.abs(listen(ray(), standing, Math.PI).pan + right.pan) < 1e-10);
  const past = listen({ ...ray(), origin: { x: -9, y: 1.45, z: .72 }, rays: [{ end: { x: 9, y: 1.45, z: .72 } }] });
  assert.ok(past.pan < -.25 && past.endPan > .25);
  assert.equal(incomingImpactPan(standing, { x: 7, z: 0 }, 0), .25);
  assert.equal(incomingImpactPan(standing, null, 0), 0);
});

test('only the finite, unobstructed nearby part of a foreign shot makes a flyby', () => {
  assert.equal(listen(ray(BULLET_PASS_RADIUS + .1)), null);
  assert.equal(listen(ray(.66, 8, .2)), null); // stopped at a wall before reaching the listener
  assert.equal(listen(ray(.66, -.1, -8)), null); // moving away from the listener
  assert.ok(listen(ray(.66, 8, -.5))); // passed the ear before striking something
  const wall = { x: .33, y: 0, z: 0, w: .16, d: 8, h: 3 };
  assert.equal(listen(ray(), standing, 0, { ...world, obstacles: [wall] }), null);
  assert.equal(listen({ ...ray(), id: 'viewer' }), null);
  assert.equal(listen({ ...ray(), melee: true }), null);
  const high = { x: 0, y: 3, z: 0 };
  assert.equal(listen(ray(), high), null);
  assert.ok(listen(ray(.3, 8, -8, 3.75), { ...high, crouching: true }).distance < .34);
});

test('shotgun pellets make one closest cue, but an actual hit takes precedence', () => {
  const shot = ray();
  shot.rays = [{ end: { x: .66, y: 1.45, z: -8 } }, { end: { x: .05, y: 1.45, z: -8 } }];
  const mix = listen(shot);
  assert.ok(mix.distance < .37); assert.ok(mix.pan > mix.endPan);
  for (const flag of ['hit', 'protectedTarget', 'friendlyTarget']) {
    assert.equal(listen({ ...shot, rays: [...shot.rays, { ...shot.rays[0], [flag]: 'viewer' }] }), null);
  }
});

test('short procedural whizzes and body hits are bounded, distinct, and finish in silence', () => {
  const rate = 48000;
  const roughness = samples => samples.reduce((sum, value, i) => sum + (i ? (value - samples[i - 1]) ** 2 : 0), 0) / samples.reduce((sum, value) => sum + value * value, 0);
  for (const variant of [0, 1, 2]) {
    const cues = [bulletPassSignal(rate, variant), incomingImpactSignal(rate, false, variant), incomingImpactSignal(rate, true, variant)];
    for (const cue of cues) {
      assert.ok(cue.length < rate * .15 && cue.length > rate * .085);
      assert.equal(cue[0], 0); assert.equal(cue.at(-1), 0);
      assert.ok(cue.every(n => Number.isFinite(n) && Math.abs(n) <= .89));
      assert.ok(cue.some(n => n > .4));
      const late = cue.subarray(Math.floor(rate * .079)).reduce((sum, n) => sum + n * n, 0);
      const total = cue.reduce((sum, n) => sum + n * n, 0);
      assert.ok(late / total < .08);
    }
    assert.ok(roughness(cues[0]) > roughness(cues[1]) * 5);
    assert.ok(roughness(cues[2]) > roughness(cues[1]));
  }
});
