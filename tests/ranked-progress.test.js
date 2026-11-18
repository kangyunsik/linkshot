import test from 'node:test';
import assert from 'node:assert/strict';
import { rankedProgress } from '../public/ranked-results.js';

test('RP animation wraps through a promotion/demotion and lands on the immutable receipt', () => {
  const receipt = { rankTierBefore: 'BRONZE', rankDivisionBefore: 1, rankPointsBefore: 90, rankTier: 'SILVER', rankDivision: 5, rankPointsAfter: 16 };
  assert.deepEqual(rankedProgress(receipt, 0), { points: 90, progress: 0.9 });
  assert.deepEqual(rankedProgress(receipt, 1), { points: 16, progress: 0.16 });
  const down = { ...receipt, rankTierBefore: 'SILVER', rankDivisionBefore: 5, rankPointsBefore: 0, rankTier: 'BRONZE', rankDivision: 1, rankPointsAfter: 75 };
  assert.deepEqual(rankedProgress(down, 1), { points: 75, progress: 0.75 });
  for (const r of [receipt, down]) for (const t of [0, 0.25, 0.5, 0.75, 1]) { const p = rankedProgress(r, t); assert.ok(p.progress >= 0 && p.progress <= 1); }
});
test('placement animations show five-game progress, with no invented established rank', () => {
  const receipt = { rankTierBefore: 'UNRANKED', rankTier: 'UNRANKED', rankPointsAfter: 0, placementsPlayed: 3 };
  assert.equal(rankedProgress(receipt, 0).progress, 0.4); assert.equal(rankedProgress(receipt, 1).progress, 0.6);
  assert.equal(rankedProgress({ ...receipt, rankTier: 'GOLD', placementsPlayed: 5 }, 1).progress, 1);
});
