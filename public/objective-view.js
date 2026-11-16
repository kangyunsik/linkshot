import * as THREE from '/vendor/three.module.js';
import { TEAM_COLORS, TEAM_NAMES } from '/shared/teams.js';

const $ = (id) => document.getElementById(id);
const fraction = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
export class ObjectiveView {
  constructor(scene) {
    this.marker = new THREE.Mesh(new THREE.RingGeometry(.94, 1, 64), new THREE.MeshBasicMaterial({ color: '#f2cd89', transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false; this.marker.name = 'objective-marker'; scene.add(this.marker);
    this.occupation = new THREE.Mesh(new THREE.CircleGeometry(.94, 64), new THREE.MeshBasicMaterial({ color: '#f2cd89', transparent: true, opacity: .12, depthWrite: false, side: THREE.DoubleSide }));
    this.occupation.rotation.x = -Math.PI / 2; this.occupation.visible = false; this.occupation.name = 'objective-occupation'; scene.add(this.occupation);
    this.canvas = document.createElement('canvas'); this.canvas.width = 512; this.canvas.height = 160; this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.minFilter = THREE.LinearFilter; this.texture.generateMipmaps = false;
    this.billboard = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false }));
    this.billboard.scale.set(6.4, 2, 1); this.billboard.visible = false; this.billboard.name = 'objective-capture-billboard'; scene.add(this.billboard);
  }
  update(room) {
    const objective = room.objective, active = room.phase === 'active'; this.marker.visible = !!objective && active;
    const hardpoint = objective?.kind === 'hardpoint'; this.occupation.visible = !!hardpoint && active && (!!objective.owner || objective.contested); this.billboard.visible = !!hardpoint && active;
    if (!objective) return;
    if (objective.kind === 'hardpoint') {
      this.marker.position.set(objective.point.x, objective.point.y + .025, objective.point.z); this.marker.scale.setScalar(objective.point.radius);
      this.marker.material.color.set(objective.contested ? '#ff8a6b' : TEAM_COLORS[objective.owner] || '#f2cd89');
      this.occupation.position.copy(this.marker.position); this.occupation.position.y -= .005; this.occupation.scale.copy(this.marker.scale); this.occupation.material.color.copy(this.marker.material.color);
      this.billboard.position.set(objective.point.x, objective.point.y + 3.5, objective.point.z);
      const scores = room.teamScores || {}, key = [objective.point.id, objective.owner, objective.contested, scores.blue, scores.red, objective.scoreLimit].join('/');
      if (key !== this.billboardKey) {
        this.billboardKey = key; const ctx = this.context, color = this.marker.material.color.getStyle(), limit = objective.scoreLimit;
        ctx.clearRect(0, 0, 512, 160); ctx.fillStyle = '#10232bef'; ctx.fillRect(0, 0, 512, 160); ctx.fillStyle = color; ctx.fillRect(0, 0, 512, 5);
        ctx.textAlign = 'center'; ctx.font = 'bold 30px sans-serif'; ctx.fillText(`${objective.point.id} · ${objective.contested ? '경합 · 득점 정지' : objective.owner ? `${TEAM_NAMES[objective.owner]} 점령` : '거점 중립'}`, 256, 44);
        for (const [i, team] of ['blue', 'red'].entries()) {
          const x = 20 + i * 246, score = scores[team] || 0; ctx.fillStyle = TEAM_COLORS[team]; ctx.font = 'bold 22px sans-serif'; ctx.fillText(`${team.toUpperCase()}  ${score} / ${limit}`, x + 113, 90);
          ctx.fillStyle = '#46616b'; ctx.fillRect(x, 112, 226, 16); ctx.fillStyle = TEAM_COLORS[team]; ctx.fillRect(x, 112, 226 * fraction(score / limit), 16);
        }
        this.texture.needsUpdate = true;
      }
    } else {
      this.marker.position.set(objective.core.x, objective.core.y + objective.core.h + .025, objective.core.z); this.marker.scale.setScalar(2.6); this.marker.material.color.set(objective.core.hp < objective.core.maxHp * .3 ? '#ff817a' : '#8ee0c4');
    }
  }
}

export function updateObjectiveHud(room) {
  const objective = room.objective, panel = $('objective-hud'); panel.hidden = !objective;
  if (!objective) return;
  panel.dataset.kind = objective.kind;
  const title = $('objective-title'), detail = $('objective-detail'), track = $('objective-health'); $('hardpoint-gauges').hidden = objective.kind !== 'hardpoint';
  if (objective.kind === 'hardpoint') {
    title.textContent = `${objective.point.id} · ${objective.point.name}`;
    detail.textContent = `${objective.contested ? '교전 중 · 득점 정지' : objective.owner ? `${TEAM_NAMES[objective.owner]} 점유` : '중립 · 거점에 진입하세요'} · ${objective.changesIn}초 후 ${objective.nextPoint}`; track.hidden = true;
    const status = objective.contested ? 'contested' : objective.owner || 'neutral', progress = Math.round(fraction(objective.scoreProgress) * 100), capture = $('objective-capture-gauge');
    panel.dataset.control = status;
    $('objective-capture-label').textContent = objective.contested ? '경합 중 · 점령 득점 정지' : objective.owner ? `${TEAM_NAMES[objective.owner]} 점령 중` : '거점 중립';
    $('objective-capture-value').textContent = objective.owner ? `다음 +1점 · ${progress}%` : objective.contested ? '진행 일시 정지' : '진입 대기';
    capture.setAttribute('aria-valuenow', progress); capture.setAttribute('aria-valuetext', $('objective-capture-value').textContent); $('objective-capture-fill').style.width = `${progress}%`;
    for (const team of ['blue', 'red']) {
      const score = room.teamScores?.[team] || 0, gauge = $(`objective-${team}-gauge`); gauge.setAttribute('aria-valuemax', objective.scoreLimit); gauge.setAttribute('aria-valuenow', score);
      $(`objective-${team}-value`).textContent = `${score} / ${objective.scoreLimit}`; $(`objective-${team}-fill`).style.width = `${fraction(score / objective.scoreLimit) * 100}%`;
    }
    const rotation = $('objective-rotation-gauge'); rotation.setAttribute('aria-valuemax', objective.rotationSeconds); rotation.setAttribute('aria-valuenow', objective.changesIn); rotation.setAttribute('aria-valuetext', `${objective.changesIn}초 후 ${objective.nextPoint}로 이동`); $('objective-rotation-fill').style.width = `${fraction(objective.changesIn / objective.rotationSeconds) * 100}%`;
  } else {
    title.textContent = `${objective.phase === 'prepare' ? '공세 준비' : '방어 공세'} ${objective.wave} / ${objective.totalWaves}`;
    detail.textContent = `${objective.phase === 'prepare' ? `${objective.startsIn}초 후 시작` : `공세 AI ${objective.aliveEnemies}명 · 추가 진입 ${objective.pending}명`} · 코어 ${objective.core.hp}/${objective.core.maxHp}`;
    track.hidden = false; track.setAttribute('aria-valuenow', objective.core.hp); track.setAttribute('aria-valuemax', objective.core.maxHp); $('objective-health-fill').style.width = `${objective.core.hp / objective.core.maxHp * 100}%`;
  }
}
