import test from 'node:test';
import assert from 'node:assert/strict';
import { rankResult } from '../public/rank-result.js';

const receipt = { mode: 'RANKED', won: true, rankTierBefore: 'BRONZE', rankDivisionBefore: 1, rankPointsBefore: 90, rankTier: 'SILVER', rankDivision: 5, rankPointsAfter: 16, rankPointsDelta: 26, placementsPlayed: 5 };
test('result cards distinguish promotion, division demotion, placements, losses and draws using immutable receipts', () => {
  const promotion = rankResult(receipt); assert.equal(promotion.transition, '승급'); assert.equal(promotion.delta, '+26 RP'); assert.match(promotion.detail, /승리.*실버 V.*16 RP/);
  const demotion = rankResult({ ...receipt, won: false, rankTierBefore: 'SILVER', rankDivisionBefore: 5, rankTier: 'BRONZE', rankDivision: 1, rankPointsDelta: -25 });
  assert.equal(demotion.transition, '강등'); assert.equal(demotion.positive, false); assert.match(demotion.detail, /패배/);
  assert.equal(rankResult({ ...receipt, rankTierBefore: 'UNRANKED' }).transition, '배치 완료');
  const placementLoss = rankResult({ ...receipt, won: false, rankTierBefore: 'UNRANKED', rankTier: 'UNRANKED', rankPointsDelta: 0, placementsPlayed: 4 }); assert.match(placementLoss.detail, /패배.*배치 4\/5/);
  assert.match(rankResult({ ...receipt, outcome: 'DRAW', won: false, rankPointsDelta: 0 }).detail, /무승부/);
});
test('individual ranked results show their own tier, RP changes and promotions rather than the team ladder', () => {
  const result = rankResult({ ...receipt, mode: 'CASUAL', casualRatingDelta: 12 });
  assert.equal(result.mode, '개인전 랭크'); assert.equal(result.delta, '+26 RP'); assert.equal(result.transition, '승급'); assert.match(result.detail, /실버 V/);
});
