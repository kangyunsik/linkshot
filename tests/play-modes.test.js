import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAY_MODES, recordsLocalProgress } from '../public/play-modes.js';

test('six modes separate browser-local lessons/practice, LAN, rated matchmaking and WAN user rooms', () => {
  assert.deepEqual(PLAY_MODES.map((mode) => mode.id), ['tutorial', 'practice', 'lan', 'casual', 'ranked', 'custom']);
  assert.deepEqual(PLAY_MODES.map((mode) => mode.transport), ['local', 'local', 'lan', 'online', 'online', 'custom']);
  assert.match(PLAY_MODES.find((mode) => mode.id === 'ranked').description, /실력 기반 4인 개인전/);
});

test('tutorial and online snapshots cannot write local kill, mastery, point or round-award ledgers', () => {
  for (const mode of ['tutorial', 'casual', 'ranked', 'custom', undefined, 'unknown']) assert.equal(recordsLocalProgress({ mode }), false);
  for (const mode of ['lan', 'practice']) assert.equal(recordsLocalProgress({ mode }), true);
});
