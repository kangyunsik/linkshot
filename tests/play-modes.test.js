import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAY_MODES, recordsLocalProgress } from '../public/play-modes.js';

test('five modes separate browser-local lessons/practice, LAN and future online services', () => {
  assert.deepEqual(PLAY_MODES.map((mode) => mode.id), ['tutorial', 'practice', 'lan', 'casual', 'ranked']);
  assert.deepEqual(PLAY_MODES.map((mode) => mode.transport), ['local', 'local', 'lan', 'online', 'online']);
  assert.match(PLAY_MODES.at(-1).description, /실력 기반 4인 개인전/);
});

test('tutorial and online snapshots cannot write local kill, mastery, point or round-award ledgers', () => {
  for (const mode of ['tutorial', 'casual', 'ranked', undefined, 'unknown']) assert.equal(recordsLocalProgress({ mode }), false);
  for (const mode of ['lan', 'practice']) assert.equal(recordsLocalProgress({ mode }), true);
});
