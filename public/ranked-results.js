import { rankPresentation, PLACEMENT_MATCHES } from './rank-view.js';
import { rankResult } from './rank-result.js';
import { RANK_TIERS } from '../shared/ranks.js';

const $ = id => document.getElementById(id);
const signed = value => `${value >= 0 ? '+' : ''}${value}`;
const clamp = value => Math.max(0, Math.min(1, value));
const COUNT_MS = 2000, HANDOFF_MS = 1050, HANDOFF = HANDOFF_MS / COUNT_MS;
const absolutePoints = (tier, division, points) => tier === 'CHALLENGER' ? 2500 : (Math.max(0, RANK_TIERS.findIndex(entry => entry.id === tier) - 1) * 5 + 5 - division) * 100 + points;
const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };

export function rankedProgress(receipt, fraction) {
  const t = clamp(fraction);
  if (receipt.rankTierBefore === 'UNRANKED') {
    const placements = Math.min(PLACEMENT_MATCHES, receipt.placementsPlayed);
    const previous = Math.max(0, placements - 1);
    if (receipt.rankTier === 'UNRANKED') return { points: receipt.rankPointsAfter, progress: (previous + t) / PLACEMENT_MATCHES };
    if (t < HANDOFF) return { points: 0, progress: (previous + t / HANDOFF) / PLACEMENT_MATCHES };
    const points = Math.round(receipt.rankPointsAfter * ((t - HANDOFF) / (1 - HANDOFF)));
    return { points, progress: clamp(points / 100) };
  }
  const before = absolutePoints(receipt.rankTierBefore, receipt.rankDivisionBefore, receipt.rankPointsBefore);
  const after = absolutePoints(receipt.rankTier, receipt.rankDivision, receipt.rankPointsAfter);
  const position = Math.round(before + (after - before) * t);
  const points = t === 0 ? receipt.rankPointsBefore : t === 1 ? receipt.rankPointsAfter : position === 2500 ? 100 : position % 100;
  return { points, progress: clamp(points / 100) };
}

// The immutable receipt is the only source of RP. No prediction from kills,
// mutable profiles, or LP. Animation starts only when the result card is visible.
export class RankedResults {
  constructor() {
    this.root = $('ranked-results'); this.beforeMark = $('ranked-results-before-emblem'); this.mark = $('ranked-results-emblem'); this.pulse = this.mark.parentElement.querySelector('i');
    this.current = $('ranked-results-current'); this.delta = $('ranked-results-delta'); this.progress = $('ranked-results-progress'); this.mmr = $('ranked-results-mmr'); this.multiplier = $('ranked-results-multiplier');
    this.track = $('ranked-results-track'); this.bar = this.track.querySelector('i');
    this.reset();
  }
  reset() {
    cancelAnimationFrame(this.frame); this.root.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    this.root.hidden = true; this.matchId = null; this.receipt = null; this.revealed = false; this.animated = false; this.transition = '';
    delete this.root.dataset.transition; delete this.root.dataset.badge;
    this.beforeMark.hidden = true; this.mark.hidden = false;
  }
  pending(matchId) {
    if (this.matchId === matchId) return;
    this.reset(); this.matchId = matchId; this.root.hidden = false; this.root.dataset.phase = 'pending';
    $('ranked-results-mode').textContent = 'RANKED RESULT';
    $('ranked-results-transition').textContent = '정산 중'; this.delta.textContent = '…';
    this.current.textContent = ''; this.progress.textContent = '온라인 서버 정산을 기다리는 중'; this.mmr.hidden = true; this.multiplier.hidden = true; delete this.root.dataset.positive;
    $('ranked-results-tiers').textContent = ''; $('ranked-results-combat').textContent = '';
    this.mark.src = '/assets/ranks/unranked.svg?v=1'; this.paintProgress(0);
  }
  setReceipt(receipt) {
    this.pending(receipt.matchId);
    if (this.receipt) return;
    this.receipt = receipt; const result = rankResult(receipt), ladder = receipt.mode === 'CASUAL' ? 'ffa' : 'teams';
    this.before = rankPresentation({ rankTier: receipt.rankTierBefore, rankDivision: receipt.rankDivisionBefore, rankPoints: receipt.rankPointsBefore, placementsPlayed: Math.max(0, receipt.placementsPlayed - 1) }, ladder);
    this.after = rankPresentation({ rankTier: receipt.rankTier, rankDivision: receipt.rankDivision, rankPoints: receipt.rankPointsAfter, placementsPlayed: receipt.placementsPlayed }, ladder);
    this.transition = result.transitionKind; this.root.dataset.transition = this.transition;
    this.mmrDelta = receipt.ratingDelta ?? (receipt.mode === 'CASUAL' ? receipt.casualRatingDelta : null);
    this.mmr.hidden = !Number.isFinite(this.mmrDelta); this.multiplier.hidden = receipt.ratingMultiplier !== 2;
    this.root.dataset.positive = String(result.positive);
    $('ranked-results-mode').textContent = result.mode;
    $('ranked-results-transition').textContent = result.transition || (receipt.outcome === 'DRAW' ? '무승부' : receipt.won ? '승리' : '패배');
    $('ranked-results-tiers').textContent = this.transition ? `${this.before.label} → ${this.after.label}` : '';
    $('ranked-results-combat').textContent = `${receipt.kills ?? 0} K / ${receipt.deaths ?? 0} D / ${receipt.assists ?? 0} A`;
    this.mark.src = this.after.emblem; this.mark.hidden = !!this.transition;
    this.beforeMark.src = this.before.emblem; this.beforeMark.hidden = !this.transition;
    this.draw(0); if (this.revealed) this.animate();
  }
  reveal() { this.revealed = true; if (this.receipt && !this.animated) this.animate(); }
  paintProgress(progress) {
    this.bar.style.transform = `scaleX(${progress})`;
    this.track.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  }
  draw(t) {
    const receipt = this.receipt, { points, progress } = rankedProgress(receipt, t);
    const before = !!this.transition && t < HANDOFF;
    const badge = before ? 'before' : 'after';
    if (this.root.dataset.badge !== badge) this.root.dataset.badge = badge;
    text(this.current, before ? this.before.label : this.after.label);
    const delta = Math.round(receipt.rankPointsDelta * t);
    text(this.delta, `${signed(delta)} RP`);
    if (!this.mmr.hidden) text(this.mmr, `${signed(Math.round(this.mmrDelta * t))} MMR`);
    const placement = Math.min(PLACEMENT_MATCHES, receipt.placementsPlayed);
    text(this.progress, receipt.rankTier === 'UNRANKED' || this.transition === 'placement' && before
      ? `배치 ${this.transition === 'placement' && progress < .99 ? placement - 1 : placement} / ${PLACEMENT_MATCHES}` : `${points} RP · 서버 저장 완료`);
    this.paintProgress(progress);
  }
  playBadgeTransition() {
    const down = this.transition === 'demotion';
    this.mark.hidden = false;
    this.beforeMark.animate([
      { opacity: 1, transform: 'translateY(0) scale(1)' },
      { opacity: 0, transform: `translateY(${down ? 15 : -12}px) scale(.72)` },
    ], { delay: 620, duration: 460, fill: 'both', easing: 'ease-in-out' });
    this.mark.animate([
      { opacity: 0, transform: `translateY(${down ? -16 : 16}px) scale(.68)` },
      { opacity: 1, transform: `translateY(${down ? 3 : -3}px) scale(${down ? 1.03 : 1.16})`, offset: .65 },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], { delay: 810, duration: 720, fill: 'both', easing: 'cubic-bezier(.2,.8,.3,1)' });
    this.pulse.animate([
      { opacity: 0, transform: 'scale(.7)' }, { opacity: down ? .42 : .85, transform: 'scale(1)', offset: .28 }, { opacity: 0, transform: 'scale(1.52)' },
    ], { delay: 850, duration: 720, fill: 'both', easing: 'ease-out' });
  }
  complete() {
    this.beforeMark.hidden = true; this.mark.hidden = false;
    this.root.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    this.draw(1); this.root.dataset.phase = 'complete';
  }
  animate() {
    if (this.animated) return;
    this.animated = true; this.root.dataset.phase = 'counting';
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { this.complete(); return; }
    this.root.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 420, easing: 'ease-out' });
    if (this.transition) this.playBadgeTransition();
    const began = performance.now();
    const tick = now => {
      const fraction = clamp((now - began) / COUNT_MS);
      if (fraction < 1) { this.draw(fraction); this.frame = requestAnimationFrame(tick); }
      else this.complete();
    };
    this.frame = requestAnimationFrame(tick);
  }
}
