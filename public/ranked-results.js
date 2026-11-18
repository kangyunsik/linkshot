import { rankPresentation, PLACEMENT_MATCHES } from './rank-view.js';
import { rankResult } from './rank-result.js';
import { RANK_TIERS } from '../shared/ranks.js';

const $ = id => document.getElementById(id);
const signed = value => `${value >= 0 ? '+' : ''}${value}`;
const step = (tier, division) => Math.max(0, RANK_TIERS.findIndex(entry => entry.id === tier) - 1) * 5 + 5 - division;
const clamp = value => Math.max(0, Math.min(1, value));

export function rankedProgress(receipt, fraction) {
  const t = clamp(fraction);
  if (receipt.rankTierBefore === 'UNRANKED') {
    const placements = Math.min(PLACEMENT_MATCHES, receipt.placementsPlayed);
    return { points: receipt.rankPointsAfter, progress: receipt.rankTier === 'UNRANKED' ? (Math.max(0, placements - 1) + t) / PLACEMENT_MATCHES : t };
  }
  const before = step(receipt.rankTierBefore, receipt.rankDivisionBefore) * 100 + receipt.rankPointsBefore;
  const after = step(receipt.rankTier, receipt.rankDivision) * 100 + receipt.rankPointsAfter;
  const points = t === 1 ? receipt.rankPointsAfter : ((Math.round(before + (after - before) * t) % 100) + 100) % 100;
  return { points, progress: receipt.rankTier === 'CHALLENGER' ? 1 : clamp(points / 100) };
}

// The immutable receipt is the only source of RP. No prediction from kills,
// mutable profiles, or LP. Animation starts only when the result card is visible.
export class RankedResults {
  constructor() { this.root = $('ranked-results'); this.reset(); }
  reset() {
    cancelAnimationFrame(this.frame); this.root.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    this.root.hidden = true; this.matchId = null; this.receipt = null; this.revealed = false; this.animated = false;
  }
  pending(matchId) {
    if (this.matchId === matchId) return;
    this.reset(); this.matchId = matchId; this.root.hidden = false; this.root.dataset.phase = 'pending';
    $('ranked-results-mode').textContent = 'RANKED RESULT';
    $('ranked-results-transition').textContent = '정산 중'; $('ranked-results-delta').textContent = '…';
    $('ranked-results-progress').textContent = '온라인 서버 정산을 기다리는 중';
    $('ranked-results-tiers').textContent = ''; $('ranked-results-combat').textContent = '';
    $('ranked-results-emblem').src = '/assets/ranks/unranked.svg?v=1'; this.paintProgress(0);
  }
  setReceipt(receipt) {
    this.pending(receipt.matchId);
    if (this.receipt) return;
    this.receipt = receipt; const result = rankResult(receipt), ladder = receipt.mode === 'CASUAL' ? 'ffa' : 'teams';
    this.before = rankPresentation({ rankTier: receipt.rankTierBefore, rankDivision: receipt.rankDivisionBefore, rankPoints: receipt.rankPointsBefore, placementsPlayed: Math.max(0, receipt.placementsPlayed - 1) }, ladder);
    this.after = rankPresentation({ rankTier: receipt.rankTier, rankDivision: receipt.rankDivision, rankPoints: receipt.rankPointsAfter, placementsPlayed: receipt.placementsPlayed }, ladder);
    this.root.dataset.positive = String(result.positive);
    $('ranked-results-mode').textContent = result.mode;
    $('ranked-results-transition').textContent = result.transition || (receipt.outcome === 'DRAW' ? '무승부' : receipt.won ? '승리' : '패배');
    $('ranked-results-tiers').textContent = `${this.before.label} → ${this.after.label}`;
    $('ranked-results-combat').textContent = `${receipt.kills ?? 0} K / ${receipt.deaths ?? 0} D / ${receipt.assists ?? 0} A`;
    this.draw(0); if (this.revealed) this.animate();
  }
  reveal() { this.revealed = true; if (this.receipt && !this.animated) this.animate(); }
  paintProgress(progress) {
    $('ranked-results-track').querySelector('i').style.transform = `scaleX(${progress})`;
    $('ranked-results-track').setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  }
  draw(t) {
    const receipt = this.receipt, { points, progress } = rankedProgress(receipt, t);
    $('ranked-results-delta').textContent = `${signed(Math.round(receipt.rankPointsDelta * t))} RP`;
    $('ranked-results-progress').textContent = receipt.rankTier === 'UNRANKED' ? `배치 ${Math.min(PLACEMENT_MATCHES, receipt.placementsPlayed)} / ${PLACEMENT_MATCHES}` : `${points} RP · 서버 저장 완료`;
    const emblem = t < 0.55 ? this.before.emblem : this.after.emblem, image = $('ranked-results-emblem');
    if (image.getAttribute('src') !== emblem) image.src = emblem;
    this.paintProgress(progress);
  }
  animate() {
    if (this.animated) return;
    this.animated = true; this.root.dataset.phase = 'counting';
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { this.draw(1); this.root.dataset.phase = 'complete'; return; }
    this.root.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 420, easing: 'ease-out' });
    const began = performance.now();
    const tick = now => {
      const fraction = clamp((now - began) / 1700); this.draw(1 - (1 - fraction) ** 3);
      if (fraction < 1) this.frame = requestAnimationFrame(tick);
      else { this.draw(1); this.root.dataset.phase = 'complete'; }
    };
    this.frame = requestAnimationFrame(tick);
  }
}
