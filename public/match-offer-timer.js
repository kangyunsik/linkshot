export class MatchOfferTimer {
  constructor() {
    this.tracks = ['matchmaking-acceptance-track', 'dialog-acceptance-track'].map((id, index) => {
      const root = document.createElement('div'); root.id = id; root.className = 'acceptance-track'; root.hidden = true;
      root.setAttribute('role', 'progressbar'); root.setAttribute('aria-label', '매칭 수락 남은 시간'); root.setAttribute('aria-valuemin', '0'); root.setAttribute('aria-valuemax', '15');
      root.append(document.createElement('i'));
      if (index) document.getElementById('online-accept-match').before(root);
      else document.getElementById('matchmaking-widget').append(root);
      return root;
    });
  }
  update(state) {
    const deadline = Date.parse(state?.acceptanceDeadline), serverTime = Date.parse(state?.serverTime);
    const active = ['OFFERED', 'ACCEPTED'].includes(state?.state) && Number.isFinite(deadline) && Number.isFinite(serverTime);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const key = active ? `${state.matchId}/${deadline}/${reduced}` : null;
    for (const root of this.tracks) {
      root.hidden = !active;
      const fill = root.firstElementChild, remaining = active ? Math.max(0, Math.min(15000, deadline - serverTime)) : 0;
      root.setAttribute('aria-valuenow', String(Math.ceil(remaining / 1000))); root.setAttribute('aria-valuetext', `${Math.ceil(remaining / 1000)}초`);
      if (key !== this.key || reduced) {
        fill.getAnimations().forEach(animation => animation.cancel());
        fill.style.transform = `scaleX(${remaining / 15000})`;
        if (active && !reduced && remaining) fill.animate([{ transform: `scaleX(${remaining / 15000})` }, { transform: 'scaleX(0)' }], { duration: remaining, easing: 'linear', fill: 'forwards' });
      }
    }
    this.key = key;
  }
}
