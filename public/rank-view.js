// Original vector insignia; presentation only. Rank authority stays in Spring.
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
const bounded = (value, max) => Number.isFinite(value) ? Math.min(max,Math.max(0,Math.trunc(value))) : 0;

export function rankPresentation(profile) {
  const tier = RANK_TIERS.find((entry) => entry.id === profile?.rankTier) || RANK_TIERS[0];
  const valid = !!profile && RANK_TIERS.some((entry) => entry.id === profile.rankTier);
  const division = Number.isInteger(profile?.rankDivision) && profile.rankDivision >= 1 && profile.rankDivision <= 5 ? profile.rankDivision : 5;
  const games = bounded(profile?.placementsPlayed,10), wins = Math.min(games,bounded(profile?.placementWins,10)), points = bounded(profile?.rankPoints,1_000_000);
  const label = !profile ? '로그인 필요' : !valid ? '티어 확인 중' : tier.id === 'UNRANKED' || tier.id === 'CHALLENGER' ? tier.name : `${tier.name} ${divisions[division]}`;
  const detail = !profile ? '온라인 계정의 랭크를 확인하세요' : !valid ? '서버의 랭크 정보를 기다리고 있습니다.' : tier.id === 'UNRANKED' ? `배치 ${games}/10판 · ${wins}승` : `${points} 승급점수`;
  return { tier: tier.id, label, detail, cardLabel: !profile ? '랭크' : label, cardDetail: !profile ? '프로필에서 로그인' : detail, emblem: `/assets/ranks/${tier.icon}.svg?v=1`, progress: tier.id === 'UNRANKED' ? games * 10 : bounded(points,100), showProgress: valid && tier.id !== 'CHALLENGER' };
}

export function renderRankView(profile) {
  const state = rankPresentation(profile), $ = (id) => document.getElementById(id);
  $('rank-card').dataset.tier = state.tier; $('rank-dialog').dataset.tier = state.tier;
  $('rank-card').setAttribute('aria-label', `${state.label} · 내 랭크 상세 보기`);
  $('rank-card-tier').textContent = state.cardLabel; $('rank-card-progress').textContent = state.cardDetail;
  $('rank-detail-tier').textContent = state.label; $('rank-detail-progress').textContent = state.detail;
  $('rank-detail-note').textContent = !profile ? '우측 상단 프로필에서 로그인하면 서버에 저장된 내 티어가 표시됩니다.' : state.tier === 'UNRANKED' ? '랭크 10판의 배치를 마치면 최초 티어가 정해집니다. 승수는 서버에 기록된 배치 경기의 1위 횟수입니다.' : state.tier === 'CHALLENGER' ? '최상위 티어입니다. 표시는 서버가 판정한 현재 랭크를 사용합니다.' : '승급점수와 티어는 랭크 경기 결과에 따라 서버에서 갱신됩니다. 기기 LP·일반 점수와는 별개입니다.';
  for (const id of ['rank-card-emblem','rank-detail-emblem']) { const image = $(id); if (image.dataset.tier !== state.tier) { image.src = state.emblem; image.dataset.tier = state.tier; } }
  const progress = $('rank-detail-track'); progress.hidden = !state.showProgress; progress.setAttribute('aria-valuenow',String(state.progress)); progress.setAttribute('aria-valuetext',state.detail); progress.querySelector('i').style.width = `${state.progress}%`;
  $('rank-account-button').textContent = profile ? '온라인 프로필' : '프로필에서 로그인 / 회원가입';
  const ladder = $('rank-ladder');
  if (!ladder.children.length) for (const tier of RANK_TIERS.slice(1)) {
    const item = document.createElement('li'); item.dataset.tier = tier.id;
    const image = document.createElement('img'); image.src = `/assets/ranks/${tier.icon}.svg?v=1`; image.alt = ''; image.width = image.height = 72;
    const name = document.createElement('span'); name.textContent = tier.name; item.append(image,name); ladder.append(item);
  }
  for (const item of ladder.children) { if (profile && item.dataset.tier === state.tier) item.setAttribute('aria-current','step'); else item.removeAttribute('aria-current'); }
  return state;
}
