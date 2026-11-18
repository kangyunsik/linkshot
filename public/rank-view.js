import { RANK_TIERS, rankEmblem } from '../shared/ranks.js';
export { RANK_TIERS } from '../shared/ranks.js';
const divisions = ['', 'I', 'II', 'III', 'IV', 'V'];
export const PLACEMENT_MATCHES = 5;
const bounded = (value, max) => Number.isFinite(value) ? Math.min(max,Math.max(0,Math.trunc(value))) : 0;

export function rankPresentation(profile, ladder = 'teams') {
  const tier = RANK_TIERS.find((entry) => entry.id === profile?.rankTier) || RANK_TIERS[0];
  const valid = !!profile && RANK_TIERS.some((entry) => entry.id === profile.rankTier);
  const division = Number.isInteger(profile?.rankDivision) && profile.rankDivision >= 1 && profile.rankDivision <= 5 ? profile.rankDivision : 5;
  const games = bounded(profile?.placementsPlayed,PLACEMENT_MATCHES), wins = Math.min(games,bounded(profile?.placementWins,PLACEMENT_MATCHES)), points = bounded(profile?.rankPoints,1_000_000);
  const label = !profile ? '로그인 필요' : !valid ? '티어 확인 중' : tier.id === 'UNRANKED' || tier.id === 'CHALLENGER' ? tier.name : `${tier.name} ${divisions[division]}`;
  const detail = !profile ? '온라인 계정의 랭크를 확인하세요' : !valid ? '서버의 랭크 정보를 기다리고 있습니다.' : tier.id === 'UNRANKED' ? `배치 ${games}/${PLACEMENT_MATCHES}판 · ${wins}승` : `${points} 승급점수`;
  return { tier: tier.id, label, detail, cardLabel: !profile ? '랭크' : label, cardDetail: !profile ? '프로필에서 로그인' : detail, emblem: rankEmblem(tier.id, ladder), progress: tier.id === 'UNRANKED' ? games / PLACEMENT_MATCHES * 100 : bounded(points,100), showProgress: valid && tier.id !== 'CHALLENGER' };
}

export function renderRankView(profile, name = '팀전 랭크', ladderKey = 'teams') {
  const state = rankPresentation(profile, ladderKey), $ = (id) => document.getElementById(id);
  $('rank-card').dataset.tier = state.tier; $('rank-dialog').dataset.tier = state.tier;
  $('rank-card').setAttribute('aria-label', `${state.label} · 내 랭크 상세 보기`);
  $('rank-card-tier').textContent = state.cardLabel; $('rank-card-progress').textContent = state.cardDetail;
  $('rank-card').querySelector('.card-eyebrow').textContent = `${name} / MY RANK`;
  $('rank-detail-tier').textContent = state.label; $('rank-detail-progress').textContent = state.detail;
  $('rank-detail-note').textContent = state.tier === 'UNRANKED' && profile ? `${name} 배치 ${PLACEMENT_MATCHES}판` : '';
  $('rank-dialog').querySelector('h2').textContent = name;
  for (const id of ['rank-card-emblem','rank-detail-emblem']) { const image = $(id); if (image.src !== new URL(state.emblem, location.href).href) image.src = state.emblem; image.dataset.tier = state.tier; image.dataset.ladder = ladderKey; }
  const progress = $('rank-detail-track'); progress.hidden = !state.showProgress; progress.setAttribute('aria-valuenow',String(state.progress)); progress.setAttribute('aria-valuetext',state.detail); progress.querySelector('i').style.width = `${state.progress}%`;
  $('rank-account-button').textContent = profile ? '온라인 프로필' : '프로필에서 로그인 / 회원가입';
  const ladder = $('rank-ladder');
  if (!ladder.children.length) for (const tier of RANK_TIERS.slice(1)) {
    const item = document.createElement('li'); item.dataset.tier = tier.id;
    const image = document.createElement('img'); image.src = rankEmblem(tier.id, ladderKey); image.alt = ''; image.width = image.height = 72;
    const name = document.createElement('span'); name.textContent = tier.name; item.append(image,name); ladder.append(item);
  }
  for (const item of ladder.children) { item.querySelector('img').src = rankEmblem(item.dataset.tier, ladderKey); if (profile && item.dataset.tier === state.tier) item.setAttribute('aria-current','step'); else item.removeAttribute('aria-current'); }
  return state;
}
