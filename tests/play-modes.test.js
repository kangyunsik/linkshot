import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAY_MODES, recordsLocalProgress } from '../public/play-modes.js';

test('six modes separate browser-local lessons/practice, LAN, rated matchmaking and WAN user rooms', () => {
  assert.deepEqual(PLAY_MODES.map((mode) => mode.id), ['casual', 'ranked', 'custom', 'lan', 'practice', 'tutorial']);
  assert.deepEqual(PLAY_MODES.map((mode) => mode.transport), ['online', 'online', 'custom', 'lan', 'local', 'local']);
  assert.match(PLAY_MODES.find((mode) => mode.id === 'ranked').description, /3:3 팀전/);
  assert.match(PLAY_MODES.find((mode) => mode.id === 'casual').description, /4인 개인전/);
});

test('tutorial and online snapshots cannot write local kill, mastery, point or round-award ledgers', () => {
  for (const mode of ['tutorial', 'casual', 'ranked', 'custom', undefined, 'unknown']) assert.equal(recordsLocalProgress({ mode }), false);
  for (const mode of ['lan', 'practice']) assert.equal(recordsLocalProgress({ mode }), true);
  for (const mode of ['lan', 'practice']) for (const gameType of ['hardpoint', 'defense']) assert.equal(recordsLocalProgress({ mode, gameType }), false);
});
