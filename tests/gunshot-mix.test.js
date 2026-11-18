import test from 'node:test';
import assert from 'node:assert/strict';
import { gunshotMix, gunshotRange } from '../public/gunshot-mix.js';

test('sniper gain is exactly twice the unsuppressed gunshot gain and adds body without changing the recording pitch', () => {
  const ordinary = gunshotMix('ASSAULT'), sniper = gunshotMix('SNIPER'); assert.equal(ordinary.gain, 1); assert.equal(sniper.gain, 2); assert.equal(sniper.bassDB, 2); assert.equal(ordinary.bassDB, 0);
  assert.equal(gunshotMix('SNIPER', false, .25).gain, .5); assert.equal(gunshotMix('SNIPER', false, 99).gain, 2); assert.equal(gunshotMix('SNIPER', false, NaN).gain, 0);
});

test('shotguns keep a weightier but bounded report, reduce harsh top end and retain suppressor attenuation', () => {
  const mix = gunshotMix('SHOTGUN'), ordinary = gunshotMix('ASSAULT');
  assert.equal(mix.gain, 1.12); assert.equal(mix.bassDB, 2); assert.ok(mix.cutoff < ordinary.cutoff);
  assert.equal(gunshotMix('SHOTGUN', true).gain, mix.gain * .32);
  assert.equal(gunshotMix('SHOTGUN', false, 0).gain, 0);
  assert.ok(gunshotMix('SHOTGUN', false, 1, 35).cutoff < mix.cutoff);
});

test('suppressors reduce both report gain and audible distance, with a lower spectral cutoff', () => {
  for (const type of ['ASSAULT', 'SMG', 'SHOTGUN', 'SNIPER', 'SIDEARM', 'LMG', 'DMR']) {
    const loud = gunshotMix(type), quiet = gunshotMix(type, true); assert.equal(quiet.gain, loud.gain * .32); assert.ok(quiet.cutoff < loud.cutoff); assert.equal(quiet.bassDB, 0);
  }
  assert.equal(gunshotRange(false), 45); assert.equal(gunshotRange(true), 22); assert.equal(gunshotRange('true'), 45);
});
