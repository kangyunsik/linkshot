import { isTeamGame } from '/shared/game-types.js';

export function roundOutcome(room, players, selfId) {
  const self = players.find((player) => player.id === selfId), result = room.result;
  if (isTeamGame(room.gameType)) return !result?.winnerTeam ? 'draw' : self?.teamId === result.winnerTeam ? 'victory' : 'defeat';
  return result?.winnerId === selfId || result?.rewards?.[selfId]?.won ? 'victory' : 'defeat';
}

// Snapshot transitions, rather than transient events, also work after reconnect.
export class RoundEffects {
  constructor() {
    this.root = document.createElement('section'); this.root.id = 'round-effect'; this.root.className = 'round-effect'; this.root.hidden = true;
    this.root.setAttribute('role', 'status'); this.root.setAttribute('aria-live', 'polite');
    this.root.innerHTML = '<div class="round-effect-rays" aria-hidden="true"></div><div class="round-effect-card"><span class="eyebrow"></span><h2></h2><p></p><i class="round-effect-track" aria-hidden="true"></i></div>';
    this.root.querySelector('.round-effect-track').style.animation = 'none';
    document.getElementById('game-shell').append(this.root);
  }
  show(kind, label, title, detail, duration, done) {
    clearTimeout(this.timer); this.root.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    this.root.hidden = false; this.root.dataset.kind = kind; this.root.style.setProperty('--effect-duration', `${duration}ms`);
    this.root.querySelector('.eyebrow').textContent = label; this.root.querySelector('h2').textContent = title; this.root.querySelector('p').textContent = detail;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.root.querySelector('.round-effect-card').animate([{ opacity: 0, transform: 'scale(1.08)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 550, easing: 'cubic-bezier(.16,1,.3,1)' });
      this.root.querySelector('.round-effect-track').animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration, fill: 'forwards' });
    }
    this.timer = setTimeout(() => { this.root.hidden = true; this.resultActive = false; done?.(); }, duration);
  }
  update(room, players, selfId, onResult) {
    if (this.roundId !== room.roundId) { this.reset(); this.roundId = room.roundId; }
    if (room.phase === 'ended') {
      if (this.resultShown) return;
      this.resultShown = true; this.resultActive = true;
      const outcome = roundOutcome(room, players, selfId);
      this.show(outcome, 'OPERATION COMPLETE', outcome === 'victory' ? 'VICTORY' : outcome === 'defeat' ? 'DEFEAT' : 'DRAW', outcome === 'victory' ? '승리' : outcome === 'defeat' ? '패배' : '무승부', 5000, onResult);
      return;
    }
    const objective = room.objective;
    if (room.phase !== 'active' || objective?.kind !== 'defense') return;
    const key = `${objective.phase}/${objective.wave}`;
    if (this.waveKey === key) return; this.waveKey = key;
    if (objective.phase === 'wave') this.show('wave', 'INCOMING WAVE', `WAVE ${objective.wave}`, `공세 시작 · 적 ${objective.aliveEnemies + objective.pending}명`, 2600);
    else if (objective.cleared > 0) this.show('clear', 'WAVE COMPLETE', `WAVE ${objective.cleared} CLEAR`, `다음 공세 ${objective.wave}`, 2600);
  }
  reset() { clearTimeout(this.timer); this.root.hidden = true; this.resultActive = false; this.resultShown = false; this.waveKey = null; }
  dispose() { this.reset(); this.root.getAnimations({ subtree: true }).forEach((animation) => animation.cancel()); this.root.remove(); }
}
