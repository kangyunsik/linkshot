import test from 'node:test';
import assert from 'node:assert/strict';
import { ratedBotBaseline, assignRatedBotDifficulties } from '../server/rated-bots.js';

const squad = (teamId, humans) => Array.from({ length: 3 }, (_, i) => ({ teamId, isBot: i >= humans }));
const botLevels = players => players.filter(p => p.isBot).map(p => p.botDifficulty);

test('the MMR offset is exactly +200 for FFA bot selection and never affects teams', () => {
  for (const [rating, teams, ffa] of [[899, 'beginner', 'beginner'], [900, 'beginner', 'intermediate'], [1299, 'intermediate', 'intermediate'], [1300, 'intermediate', 'advanced'], [1700, 'advanced', 'expert'], [2100, 'expert', 'extreme'], [9999, 'extreme', 'extreme']]) {
    assert.equal(ratedBotBaseline(rating, 'teams'), teams);
    assert.equal(ratedBotBaseline(rating, 'ffa'), ffa);
  }
  assert.equal(ratedBotBaseline(NaN, 'ffa'), 'beginner');
});

test('unreinforced slots roll lower/base/higher at 15/70/15 and clamp at the edges', () => {
  for (const [base, expected] of [
    ['beginner', { beginner: 85, intermediate: 15 }],
    ['intermediate', { beginner: 15, intermediate: 70, advanced: 15 }],
    ['advanced', { intermediate: 15, advanced: 70, expert: 15 }],
    ['expert', { advanced: 15, expert: 70, extreme: 15 }],
    ['extreme', { expert: 15, extreme: 85 }],
  ]) {
    const slots = Array.from({ length: 100 }, () => ({ isBot: true }));
    let i = 0; assignRatedBotDifficulties(slots, 'ffa', base, () => (i++ + .5) / 100);
    const counted = {};
    for (const level of botLevels(slots)) counted[level] = (counted[level] || 0) + 1;
    assert.deepEqual(counted, expected);
  }
});

test('equal human teams share opponent rolls, while the fewer-human side gets up to two harder bots', () => {
  for (let blueHumans = 0; blueHumans <= 3; blueHumans++) for (let redHumans = 0; redHumans <= 3; redHumans++) {
    const blue = squad('blue', blueHumans), red = squad('red', redHumans), players = [...blue, ...red];
    assignRatedBotDifficulties(players, 'teams', 'intermediate', () => .5);
    for (const player of players.filter(p => !p.isBot)) assert.equal(player.botDifficulty, undefined);
    const fewer = blueHumans < redHumans ? blue : redHumans < blueHumans ? red : [];
    const boosted = fewer.length ? Math.min(2, botLevels(fewer).length) : 0;
    assert.equal(botLevels(fewer).filter(level => level === 'advanced').length, boosted);
    assert.equal(botLevels(players).filter(level => level === 'advanced').length, boosted);
    assert.ok(botLevels(players).every(level => ['advanced', 'intermediate'].includes(level)));
  }
  const blue = squad('blue', 1), red = squad('red', 1);
  const rolls = [.05, .95];
  assignRatedBotDifficulties([...blue, ...red], 'teams', 'intermediate', () => rolls.shift());
  assert.deepEqual(botLevels(blue), ['beginner', 'advanced']); assert.deepEqual(botLevels(red), botLevels(blue));
  const smaller = squad('red', 0), larger = squad('blue', 2);
  assignRatedBotDifficulties([...larger, ...smaller], 'teams', 'extreme', () => .05);
  assert.equal(botLevels(smaller).filter(level => level === 'extreme').length, 2);
  assert.deepEqual(botLevels(larger), ['expert']);
});
