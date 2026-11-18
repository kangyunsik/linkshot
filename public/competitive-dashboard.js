import { MAPS } from '/shared/world.js';
import { rankPresentation } from './rank-view.js';
import { competitiveStats, ladderProfile, ladderName } from './competitive-stats.js';
import { getPlayMode } from './play-modes.js';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const number = (value) => value >= 1000 ? compact.format(value) : value.toLocaleString('ko-KR');
const ratio = (value) => value < 10000 ? value.toFixed(2) : number(value);

// Rendering stays separate from accounts, matchmaking and device equipment.
export class CompetitiveDashboard {
  constructor() {
    const ids = ['competitive-hero', 'hero-rank-emblem', 'hero-rank-tier', 'hero-rank-progress', 'hero-rank-track', 'hero-ladder-name', 'dashboard-ffa', 'dashboard-teams', 'hero-record', 'hero-games', 'hero-winrate', 'hero-kda', 'hero-kd', 'hero-combat-counts', 'recent-match-list', 'recent-matches-count'];
    this.elements = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
    this.maps = new Map(MAPS.map(world => [world.id, world]));
  }
  render({ profile, key, mode, mapId }) {
    const nodes = this.elements, rank = rankPresentation(ladderProfile(profile, key), key), stats = competitiveStats(profile, key);
    nodes['competitive-hero'].dataset.tier = rank.tier; nodes['hero-rank-emblem'].src = rank.emblem;
    nodes['hero-rank-tier'].textContent = rank.cardLabel; nodes['hero-rank-progress'].textContent = profile ? rank.detail : '로그인';
    nodes['hero-rank-track'].hidden = !rank.showProgress; nodes['hero-rank-track'].querySelector('i').style.width = `${rank.progress}%`;
    nodes['hero-ladder-name'].textContent = `${ladderName(key)} · ${key === 'ffa' ? '4인' : '3:3'}`;
    for (const kind of ['ffa', 'teams']) nodes[`dashboard-${kind}`].setAttribute('aria-pressed', String(key === kind));
    nodes['hero-record'].textContent = stats.available ? `${number(stats.wins)}/${number(stats.draws)}/${number(stats.losses)}` : '—';
    nodes['hero-games'].textContent = stats.available ? `${number(stats.games)}경기` : '온라인 전적';
    nodes['hero-winrate'].textContent = stats.available ? `${stats.winRate.toFixed(1)}%` : '—';
    nodes['hero-kda'].textContent = stats.available ? ratio(stats.kda) : '—';
    nodes['hero-kd'].textContent = stats.available ? `K/D ${ratio(stats.kd)}` : 'K/D —';
    nodes['hero-combat-counts'].textContent = stats.available ? `${number(stats.kills)}/${number(stats.deaths)}/${number(stats.assists)}` : '—';
    nodes['hero-combat-counts'].title = stats.available ? `${stats.kills} K / ${stats.deaths} D / ${stats.assists} A` : '';
    nodes['hero-kda'].title = stats.available ? `(${stats.kills} K + ${stats.assists} A) / ${Math.max(1, stats.deaths)} D` : '';
    this.renderHistory(key, stats.recent);
    this.renderMap(mode, mapId);
  }
  renderHistory(key, matches) {
    const historyKey = JSON.stringify([key, matches]);
    if (historyKey === this.historyKey) return;
    this.historyKey = historyKey;
    const list = this.elements['recent-match-list']; list.replaceChildren();
    for (let index = 0; index < 10; index++) list.append(this.matchCard(matches[index], index));
    const wins = matches.filter(match => match.outcome === 'WIN').length, draws = matches.filter(match => match.outcome === 'DRAW').length;
    this.elements['recent-matches-count'].textContent = matches.length ? `${wins}승 ${matches.length - wins - draws}패${draws ? ` ${draws}무` : ''}` : '0 / 10';
  }
  matchCard(match, index) {
    const item = document.createElement('li'); item.className = 'recent-match';
    const thumbnail = document.createElement('div'); thumbnail.className = 'match-map-art';
    const serial = document.createElement('span'); serial.className = 'match-serial'; serial.textContent = String(index + 1).padStart(2, '0'); thumbnail.append(serial);
    const copy = document.createElement('div'); copy.className = 'match-copy';
    const status = document.createElement('b'); status.className = 'match-status';
    const mapName = document.createElement('span'); mapName.className = 'match-map-name';
    copy.append(status, mapName);
    if (!match) { item.classList.add('empty'); status.textContent = '—'; mapName.textContent = 'NO RECORD'; item.setAttribute('aria-label', '기록 없음'); item.append(thumbnail, copy); return item; }
    const result = match.outcome === 'WIN' ? '승리' : match.outcome === 'DRAW' ? '무승부' : '패배', world = this.maps.get(match.mapId), map = world?.title || '전장';
    item.dataset.outcome = match.outcome; item.dataset.match = match.matchId;
    const image = document.createElement('img'); image.src = world ? `/assets/${world.previewImage || world.image}` : '/favicon.svg'; image.alt = ''; image.decoding = 'async'; thumbnail.prepend(image);
    status.textContent = result; mapName.textContent = map;
    const score = document.createElement('div'); score.className = 'match-score';
    const combat = document.createElement('strong'), scoreLabel = document.createElement('small'); combat.textContent = `${number(match.kills)}/${number(match.deaths)}/${number(match.assists ?? 0)}`; scoreLabel.textContent = 'K / D / A'; score.append(combat, scoreLabel);
    const points = document.createElement('div'); points.className = 'match-points'; points.dataset.positive = String(match.rankPointsDelta >= 0);
    const delta = document.createElement('strong'), unit = document.createElement('small'); delta.textContent = `${match.rankPointsDelta >= 0 ? '+' : ''}${match.rankPointsDelta}`; unit.textContent = 'RP'; points.append(delta, unit);
    item.title = `${result} · ${map} · ${match.kills} K / ${match.deaths} D / ${match.assists ?? 0} A · ${points.textContent}`;
    item.setAttribute('aria-label', item.title); item.append(thumbnail, copy, score, points); return item;
  }
  renderMap(mode, mapId) {
    const root = document.querySelector('.selected-map'), world = this.maps.get(mapId) || MAPS[0], automatic = getPlayMode(mode).transport === 'online', training = mode === 'tutorial';
    root.hidden = false; root.dataset.selection = automatic ? 'automatic' : training ? 'training' : 'manual';
    document.getElementById('hero-map-name').textContent = automatic ? '매칭 시 자동 배정' : training ? 'TRAINING RANGE' : world.name;
    document.getElementById('hero-map-thumbnail').src = automatic || training ? '/favicon.svg' : `/assets/${world.previewImage || world.image}`;
    document.getElementById('hero-map-thumbnail').alt = automatic ? '랜덤 전장' : training ? '훈련장' : world.name;
    root.querySelector('small').textContent = automatic ? 'RANDOM MAP' : training ? 'TRAINING MAP' : 'SELECTED MAP';
    document.getElementById('briefing-button').disabled = automatic || training;
  }
}
