import { getMap } from '/shared/world.js';

export class MatchIntro {
  constructor(onCancel) {
    this.root = document.getElementById('match-intro'); this.value = document.getElementById('match-countdown-value'); this.map = document.getElementById('match-intro-map'); this.status = document.getElementById('match-intro-status');
    document.getElementById('game-shell').append(this.root);
    document.getElementById('match-intro-cancel').addEventListener('click', onCancel);
  }
  show() { clearTimeout(this.exitTimer); document.getElementById('lobby').inert = true; this.root.hidden = false; this.root.dataset.phase = 'preparing'; this.value.textContent = '…'; this.map.textContent = ''; this.status.textContent = '전장 준비 중'; this.lastValue = null; }
  update(data) {
    if (this.root.hidden) return;
    this.map.textContent = getMap(data.room.mapId).name;
    if (data.room.phase === 'waiting') { this.root.dataset.phase = 'preparing'; this.value.textContent = '…'; this.status.textContent = `전장 준비 ${data.online?.ready || 0}/${data.online?.expected || 0}`; this.lastValue = null; return; }
    if (data.room.phase !== 'countdown') return;
    this.root.dataset.phase = 'countdown';
    const remaining = Math.max(0, data.online.countdownEndsAt - data.serverTime), value = remaining > 0 ? String(Math.ceil(remaining / 1000)) : '준비';
    this.root.style.setProperty('--count-progress', String(Math.min(1, 1 - remaining / (data.online.countdownMs || 5000)))); this.status.textContent = remaining > 0 ? data.room.gameType === 'teams' ? `3 VS 3 · ${data.room.fragLimit} KILLS · TEAM RANKED` : '4 PLAYERS · FFA RANKED' : `시작 시각 도달 · 플레이어 준비 ${data.online.ready}/${data.online.expected}`;
    if (value !== this.lastValue) {
      this.lastValue = value; this.value.textContent = String(value); this.value.getAnimations().forEach((animation) => animation.cancel());
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) this.value.animate([{ opacity: 0, transform: 'scale(1.3)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 350, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  }
  hide() { clearTimeout(this.exitTimer); document.getElementById('lobby').inert = false; this.value.getAnimations().forEach((animation) => animation.cancel()); this.root.hidden = true; }
  finish() { if (this.root.hidden) return; this.root.dataset.phase = 'go'; this.value.textContent = 'GO'; this.status.textContent = '전장 진입'; clearTimeout(this.exitTimer); this.exitTimer = setTimeout(() => this.hide(), 450); }
}
