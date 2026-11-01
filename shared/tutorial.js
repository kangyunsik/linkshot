import { Room } from './simulation.js';
import { EMPTY_INPUT, angleDelta } from './movement.js';
import { getWeapon } from './catalog.js';
import { playerPose, RULES } from './world.js';
import { TRAINING_WORLD } from './training-world.js';

export const TUTORIAL_STEPS = Object.freeze([
  { id: 'movement', title: '시점과 이동', description: '마우스로 둘러보고 WASD로 이동하세요. W + Shift로 달리기도 해보세요.', marker: { x: 0, y: 0, z: 9 } },
  { id: 'terrain', title: '지형과 엄폐', description: 'Space로 점프하고 C / Ctrl로 앉아보세요. 오른쪽 계단을 걸어 올라 표시된 발판에 서세요.', marker: { x: 6, y: 1.2, z: 3 } },
  { id: 'shooting', title: '조준·사격·재장전', description: '북쪽의 정지 표적을 좌클릭으로 처치하세요. 우클릭 정조준 사격과 R 재장전을 각각 완료하세요.', marker: { x: 0, y: 0, z: -8 } },
  { id: 'equipment', title: '바닥 총기와 교체', description: '가까이 제공된 MP5가 바닥에 내려오면 G로 교체하세요. 들고 있던 총이 바닥에 남는 것을 확인하고 G로 원래 총과 다시 교체하세요.' },
  { id: 'combat', title: '짧은 실전', description: '초급 AI 한 명과 교전합니다. 엄폐하고 멈춰서 조준해 상대를 한 번 처치하세요.', marker: { x: 0, y: 0, z: -3 } },
  { id: 'respawn', title: '사망·리스폰 체험', description: '훈련 교관이 나타났습니다. 준비되면 Enter로 사망·리스폰 시범을 시작하세요. 자동으로 죽거나 완료되지 않습니다.' },
]);

class TrainingRoom extends Room {
  botInput(player, now, dt) { return player.trainingDummy ? { ...EMPTY_INPUT, yaw: player.yaw, pitch: player.pitch, weaponId: player.weaponId } : super.botInput(player, now, dt); }
  shoot(player, now, ads, shot) {
    const fired = super.shoot(player, now, ads, shot);
    if (fired && !player.isBot) this.trainingAttacks.push({ ads: !!ads, melee: getWeapon(player.weaponId).melee === true });
    return fired;
  }
}

// Local-only orchestration around the exact same movement, combat, equipment
// and respawn rules. It has no online rating or profile-award capability.
export class TutorialSession {
  constructor(id, name, loadout = {}, { clock = () => Date.now(), random = Math.random } = {}) {
    this.room = new TrainingRoom('TRAIN', { mode: 'tutorial', bots: 0, fragLimit: 200, roundSeconds: 3600, clock, random });
    this.room.world = TRAINING_WORLD; this.room.trainingAttacks = [];
    this.player = this.room.addPlayer(id, name, false, { ...loadout, weaponId: 'rifle' });
    this.setStage(0);
  }

  setStage(stage) {
    this.stage = stage; this.completed = false; this.metrics = {}; this.startKills = this.player.kills; this.startLife = this.player.spawnCount;
    this.previous = { x: this.player.x, z: this.player.z, yaw: this.player.yaw, pitch: this.player.pitch, life: this.player.spawnCount };
    this.room.trainingAttacks.length = 0;
    for (const player of [...this.room.players.values()]) if (player.isBot) this.room.removePlayer(player.id);
    this.opponent = null;
    if (stage === 2 || stage === 4) {
      if (stage === 4) { this.room.spawn(this.player); this.room.droppedWeapons.clear(); }
      Object.assign(this.player, { weaponId: 'rifle', nextWeaponId: 'rifle', weaponSkinId: this.player.skinId, ammo: 30, reloadUntil: 0, switchUntil: 0, nextFireAt: 0, input: { ...EMPTY_INPUT, yaw: this.player.yaw, pitch: this.player.pitch } }); this.player.equipmentSeq++;
      this.opponent = this.room.addPlayer('training-opponent', stage === 2 ? '정지 표적' : '초급 AI', true, { weaponId: 'rifle' });
      Object.assign(this.opponent, { x: 0, y: 0, z: stage === 2 ? -8 : -3, yaw: Math.PI, pitch: 0, protectedUntil: 0, trainingDummy: stage === 2, spawnExitPath: [] });
    }
    if (stage === 3) {
      this.room.droppedWeapons.clear();
      this.room.dropWeapon({ ...this.player, weaponId: 'mp5', ammo: 30, weaponSkinId: 'circuit' });
    }
    if (stage === 5) {
      this.opponent = this.room.addPlayer('training-instructor', '훈련 교관', true, { weaponId: 'sniper' });
      Object.assign(this.opponent, { trainingDummy: true, x: 0, y: 0, z: -3, yaw: Math.PI, protectedUntil: this.room.clock() + 3_600_000, spawnExitPath: [] });
      this.startLife = this.player.spawnCount;
    }
  }

  demonstrateRespawn() {
    const p = this.player, npc = this.opponent, now = this.room.clock();
    if (!this.metrics.demoRequested || now < this.metrics.demoAt || !npc || p.hp <= 0 || p.spawnCount !== this.startLife || now < npc.nextFireAt) return;
    Object.assign(npc, { x: p.x, y: p.y, z: p.z - .25, yaw: Math.PI, pitch: Math.atan2(playerPose(p).headHeight - RULES.eyeHeight, .25), weaponId: 'sniper', ammo: 5, moveSpeed: 0, shotHeat: 0 });
    p.protectedUntil = 0; this.room.shoot(npc, now, true);
  }

  setInput(data) { this.room.setInput(this.player.id, data); }
  interactEquipment(data) {
    const before = this.player.weaponId;
    const changed = this.room.interactEquipment(this.player.id, data);
    if (changed && this.stage === 3) {
      this.metrics.swaps = (this.metrics.swaps || 0) + 1;
      if (this.metrics.swaps === 1) { this.metrics.originalWeapon = before; this.metrics.originalDropId = [...this.room.droppedWeapons.values()].find((drop) => drop.weaponId === before)?.id; }
      else if (this.player.weaponId === this.metrics.originalWeapon) this.metrics.swappedBack = true;
    }
    return changed;
  }

  command(data) {
    const p = this.player, now = this.room.clock(), m = this.metrics;
    if (this.completed || this.stage !== 5 || p.hp <= 0 || this.room.phase !== 'active' || data.roundId !== this.room.roundId || data.spawnCount !== p.spawnCount) return false;
    if (data.action === 'start-respawn' && !m.demoRequested && p.spawnCount === this.startLife) {
      m.demoRequested = true; m.demoAt = now + 1500; p.input = { ...EMPTY_INPUT, yaw: p.yaw, pitch: p.pitch, weaponId: p.weaponId }; p.pendingShot = null; p.burstLeft = 0; return true;
    }
    if (data.action === 'confirm-respawn' && !m.confirmed && m.respawnAt != null && now - m.respawnAt >= 2000 && p.spawnCount > this.startLife) { m.confirmed = true; return true; }
    return false;
  }

  goals() {
    const m = this.metrics;
    return [
      [['마우스로 시점 돌리기', m.look > .35], ['WASD로 3m 이동', m.distance >= 3], ['Shift로 2m 달리기', m.sprint >= 2]],
      [['Space로 점프', m.jump], ['C / Ctrl로 앉기', m.crouch], ['계단으로 발판에 오르기', m.deck]],
      [['정지 표적 처치', this.player.kills > this.startKills], ['우클릭 정조준 사격', m.ads], ['R 재장전 완료', m.reloaded]],
      [['G로 바닥 MP5와 교체', m.swaps >= 1], ['기존 총이 바닥에 남는 것 확인', m.originalOnGround], ['G로 원래 총과 다시 교체', m.swappedBack]],
      [['초급 AI 한 번 처치', this.player.kills > this.startKills]],
      [['Enter로 시범 시작', m.demoRequested], ['사망 후 새 생명으로 복귀', m.respawnAt != null], ['복귀 화면을 확인하고 Enter로 완료', m.confirmed]],
    ][this.stage].map(([label, done]) => ({ label, done: !!done }));
  }

  tick(dt) {
    if (this.completed) return;
    const p = this.player, m = this.metrics, beforeReload = p.reloadUntil;
    this.room.tick(dt);
    if (p.hp > 0 && this.previous.life === p.spawnCount) {
      const distance = Math.min(.6, Math.hypot(p.x - this.previous.x, p.z - this.previous.z));
      m.distance = (m.distance || 0) + distance; if (p.sprinting) m.sprint = (m.sprint || 0) + distance;
      m.look = (m.look || 0) + Math.abs(angleDelta(p.yaw, this.previous.yaw)) + Math.abs(p.pitch - this.previous.pitch);
      m.jump ||= !p.grounded && p.vy > 0; m.crouch ||= p.crouching; m.deck ||= p.grounded && p.y >= 1.19;
    }
    if (p.reloadUntil && p.input.reload) m.reload = true;
    if (m.reload && beforeReload && !p.reloadUntil && p.ammo === getWeapon(p.weaponId).magazine) m.reloaded = true;
    for (const attack of this.room.trainingAttacks.splice(0)) { m.ads ||= attack.ads; m.knife ||= attack.melee; }
    if (this.stage === 3 && this.room.droppedWeapons.get(m.originalDropId)?.grounded) m.originalOnGround = true;
    if (this.stage === 5 && m.demoRequested && p.hp > 0 && p.spawnCount > this.startLife && m.respawnAt == null) {
      m.respawnAt = this.room.clock();
      if (this.opponent) { this.room.removePlayer(this.opponent.id); this.opponent = null; }
    }
    this.previous = { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch, life: p.spawnCount };
    if (this.stage === 5) this.demonstrateRespawn();
    if (this.goals().every((goal) => goal.done)) {
      if (this.stage < TUTORIAL_STEPS.length - 1) this.setStage(this.stage + 1);
      else { this.completed = true; this.room.phase = 'training-complete'; for (const npc of [...this.room.players.values()]) if (npc.isBot) this.room.removePlayer(npc.id); }
    }
  }

  restart() {
    for (const npc of [...this.room.players.values()]) if (npc.isBot) this.room.removePlayer(npc.id);
    this.room.restart(this.player.id); this.setStage(0);
  }

  snapshot(flushEvents = true) {
    const snapshot = this.room.snapshot(flushEvents), step = TUTORIAL_STEPS[this.stage];
    let description = step.description, action = null;
    if (this.stage === 5 && !this.completed) {
      if (!this.metrics.demoRequested) action = { id: 'start-respawn', label: 'Enter · 리스폰 시범 시작', enabled: this.player.hp > 0 };
      else if (this.player.hp <= 0) description = '리스폰 시범 중입니다. 3초 후 복귀하는 모습을 확인하세요. 돌아와도 훈련은 자동 종료되지 않습니다.';
      else if (this.metrics.respawnAt != null) { action = { id: 'confirm-respawn', label: 'Enter · 복귀 확인하고 완료', enabled: this.room.clock() - this.metrics.respawnAt >= 2000 }; description = '전장으로 복귀했습니다. 회복된 체력·총과 화면을 직접 확인해 보세요. 확인을 마쳤다면 Enter로 훈련을 완료하세요.'; }
      else description = '1.5초 후 교관의 사망 시범이 시작됩니다. 이후 3초 리스폰과 복귀 모습을 직접 확인하게 됩니다.';
    }
    return { ...snapshot, tutorial: { stage: this.stage, total: TUTORIAL_STEPS.length, id: step.id, title: this.completed ? '기초 훈련 완료' : step.title, description: this.completed ? '이제 혼자 연습이나 LAN대전에서 실력을 쌓아보세요. 훈련 결과는 전적·LP·경쟁 점수에 반영하지 않습니다.' : description, goals: this.goals(), marker: this.completed ? null : step.marker || null, action, completed: this.completed } };
  }
}
