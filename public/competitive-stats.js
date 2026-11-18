export const ladderKey = (mode) => mode === 'casual' || mode === 'ffa' ? 'ffa' : 'teams';
export const ladderName = (key) => key === 'ffa' ? '개인전 랭크' : '팀전 랭크';
export function ladderProfile(profile, key = 'teams') {
  if (!profile) return null;
  return profile.competitive?.[key] || (key === 'teams' ? profile : {});
}
const count = (value) => Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
export function competitiveStats(profile, key = 'teams') {
  const source = profile?.competitive?.[key], available = !!source && Number.isFinite(source.roundsPlayed);
  const games = count(source?.roundsPlayed), wins = Math.min(games, count(source?.wins)), draws = Math.min(games - wins, count(source?.draws));
  const kills = count(source?.kills), deaths = count(source?.deaths), assists = count(source?.assists);
  return { available, games, wins, draws, losses: games - wins - draws, kills, deaths, assists, winRate: games ? wins * 100 / games : 0, kda: (kills + assists) / Math.max(1, deaths), kd: kills / Math.max(1, deaths), recent: available && Array.isArray(source.recentMatches) ? source.recentMatches.slice(0, 10) : [] };
}
