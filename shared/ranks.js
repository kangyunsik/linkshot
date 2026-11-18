export const RANK_TIERS = Object.freeze([
  { id: 'UNRANKED', name: '배치 중', icon: 'unranked' },
  { id: 'BRONZE', name: '브론즈', icon: 'bronze' },
  { id: 'SILVER', name: '실버', icon: 'silver' },
  { id: 'GOLD', name: '골드', icon: 'gold' },
  { id: 'PLATINUM', name: '플래티넘', icon: 'platinum' },
  { id: 'DIAMOND', name: '다이아', icon: 'diamond' },
  { id: 'CHALLENGER', name: '챌린저', icon: 'challenger' },
].map(Object.freeze));
const divisions = ['', 'I', 'II', 'III', 'IV', 'V'];
export function normalizeRankBadge(value) {
  if (!value || !RANK_TIERS.some(tier => tier.id === value.tier) || !['ffa', 'teams'].includes(value.ladder)) return null;
  return { tier: value.tier, ladder: value.ladder, division: Number.isInteger(value.division) && value.division >= 1 && value.division <= 5 ? value.division : 5 };
}
export function highestRank(profile) {
  if (!profile) return null;
  const candidates = ['teams', 'ffa'].map(ladder => {
    const rank = profile.competitive?.[ladder] || (ladder === 'teams' ? profile : null);
    const badge = normalizeRankBadge(rank && { tier: rank.rankTier, division: rank.rankDivision, ladder });
    return badge ? { badge, strength: badge.tier === 'UNRANKED' ? -1 : RANK_TIERS.findIndex(tier => tier.id === badge.tier) * 1000 + (5 - badge.division) * 150 + Math.max(0, Math.min(100, Number(rank.rankPoints) || 0)) } : null;
  }).filter(Boolean).sort((a, b) => b.strength - a.strength);
  return candidates[0]?.badge || null;
}
export function rankBadgeLabel(value) {
  const badge = normalizeRankBadge(value);
  if (!badge) return '랭크 정보 없음';
  const tier = RANK_TIERS.find(tier => tier.id === badge.tier);
  return `${badge.ladder === 'ffa' ? '개인전' : '팀전'} · ${tier.name}${['UNRANKED', 'CHALLENGER'].includes(tier.id) ? '' : ` ${divisions[badge.division]}`}`;
}
export function rankEmblem(tierId, ladder = 'teams') {
  const tier = RANK_TIERS.find(tier => tier.id === tierId) || RANK_TIERS[0];
  return `/assets/ranks/${ladder === 'ffa' ? 'ffa/' : ''}${tier.icon}.svg?v=1`;
}
