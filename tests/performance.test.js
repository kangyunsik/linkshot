import test from 'node:test';
import assert from 'node:assert/strict';
import { AvatarPoseSchedule, FrameStats, normalizeQuality, qualityPreset } from '../public/performance.js';

test('quality presets retain existing defaults and add a native-resolution balanced option', () => {
  assert.equal(normalizeQuality(undefined), 'normal'); assert.equal(normalizeQuality('toString'), 'normal'); assert.equal(normalizeQuality('balanced'), 'balanced');
  assert.equal(normalizeQuality({ toString: null }), 'normal'); assert.equal(normalizeQuality(null), 'normal');
  assert.deepEqual(qualityPreset('normal'), { pixelRatio: 1.65, shadowSize: 2048, lamps: true });
  assert.deepEqual(qualityPreset('balanced'), { pixelRatio: 1, shadowSize: 1024, lamps: true });
  assert.deepEqual(qualityPreset('low'), { pixelRatio: .75, shadowSize: 0, lamps: false });
});

test('visual pose scheduling preserves nearby updates and throttles distant/off-screen changes', () => {
  const weapon = {}, schedule = new AvatarPoseSchedule();
  assert.equal(schedule.update(0, true, 4, 0, 0, 0, weapon), true);
  assert.equal(schedule.update(1, true, 4, .1, 0, 0, weapon), true);
  assert.equal(schedule.update(2, true, 4, .1, 0, 0, weapon), false);
  assert.equal(schedule.update(3, false, 4, .2, 0, 0, weapon), false);
  assert.equal(schedule.update(101, false, 4, .2, 0, 0, weapon), true);
  assert.equal(schedule.update(102, true, 2500, .3, 0, 0, weapon), true, 're-entering view updates immediately');
  assert.equal(schedule.update(120, true, 2500, .4, 0, 0, weapon), false);
  assert.equal(schedule.update(136, true, 2500, .4, 0, 0, weapon), true);
  assert.equal(schedule.update(170, true, 2500, .4, 0, 0, {}), true, 'a replacement weapon invalidates the pose');
  schedule.reset(); assert.equal(schedule.update(171, true, 2500, .4, 0, 0, weapon), true);
});

test('frame metrics count rendered frames, report p95 and retain bounded samples', () => {
  const stats = new FrameStats(4), render = { calls: 42, triangles: 12345 };
  assert.equal(stats.summary().fps, 0);
  for (let i = 0; i <= 4; i++) stats.record(i * 100, 2 + i, render, 3);
  assert.deepEqual(stats.summary(), { fps: 10, frameP95Ms: 100, cpuP95Ms: 6, calls: 42, triangles: 12345, poseUpdates: 3 });
  stats.record(420, 1, render); assert.equal(stats.count, 4); assert.equal(stats.summary().fps, 13);
  for (let i = 1; i <= 4; i++) stats.record(420 + i * 20, 1, render);
  assert.equal(stats.summary().fps, 50); assert.equal(stats.summary().frameP95Ms, 20);
});
