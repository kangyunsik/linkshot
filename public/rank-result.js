import { RANK_TIERS, rankPresentation, PLACEMENT_MATCHES } from './rank-view.js';

const signed = (value) => `${value >= 0 ? '+' : ''}${value}`;
const position = (tier, division) => RANK_TIERS.findIndex((entry) => entry.id === tier) * 5 + 5 - division;

export function rankResult(receipt) {
  const won = receipt.won ?? receipt.winBonus > 0, result = receipt.abandoned ? '탈주' : receipt.outcome === 'DRAW' ? '무승부' : won ? '승리' : '패배';
  const after = rankPresentation({ rankTier: receipt.rankTier, rankDivision: receipt.rankDivision, rankPoints: receipt.rankPointsAfter, placementsPlayed: receipt.placementsPlayed });
  const change = receipt.rankTierBefore && receipt.rankTierBefore !== 'UNRANKED' ? position(receipt.rankTier, receipt.rankDivision) - position(receipt.rankTierBefore, receipt.rankDivisionBefore) : 0;
  const transition = receipt.rankTierBefore === 'UNRANKED' && receipt.rankTier !== 'UNRANKED' ? '배치 완료' : change > 0 ? '승급' : change < 0 ? '강등' : '';
  return { mode: receipt.mode === 'CASUAL' ? '개인전 랭크' : '팀전 랭크', delta: `${signed(receipt.rankPointsDelta)} RP`, detail: [transition, result, after.label, receipt.rankTier === 'UNRANKED' ? `배치 ${Math.min(PLACEMENT_MATCHES, receipt.placementsPlayed)}/${PLACEMENT_MATCHES}` : `${receipt.rankPointsAfter} RP`].filter(Boolean).join(' · '), transition, positive: receipt.rankPointsDelta >= 0 };
}
