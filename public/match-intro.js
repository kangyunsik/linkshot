import { getMap } from '/shared/world.js';

export class MatchIntro {
  constructor(onCancel) {
    this.root = document.getElementById('match-intro'); this.value = document.getElementById('match-countdown-value'); this.map = document.getElementById('match-intro-map'); this.status = document.getElementById('match-intro-status');
    document.getElementById('match-intro-cancel').addEventListener('click', onCancel);
  }
  show() { clearTimeout(this.exitTimer); document.getElementById('lobby').inert = true; document.getElementById('game-shell').inert = true; this.root.hidden = false; this.root.dataset.phase = 'preparing'; this.value.textContent = '…'; this.map.textContent = '서버가 전장을 선정했습니다'; this.status.textContent = '참가자들의 전장 준비를 기다리고 있습니다.'; this.lastValue = null; document.getElementById('match-intro-cancel').focus(); }
  update(data) {
    if (this.root.hidden) return;
    this.map.textContent = getMap(data.room.mapId).name;
    if (data.room.phase === 'waiting') { this.root.dataset.phase = 'preparing'; this.value.textContent = '…'; this.status.textContent = `전장 준비 ${data.online?.ready || 0}/${data.online?.expected || 0}`; this.lastValue = null; return; }
    if (data.room.phase !== 'countdown') return;
    this.root.dataset.phase = 'countdown';
    const remaining = Math.max(0, data.online.countdownEndsAt - data.serverTime), value = Math.max(1, Math.ceil(remaining / 1000));
    this.root.style.setProperty('--count-progress', String(1 - remaining / (data.online.countdownMs || 5000))); this.status.textContent = '잠시 후 전장에 입장합니다 · 이동·사격 잠금';
    if (value !== this.lastValue) {
      this.lastValue = value; this.value.textContent = String(value); this.value.getAnimations().forEach((animation) => animation.cancel());
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) this.value.animate([{ opacity: 0, transform: 'scale(1.5)', filter: 'blur(5px)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }], { duration: 450, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  }
  hide() { clearTimeout(this.exitTimer); document.getElementById('lobby').inert = false; document.getElementById('game-shell').inert = false; this.value.getAnimations().forEach((animation) => animation.cancel()); this.root.hidden = true; }
  finish() { if (this.root.hidden) return; this.root.dataset.phase = 'go'; this.value.textContent = 'GO'; this.status.textContent = '전장 진입'; clearTimeout(this.exitTimer); this.exitTimer = setTimeout(() => this.hide(), 450); }
}
