import test from 'node:test';
import assert from 'node:assert/strict';
import { compileViewmodelPrograms, renderViewmodelFrame } from '../public/viewmodel-renderer.js';

function fixture() {
  const calls = [], camera = { layers: { mask: 5, set(layer) { this.mask = 1 << layer; } } }, background = {}, scene = { background };
  const renderer = { autoClear: true, info: { autoReset: true, reset() { calls.push('reset'); } }, shadowMap: { autoUpdate: true },
    render(_scene, camera) { calls.push({ mask: camera.layers.mask, background: scene.background, clear: this.autoClear, shadows: this.shadowMap.autoUpdate }); },
    clearDepth() { calls.push('depth'); }, async compileAsync(_scene, camera) { calls.push(camera.layers.mask); } };
  return { calls, camera, renderer, scene, background };
}

test('viewmodel rendering preserves the world image, clears only depth and renders internally occluded hands once', () => {
  const f = fixture(); renderViewmodelFrame(f.renderer, f.scene, f.camera, { visible: true });
  assert.deepEqual(f.calls, ['reset', { mask: 1, background: f.background, clear: true, shadows: true }, 'depth', { mask: 2, background: null, clear: false, shadows: false }]);
  assert.equal(f.camera.layers.mask, 5); assert.equal(f.scene.background, f.background); assert.equal(f.renderer.autoClear, true); assert.equal(f.renderer.info.autoReset, true); assert.equal(f.renderer.shadowMap.autoUpdate, true);
});

test('a scoped, dead or hidden first-person model never adds an empty overlay pass', () => {
  const f = fixture(); renderViewmodelFrame(f.renderer, f.scene, f.camera, { visible: false });
  assert.equal(f.calls.length, 2); assert.equal(f.camera.layers.mask, 5);
});

test('viewmodel renderer state and shader preparation restore camera and clear state even after an error', async () => {
  const f = fixture(); await compileViewmodelPrograms(f.renderer, f.scene, f.camera); assert.deepEqual(f.calls, [1, 2]); assert.equal(f.camera.layers.mask, 5);
  f.renderer.render = () => { if (f.camera.layers.mask === 2) throw new Error('overlay'); };
  assert.throws(() => renderViewmodelFrame(f.renderer, f.scene, f.camera, { visible: true }), /overlay/);
  assert.equal(f.camera.layers.mask, 5); assert.equal(f.scene.background, f.background); assert.equal(f.renderer.autoClear, true); assert.equal(f.renderer.info.autoReset, true); assert.equal(f.renderer.shadowMap.autoUpdate, true);
  f.renderer.compileAsync = async () => { throw new Error('compile'); }; await assert.rejects(compileViewmodelPrograms(f.renderer, f.scene, f.camera), /compile/); assert.equal(f.camera.layers.mask, 5);
});
