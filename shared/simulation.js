import { RULES, WORLD, getMap, aimDirection, rayBox, raySphere, rayCapsule, wallDistance, impactSurface, hasLineOfSight, bounds, playerPose, normalizeRoundOptions, NETWORK_PROTOCOL, BULLET_MARK_RULES } from './world.js';
import { EMPTY_INPUT, sanitizeInput, movePlayer, clamp, angleDelta } from './movement.js';
import { WEAPONS, SKINS, getWeapon, getSkin, freshMagazines, damageAtDistance, shotAngles, shotInterval, isWeaponId, normalizeOwnedWeapons, ownsWeapon, weaponModel } from './catalog.js';
import { getOutfit, getCharacter, CHARACTERS } from './outfits.js';
import { roundReward, normalizeWeaponKills, weaponMastery, normalizeSuppressedWeapons, suppressorUnlocked } from './progression.js';
import { EQUIPMENT_RULES, nearestDroppedWeapon, settleDroppedWeapon } from './equipment.js';
import { sameTeam, normalizeGameType, teamSpawnZones, balancedTeam, TEAM_NAMES } from './teams.js';
import { findPath, canTraverse, followBotPath, steerBot, nearBotCover } from './bot-navigation.js';
import { isTeamGame, isObjectiveGame, assertMapGameType } from './game-types.js';
import { ObjectiveRound, objectiveOptions, OBJECTIVE_RULES } from './objectives.js';
export { findPath } from './bot-navigation.js';

const BOT_NAMES = ['GHOST', 'RIVET', 'ECHO', 'CINDER', 'STATIC', 'ONYX', 'NOVA'];
const botId = () => globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
const nowMs = () => Date.now();
const newRoundId = () => globalThis.crypto?.randomUUID?.() || `round-${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
export const cleanName = (name, limit = 16) => typeof name === 'string' ? [...name.replace(/[\p{C}<>]/gu, '').trim()].slice(0, limit).join('') || 'OPERATOR' : 'OPERATOR';

export const BOT_BEHAVIOR = Object.freeze({
  turnRadiansPerSecond: 1.1, pitchRadiansPerSecond: 0.85,
  reactionMinMs: 600, reactionMaxMs: 1000, aimSampleMs: 180,
  aimYawError: 0.035, aimPitchError: 0.025, aimErrorMinMs: 450, aimErrorMaxMs: 750,
  shotSpread: 0.055, shotIntervalMs: 450,
  burstMinShots: 2, burstMaxShots: 3, burstPauseMinMs: 650, burstPauseMaxMs: 1000,
  viewHalfAngle: 1.1, firingAngle: 0.08, firingRange: 42,
});
export const ASSIST_RULES = Object.freeze({ windowMs: 10_000, minDamage: 20 });
export const BOT_DIFFICULTIES = Object.freeze([
  Object.freeze({ id: 'beginner', label: '초급', behavior: BOT_BEHAVIOR }),
  Object.freeze({ id: 'intermediate', label: '중급', behavior: Object.freeze({ ...BOT_BEHAVIOR, turnRadiansPerSecond: 2, pitchRadiansPerSecond: 1.5, reactionMinMs: 350, reactionMaxMs: 550, aimSampleMs: 120, aimYawError: 0.022, aimPitchError: 0.016, shotSpread: 0.032, shotIntervalMs: 300, burstMinShots: 3, burstMaxShots: 4, burstPauseMinMs: 450, burstPauseMaxMs: 650, viewHalfAngle: 1.4, firingRange: 55 }) }),
  Object.freeze({ id: 'advanced', label: '고급', behavior: Object.freeze({ ...BOT_BEHAVIOR, turnRadiansPerSecond: 3.6, pitchRadiansPerSecond: 2.8, reactionMinMs: 180, reactionMaxMs: 300, aimSampleMs: 70, aimYawError: 0.012, aimPitchError: 0.008, shotSpread: 0.016, shotIntervalMs: 180, burstMinShots: 4, burstMaxShots: 6, burstPauseMinMs: 260, burstPauseMaxMs: 450, viewHalfAngle: 1.7, firingRange: 65 }) }),
]);
export const getBotDifficulty = (id) => BOT_DIFFICULTIES.find((level) => level.id === id) || BOT_DIFFICULTIES[0];

function freshBotBrain() {
  return { targetId: null, visibleSince: null, reactAt: 0, aimPoint: null, nextAimSampleAt: 0, yawError: 0, pitchError: 0, nextAimErrorAt: 0, burstLeft: 0, nextBurstAt: 0, triggerPending: false, sniperSettleAt: 0 };
}

const bodyVolumeCache = new WeakMap();
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const limbDamageMultiplier = (progress) => RULES.torsoDamageMultiplier + (RULES.handDamageMultiplier - RULES.torsoDamageMultiplier) * clamp(progress, 0, 1);

// Common combat geometry for both character models/outfits. The arm targets
// match the weapon grips and crouch offsets used by the visible two-bone rig.
export function playerBodyVolumes(player) {
  const pose = playerPose(player), crouch = (RULES.playerHeight - pose.height) / (RULES.playerHeight - RULES.crouchHeight);
  const pitch = player.pitch || 0, shape = weaponModel(getWeapon(player.weaponId)), cached = bodyVolumeCache.get(player);
  if (cached?.height === pose.height && cached.pitch === pitch && cached.shape === shape) return cached.volumes;
  const volumes = [
    { part: 'torso', box: { minX: -0.24, maxX: 0.24, minY: 0.64 - crouch * 0.3, maxY: pose.bodyTop, minZ: -0.2, maxZ: 0.2 }, multiplier: RULES.torsoDamageMultiplier },
    { part: 'legs', box: { minX: -RULES.playerRadius, maxX: RULES.playerRadius, minY: 0, maxY: 0.79 - crouch * 0.3, minZ: -RULES.playerRadius, maxZ: RULES.playerRadius }, multiplier: 1 },
  ];
  for (const side of [-1, 1]) {
    const shoulder = { x: side * 0.225, y: pose.bodyTop - 0.1, z: 0 };
    const grip = side === 1 ? { x: 0.055, y: -0.13, z: 0.13 } : shape === 'knife' ? { x: -.2, y: -.12, z: -.08 } : shape === 'pistol' ? { x: -0.04, y: -0.13, z: 0.1 } : { x: -0.06, y: -0.05, z: -0.12 };
    const hand = { x: 0.1 + grip.x, y: 1.19 - crouch * 0.52 + grip.y * Math.cos(pitch) - grip.z * Math.sin(pitch), z: -0.16 + grip.y * Math.sin(pitch) + grip.z * Math.cos(pitch) };
    const delta = sub(hand, shoulder), length = Math.hypot(delta.x, delta.y, delta.z), distance = clamp(length, 0.001, 0.529);
    const direction = { x: delta.x / length, y: delta.y / length, z: delta.z / length }, pole = sub({ x: side * 0.4, y: 0.98 - crouch * 0.5, z: 0.08 }, shoulder);
    const along = (0.27 ** 2 - 0.26 ** 2 + distance ** 2) / (2 * distance), projection = dot(pole, direction);
    const bend = { x: pole.x - direction.x * projection, y: pole.y - direction.y * projection, z: pole.z - direction.z * projection }, bendLength = Math.hypot(bend.x, bend.y, bend.z) || 1;
    const height = Math.sqrt(Math.max(0, 0.27 ** 2 - along ** 2));
    const elbow = { x: shoulder.x + direction.x * along + bend.x / bendLength * height, y: shoulder.y + direction.y * along + bend.y / bendLength * height, z: shoulder.z + direction.z * along + bend.z / bendLength * height };
    const wrist = { x: shoulder.x + direction.x * distance, y: shoulder.y + direction.y * distance, z: shoulder.z + direction.z * distance };
    const part = side === 1 ? 'rightArm' : 'leftArm', total = 0.27 + 0.26 + 0.055;
    volumes.push({ part, a: shoulder, b: elbow, radius: 0.095, from: 0, to: 0.27 / total });
    volumes.push({ part, a: elbow, b: wrist, radius: 0.075, from: 0.27 / total, to: 0.53 / total });
    volumes.push({ part: side === 1 ? 'rightHand' : 'leftHand', a: wrist, b: { x: wrist.x, y: wrist.y, z: wrist.z - 0.055 }, radius: 0.055, from: 0.53 / total, to: 1 });
  }
  bodyVolumeCache.set(player, { height: pose.height, pitch, shape, volumes }); return volumes;
}

export function tracePlayerBody(origin, direction, target, maxDistance = Infinity) {
  const cosine = Math.cos(target.yaw || 0), sine = Math.sin(target.yaw || 0), relative = sub(origin, target);
  const rotate = (v) => ({ x: v.x * cosine - v.z * sine, y: v.y, z: v.x * sine + v.z * cosine });
  const from = rotate(relative), ray = rotate(direction); let nearest = null;
  for (const volume of playerBodyVolumes(target)) {
    const distance = volume.box ? rayBox(from, ray, volume.box, maxDistance) : rayCapsule(from, ray, volume.a, volume.b, volume.radius, maxDistance);
    if (distance === null || distance >= (nearest?.distance ?? maxDistance)) continue;
    let progress = null, multiplier = volume.multiplier;
    if (!volume.box) {
      const axis = sub(volume.b, volume.a), point = { x: from.x + ray.x * distance, y: from.y + ray.y * distance, z: from.z + ray.z * distance };
      const fraction = clamp(dot(sub(point, volume.a), axis) / dot(axis, axis), 0, 1);
      progress = volume.from + (volume.to - volume.from) * fraction; multiplier = limbDamageMultiplier(progress);
    }
    nearest = { distance, bodyPart: volume.part, damageMultiplier: multiplier, limbProgress: progress };
  }
  if (nearest) return nearest;
  // Preserve the established shoulder/boot coverage for grazing contacts;
  // empty edge space must never receive the torso's 1.2x bonus.
  const pose = playerPose(target), distance = rayBox(origin, direction, { minX: target.x - RULES.playerRadius, maxX: target.x + RULES.playerRadius, minY: target.y, maxY: target.y + pose.bodyTop, minZ: target.z - RULES.playerRadius, maxZ: target.z + RULES.playerRadius }, maxDistance);
  return distance === null ? null : { distance, bodyPart: 'grazing', damageMultiplier: RULES.handDamageMultiplier, limbProgress: 1 };
}

export function traceShot(shooter, players, now = nowMs(), world = WORLD, direction = aimDirection(shooter.yaw, shooter.pitch), range = getWeapon(shooter.weaponId).range) {
  const origin = { x: shooter.x, y: shooter.y + playerPose(shooter).eyeHeight, z: shooter.z };
  const wall = {}; let distance = wallDistance(origin, direction, range, world, wall);
  let victim = null, headshot = false, protectedTarget = null, friendlyTarget = null, bodyPart = null, damageMultiplier = 1, limbProgress = null;
  for (const target of players) {
    if (target.id === shooter.id || target.hp <= 0) continue;
    const pose = playerPose(target);
    const body = tracePlayerBody(origin, direction, target, distance);
    const head = raySphere(origin, direction, { x: target.x, y: target.y + pose.headHeight, z: target.z }, pose.headRadius);
    const hitHead = head !== null && head < distance && (body === null || head <= body.distance);
    const hit = hitHead ? head : body?.distance ?? null;
    if (hit !== null && hit < distance) {
      distance = hit; friendlyTarget = sameTeam(shooter, target) ? target.id : null; protectedTarget = !friendlyTarget && target.protectedUntil > now ? target.id : null; victim = protectedTarget || friendlyTarget ? null : target; headshot = !protectedTarget && !friendlyTarget && hitHead;
      bodyPart = hitHead ? 'head' : body.bodyPart; damageMultiplier = protectedTarget || friendlyTarget ? 0 : hitHead ? 1 : body.damageMultiplier; limbProgress = hitHead ? null : body.limbProgress;
    }
  }
  const surface = !victim && !protectedTarget && !friendlyTarget ? impactSurface(origin, direction, distance, wall.box, world) : null;
  return { victim, headshot, protectedTarget, friendlyTarget, bodyPart, damageMultiplier, limbProgress, origin, distance, surface, end: surface?.point || { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance, z: origin.z + direction.z * distance } };
}

export class Room {
  constructor(code, { mode = 'lan', bots = 2, mapId = WORLD.id, botDifficulty = 'beginner', fragLimit, roundSeconds, scoreLimit, waves, gameType = 'ffa', roomName = '', clock = nowMs, random = Math.random } = {}) {
    this.code = code; this.mode = mode; this.clock = clock; this.random = random;
    this.gameType = normalizeGameType(gameType); this.roomName = typeof roomName === 'string' ? roomName.replace(/[\p{C}<>]/gu, '').trim().slice(0, 32) : ''; this.teamScores = { blue: 0, red: 0 };
    this.world = getMap(mapId);
    assertMapGameType(this.world, this.gameType);
    const difficulty = getBotDifficulty(botDifficulty); this.botDifficulty = difficulty.id; this.botBehavior = difficulty.behavior;
    Object.assign(this, normalizeRoundOptions({ fragLimit, roundSeconds }));
    this.players = new Map(); this.hostId = null; this.events = []; this.phase = 'active';
    this.startedAt = clock(); this.endsAt = this.startedAt + this.roundSeconds * 1000;
    this.roundId = newRoundId(); this.result = null;
    this.lastActivity = this.startedAt;
    this.spawnUses = new Map(); this.droppedWeapons = new Map(); this.dropSerial = 0; this.impacts = new Map();
    Object.assign(this, objectiveOptions({ scoreLimit, waves })); this.objectives = isObjectiveGame(this.gameType) ? new ObjectiveRound(this) : null;
    for (let i = 0; i < clamp(Math.floor(Number(bots) || 0), 0, this.gameType === 'defense' ? 3 : RULES.maxPlayers - 1); i++) this.addPlayer(`bot-${botId()}`, BOT_NAMES[i], true);
  }

  addPlayer(id, name, isBot = false, loadout = {}) {
    if (this.players.has(id)) throw new Error('이미 이 방에 접속해 있습니다.');
    const waveEnemy = isBot && loadout.defenseEnemy === true && this.gameType === 'defense';
    if (this.gameType === 'defense' && !waveEnemy) {
      const defenders = [...this.players.values()].filter((p) => p.teamId === 'blue');
      if (defenders.length >= OBJECTIVE_RULES.defenders) { const replace = !isBot && defenders.find((p) => p.isBot); if (replace) this.players.delete(replace.id); else throw new Error('협동 방어전의 수비팀은 최대 4명입니다.'); }
    }
    if (this.gameType !== 'defense' && this.players.size >= RULES.maxPlayers) {
      const team = isTeamGame(this.gameType) ? this.gameType === 'defense' ? 'blue' : balancedTeam(this.players.values()) : null;
      const bot = [...this.players.values()].find((p) => p.isBot && (!team || p.teamId === team)) || [...this.players.values()].find((p) => p.isBot);
      if (bot && !isBot) this.players.delete(bot.id);
      else throw new Error('방이 가득 찼습니다.');
    }
    const ownedWeapons = isBot ? WEAPONS.map(({ id }) => id) : normalizeOwnedWeapons(loadout.ownedWeapons);
    const requested = isBot && !isWeaponId(loadout.weaponId) ? WEAPONS[[...this.players.values()].filter((p) => p.isBot).length % WEAPONS.length].id : isWeaponId(loadout.weaponId) ? loadout.weaponId : 'rifle';
    const chosenWeapon = ownsWeapon({ ownedWeapons }, requested) ? requested : 'rifle';
    const player = {
      id, name: cleanName(name, ['casual', 'ranked', 'custom'].includes(this.mode) ? 24 : 16), isBot, isWaveEnemy: waveEnemy, teamId: this.gameType === 'defense' ? waveEnemy ? 'red' : 'blue' : isTeamGame(this.gameType) ? balancedTeam(this.players.values(), !isBot) : null, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vy: 0,
      hp: 100, ammo: RULES.magazine, kills: 0, deaths: 0, assists: 0, rankBadge: null, grounded: true, jumpHeld: false,
      reloadUntil: 0, respawnAt: 0, protectedUntil: 0, lastShot: 0, lastInput: this.clock(),
      input: { ...EMPTY_INPUT }, botPath: [], nextPathAt: 0,
      weaponId: chosenWeapon,
      ownedWeapons, weaponKills: {}, masteryKills: isBot ? {} : normalizeWeaponKills(loadout.weaponKills), killChain: 0, lastKillAt: null,
      nextWeaponId: chosenWeapon, loadoutSelecting: false, diedAt: 0, pendingShot: null, history: [], shotSerial: 0,
      skinId: getSkin(waveEnemy ? loadout.skinId : isBot ? SKINS[(this.players.size + 1) % SKINS.length].id : loadout.skinId).id,
      outfitId: getOutfit(loadout.outfitId).id,
      characterId: getCharacter(isBot ? CHARACTERS[this.players.size % CHARACTERS.length].id : loadout.characterId).id,
      magazines: freshMagazines(), switchUntil: 0, nextFireAt: 0, fireLatched: false,
    };
    player.suppressedWeapons = normalizeSuppressedWeapons(loadout.suppressedWeapons, player.masteryKills); player.suppressor = false;
    this.players.set(id, player);
    if (typeof loadout.suppressor === 'boolean') this.setSuppressor(player, chosenWeapon, loadout.suppressor);
    if (!isBot && !this.hostId) this.hostId = id;
    this.spawn(player);
    if (!waveEnemy) this.events.push({ type: 'joined', name: player.name, id, isBot });
    return player;
  }

  removePlayer(id) {
    const player = this.players.get(id);
    this.players.delete(id);
    if (player) this.events.push({ type: 'left', name: player.name, id });
    if (this.hostId === id) this.hostId = [...this.players.values()].find((p) => !p.isBot)?.id || null;
  }

  spawn(player) {
    if (player.isBot && player.spawnCount > 0) player.nextWeaponId = WEAPONS[(WEAPONS.findIndex((weapon) => weapon.id === player.weaponId) + 7) % WEAPONS.length].id;
    player.spawnCount = (player.spawnCount || 0) + 1;
    const requested = getWeapon(player.nextWeaponId || player.weaponId).id;
    player.weaponId = ownsWeapon(player, requested) ? requested : 'rifle'; player.nextWeaponId = player.weaponId;
    player.suppressor = !!player.suppressedWeapons?.includes(player.weaponId) && suppressorUnlocked(player.masteryKills, player.weaponId);
    const others = [...this.players.values()].filter((p) => p.id !== player.id && p.hp > 0 && !sameTeam(p, player));
    // Wave entries use the same random, visibility/distance-aware selection as
    // player spawns instead of a predictable fixed lane cycle.
    let spawnPoints = isTeamGame(this.gameType) ? teamSpawnZones(this.world)[player.teamId] : this.world.spawns;
    if (isTeamGame(this.gameType)) {
      const unoccupied = spawnPoints.filter((point) => ![...this.players.values()].some((p) => p.id !== player.id && p.hp > 0 && Math.hypot(point.x - p.x, (point.y || 0) - p.y, point.z - p.z) < 1));
      if (unoccupied.length) spawnPoints = unoccupied;
    }
    const choices = spawnPoints.map((point) => {
      const y = point.y || 0, eye = { x: point.x, y: y + RULES.eyeHeight, z: point.z }, chest = { ...eye, y: y + 0.9 };
      const visible = others.filter((p) => { const from = { x: p.x, y: p.y + playerPose(p).eyeHeight, z: p.z }; return hasLineOfSight(from, eye, this.world) || hasLineOfSight(from, chest, this.world); }).length;
      const distance = Math.min(...others.map((p) => Math.hypot(point.x - p.x, point.z - p.z, y - p.y)), Infinity);
      const key = point.spawnId || `${point.x},${y},${point.z}`;
      return { point, key, visible, distance, uses: this.spawnUses.get(key) || 0 };
    });
    let pool = choices.filter((s) => !s.visible && s.distance >= 8);
    if (!pool.length) pool = choices.filter((s) => !s.visible && s.distance >= 3);
    if (!pool.length) { const visible = Math.min(...choices.map((s) => s.visible)); pool = choices.filter((s) => s.visible === visible); }
    if (others.length) { const distance = Math.min(12, Math.max(...pool.map((s) => s.distance)) - 2); pool = pool.filter((s) => s.distance >= distance); }
    const uses = Math.min(...pool.map((s) => s.uses)); pool = pool.filter((s) => s.uses === uses);
    const choice = pool[Math.min(pool.length - 1, Math.floor(this.random() * pool.length))], spawn = choice.point;
    this.spawnUses.set(choice.key, choice.uses + 1);
    Object.assign(player, { x: spawn.x, y: spawn.y || 0, z: spawn.z, yaw: spawn.yaw, spawnId: spawn.spawnId || null, spawnLevel: spawn.roof ? 'ROOF' : `${spawn.level || 1}F`, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 100, hitSlowUntil: 0, ammo: getWeapon(player.weaponId).magazine, magazines: freshMagazines(), reloadUntil: 0, switchUntil: 0, nextFireAt: 0, fireLatched: false, respawnAt: 0, protectedUntil: this.clock() + RULES.protectionSeconds * 1000, grounded: true, jumpHeld: false, crouching: false, crouchAmount: 0, walking: false, sprinting: false, moveSpeed: 0, shotHeat: 0, loadoutSelecting: false, diedAt: 0, lastDeath: null, botPath: [], nextPathAt: 0, stairRouteKey: null });
    player.botBrain = player.isBot ? freshBotBrain() : null;
    player.damageContributors = new Map();
    player.input = { ...EMPTY_INPUT, yaw: player.yaw, weaponId: player.weaponId };
    player.pendingShot = null; player.viewTime = null; player.burstLeft = 0; player.triggerSeq = null; player.triggerShotIndex = 0;
    player.killChain = 0; player.lastKillAt = null;
    player.weaponSkinId = player.skinId; player.equipmentSeq = (player.equipmentSeq || 0) + 1;
    player.lastEquipmentAction = 0; player.equipmentCooldownUntil = 0; player.stepDistance = 0;
    player.spawnExitPath = player.isBot ? (spawn.exitPath || []).map((p) => ({ ...p })) : [];
    player.history = []; this.recordPlayerHistory(player, this.clock());
  }

  recordPlayerHistory(player, time) {
    player.history.push({ time, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, weaponId: player.weaponId, crouching: player.crouching, crouchAmount: player.crouchAmount });
    while (player.history.length > 1 && (player.history[0].time < time - 250 || player.history.length > 32)) player.history.shift();
  }

  playersAt(time) {
    return [...this.players.values()].map((player) => {
      const history = player.history;
      if (!history?.length || time >= history.at(-1).time) return player;
      let before = history[0], after = before;
      for (const sample of history) { if (sample.time <= time) before = sample; else { after = sample; break; } }
      const mix = after.time > before.time ? clamp((time - before.time) / (after.time - before.time), 0, 1) : 0;
      const yaw = before.yaw ?? player.yaw, pitch = before.pitch ?? player.pitch;
      return { id: player.id, teamId: player.teamId, hp: player.hp, protectedUntil: player.protectedUntil, x: before.x + (after.x - before.x) * mix, y: before.y + (after.y - before.y) * mix, z: before.z + (after.z - before.z) * mix, yaw: yaw + angleDelta(after.yaw ?? yaw, yaw) * mix, pitch: pitch + ((after.pitch ?? pitch) - pitch) * mix, weaponId: before.weaponId || player.weaponId, crouching: mix < 0.5 ? before.crouching : after.crouching, crouchAmount: (before.crouchAmount ?? (before.crouching ? 1 : 0)) + ((after.crouchAmount ?? (after.crouching ? 1 : 0)) - (before.crouchAmount ?? (before.crouching ? 1 : 0))) * mix };
    });
  }

  setInput(id, input) {
    const player = this.players.get(id);
    if (!player || player.isBot) return;
    // Dead clients keep sending neutral look packets until they see the
    // respawn. Those packets must not overwrite the new spawn's exit-facing
    // yaw (or re-arm an old trigger) during the snapshot delivery window.
    if (input.spawnCount !== undefined && input.spawnCount !== player.spawnCount) return;
    if (input.equipmentSeq !== undefined && input.equipmentSeq !== player.equipmentSeq) return;
    if (player.hp <= 0 || this.phase !== 'active') { player.input = { ...EMPTY_INPUT, yaw: player.yaw, pitch: player.pitch, weaponId: player.weaponId }; player.pendingShot = null; player.burstLeft = 0; player.fireLatched = false; return; }
    const next = sanitizeInput(input, player.input), now = this.clock();
    if (getWeapon(player.weaponId).hyperburstCount && player.input.fire && !next.fire && player.shotSerial > 0) player.nextFireAt = Math.max(player.nextFireAt, player.lastShot + getWeapon(player.weaponId).fireSeconds * 1000);
    if (getWeapon(player.weaponId).melee) next.ads = false;
    player.viewTime = typeof input.viewTime === 'number' && Number.isFinite(input.viewTime) ? clamp(input.viewTime, now - 200, now) : null;
    if (next.fire && !player.input.fire && !player.pendingShot) player.pendingShot = { newTrigger: true, fireSeq: Number.isSafeInteger(input.fireSeq) && input.fireSeq >= 0 ? input.fireSeq : null, yaw: next.yaw, pitch: next.pitch, ads: next.ads, at: now, movement: { grounded: player.grounded, walking: player.walking, sprinting: false, moveSpeed: Math.max(player.moveSpeed || 0, Math.hypot(next.forward, next.strafe)) }, viewTime: typeof input.viewTime === 'number' && Number.isFinite(input.viewTime) ? clamp(input.viewTime, now - 200, now) : null };
    player.input = next;
    player.lastInput = now;
  }

  switchWeapon(player, weaponId, now = this.clock()) {
    // Kept as a narrow compatibility entry point; never changes a living loadout.
    if (player.hp > 0 || !isWeaponId(weaponId)) return false;
    return this.selectLoadout(player.id, { weaponId, open: false }, now);
  }

  selectLoadout(id, data, now = this.clock()) {
    const player = this.players.get(id);
    if (!player || player.isBot || player.hp > 0 || this.phase !== 'active') return false;
    if (data.weaponId !== undefined && (!isWeaponId(data.weaponId) || !ownsWeapon(player, data.weaponId))) return false;
    if (data.suppressor !== undefined && !this.setSuppressor(player, data.weaponId || player.nextWeaponId, data.suppressor)) return false;
    if (data.weaponId) player.nextWeaponId = data.weaponId;
    player.loadoutSelecting = data.open === true;
    const death = player.diedAt || Math.max(0, player.respawnAt - RULES.respawnSeconds * 1000);
    player.respawnAt = player.loadoutSelecting ? death + RULES.loadoutSelectSeconds * 1000 : Math.max(death + RULES.respawnSeconds * 1000, now + 350);
    return true;
  }

  setSuppressor(player, weaponId, equipped) {
    if (!player || this.players.get(player.id) !== player || !isWeaponId(weaponId) || typeof equipped !== 'boolean' || equipped && !suppressorUnlocked(player.masteryKills, weaponId)) return false;
    const ids = new Set(player.suppressedWeapons || []); if (equipped) ids.add(weaponId); else ids.delete(weaponId);
    player.suppressedWeapons = normalizeSuppressedWeapons([...ids], player.masteryKills); return true;
  }

  startReload(player, now = this.clock()) {
    if (!player || getWeapon(player.weaponId).melee || this.players.get(player.id) !== player || player.hp <= 0 || this.phase !== 'active' || player.reloadUntil || now < player.switchUntil || player.ammo >= getWeapon(player.weaponId).magazine) return false;
    player.burstLeft = 0; player.pendingShot = null; player.reloadUntil = now + getWeapon(player.weaponId).reloadSeconds * 1000;
    this.events.push({ type: 'reload', id: player.id, weaponId: player.weaponId, reloadUntil: player.reloadUntil }); return true;
  }

  dropWeapon(player, now = this.clock()) {
    if (!isWeaponId(player.weaponId)) return null;
    const direction = aimDirection(player.yaw, 0), origin = { x: player.x, y: player.y + .4, z: player.z };
    const offset = Math.max(0, Math.min(.65, wallDistance(origin, direction, .85, this.world) - .2));
    const drop = { id: `${this.roundId}-drop-${++this.dropSerial}`, weaponId: player.weaponId, skinId: player.weaponSkinId || player.skinId, suppressor: player.suppressor === true, ammo: player.ammo, x: player.x + direction.x * offset, y: player.y + .65, z: player.z + direction.z * offset, yaw: player.yaw, vy: 0, grounded: false, pickupAt: now + 200, expiresAt: now + EQUIPMENT_RULES.lifetimeMs, nextFireAt: player.nextFireAt };
    while (this.droppedWeapons.size >= EQUIPMENT_RULES.maxDrops) this.droppedWeapons.delete(this.droppedWeapons.keys().next().value);
    this.droppedWeapons.set(drop.id, drop); return drop;
  }

  interactEquipment(id, data, now = this.clock()) {
    const player = this.players.get(id);
    if (!player || player.isBot || player.hp <= 0 || this.phase !== 'active' || data.roundId !== this.roundId || data.spawnCount !== player.spawnCount || data.equipmentSeq !== player.equipmentSeq || !Number.isSafeInteger(data.actionSeq) || data.actionSeq <= player.lastEquipmentAction) return false;
    player.lastEquipmentAction = data.actionSeq;
    if (now < player.equipmentCooldownUntil) return false;
    const pickup = nearestDroppedWeapon(player, this.droppedWeapons.values(), this.world, now);
    if (!pickup) return false;
    this.droppedWeapons.delete(pickup.id);
    this.dropWeapon(player, now);
    player.weaponId = pickup.weaponId; player.weaponSkinId = pickup.skinId;
    player.suppressor = pickup.suppressor === true;
    player.ammo = pickup.ammo; player.magazines[player.weaponId] = player.ammo;
    player.equipmentSeq++; player.equipmentCooldownUntil = now + EQUIPMENT_RULES.actionMs;
    player.switchUntil = now + EQUIPMENT_RULES.equipMs; player.nextFireAt = Math.max(player.nextFireAt, pickup?.nextFireAt || 0, player.switchUntil);
    player.reloadUntil = 0; player.burstLeft = 0; player.pendingShot = null; player.shotHeat = 0;
    player.input = { ...EMPTY_INPUT, yaw: player.yaw, pitch: player.pitch, weaponId: player.weaponId }; player.fireLatched = false;
    this.events.push({ type: 'equipment', id, weaponId: player.weaponId, suppressor: player.suppressor, equipmentSeq: player.equipmentSeq }); return true;
  }

  restart(id) {
    if (id !== this.hostId) throw new Error('방장만 새 라운드를 시작할 수 있습니다.');
    this.phase = 'active'; this.startedAt = this.clock(); this.endsAt = this.startedAt + this.roundSeconds * 1000;
    this.roundId = newRoundId(); this.result = null;
    this.events = [{ type: 'restart' }]; this.droppedWeapons.clear(); this.impacts.clear(); this.teamScores = { blue: 0, red: 0 };
    this.objectives?.reset(this.startedAt);
    this.spawnUses.clear(); for (const player of this.players.values()) player.hp = 0;
    for (const player of this.players.values()) { player.kills = 0; player.deaths = 0; player.assists = 0; player.weaponKills = {}; this.spawn(player); }
  }

  botInput(bot, now, dt) {
    const behavior = bot.botDifficulty ? getBotDifficulty(bot.botDifficulty).behavior : this.botBehavior;
    const brain = bot.botBrain ||= freshBotBrain();
    while (bot.spawnExitPath?.length && Math.hypot(bot.spawnExitPath[0].x - bot.x, bot.spawnExitPath[0].z - bot.z) < 0.25) bot.spawnExitPath.shift();
    if (bot.spawnExitPath?.length) {
      const point = bot.spawnExitPath[0], targetYaw = Math.atan2(-(point.x - bot.x), -(point.z - bot.z));
      const yaw = bot.yaw + clamp(angleDelta(targetYaw, bot.yaw), -dt * behavior.turnRadiansPerSecond, dt * behavior.turnRadiansPerSecond);
      const bearing = angleDelta(targetYaw, yaw);
      return steerBot(bot, { ...EMPTY_INPUT, weaponId: bot.weaponId, yaw, pitch: bot.pitch + clamp(-bot.pitch, -dt * behavior.pitchRadiansPerSecond, dt * behavior.pitchRadiansPerSecond), forward: Math.cos(bearing) * 0.65, strafe: -Math.sin(bearing) * 0.65 }, this.world, now);
    }
    const origin = { x: bot.x, y: bot.y + playerPose(bot).eyeHeight, z: bot.z };
    // Free-for-all: humans and other bots use exactly the same target score.
    const objectiveGoal = this.objectives?.goal(bot), possibleTargets = [...this.players.values()];
    if (bot.isWaveEnemy) possibleTargets.push(objectiveGoal);
    const candidates = possibleTargets.filter((p) => p.id !== bot.id && !sameTeam(p, bot) && p.hp > 0 && p.roomStatus !== 'waiting' && p.protectedUntil <= now).map((target) => {
      const distance = Math.hypot(target.x - bot.x, target.z - bot.z);
      const pose = playerPose(target);
      const visible = target.isObjective ? this.objectives.coreVisible(origin, target) : hasLineOfSight(origin, { x: target.x, y: target.y + pose.aimHeight, z: target.z }, this.world) || hasLineOfSight(origin, { x: target.x, y: target.y + pose.eyeHeight, z: target.z }, this.world);
      return { target, distance, visible, score: distance * (visible ? .65 : 1) * (target.isObjective ? .8 : bot.isWaveEnemy && distance > 12 ? 2.5 : 1) };
    }).sort((a, b) => a.score - b.score);
    if (!candidates.length && objectiveGoal) candidates.push({ target: { ...objectiveGoal, id: `navigate-${objectiveGoal.id || 'defense'}`, isNavigation: true }, distance: Math.hypot(objectiveGoal.x - bot.x, objectiveGoal.z - bot.z), visible: false, score: 0 });
    if (!candidates.length) {
      Object.assign(brain, freshBotBrain());
      return { ...EMPTY_INPUT, yaw: bot.yaw, pitch: bot.pitch, weaponId: bot.weaponId };
    }
    const current = candidates.find((candidate) => candidate.target.id === brain.targetId);
    // Keep a reasonable current target instead of flicking between nearby enemies.
    const selected = current && current.score <= candidates[0].score * 1.3 ? current : candidates[0];
    const { target, distance, visible } = selected;
    const movementTarget = objectiveGoal?.approach || objectiveGoal || target;
    if (brain.objectiveId !== objectiveGoal?.id) { brain.objectiveId = objectiveGoal?.id; bot.nextPathAt = 0; bot.botPath = []; }
    if (brain.targetId !== target.id) {
      Object.assign(brain, freshBotBrain(), { targetId: target.id });
      bot.botPath = []; bot.nextPathAt = 0; bot.stairRouteKey = null;
    }
    if (now >= bot.nextPathAt && bot.grounded) {
      const buildings = [...(this.world.buildings || []), ...(this.world.walkways || [])];
      const own = buildings.find((b) => Math.abs(bot.x - b.x) < b.w / 2 && Math.abs(bot.z - b.z) < b.d / 2);
      const leaving = own && bot.y > 0.2 && (Math.abs(movementTarget.x - own.x) >= own.w / 2 || Math.abs(movementTarget.z - own.z) >= own.d / 2);
      const up = !leaving && buildings.find((b) => Math.abs(movementTarget.x - b.x) < b.w / 2 && Math.abs(movementTarget.z - b.z) < b.d / 2 && movementTarget.y > bot.y + 0.2);
      const down = leaving ? own : !up && own && bot.y > movementTarget.y + 0.2 ? own : null;
      const building = up || down;
      if (building) {
        const destinationY = leaving ? 0 : movementTarget.y;
        const key = `${building.id}-${up ? 'up' : 'down'}-${Math.floor((destinationY + 0.15) / 3)}`;
        if (key !== bot.stairRouteKey || !bot.botPath.length) {
          const inside = Math.abs(bot.x - building.x) < building.w / 2 && Math.abs(bot.z - building.z) < building.d / 2;
          const destination = { x: movementTarget.x, y: movementTarget.y, z: movementTarget.z };
          bot.botPath = up ? [...(inside ? [] : findPath(bot, building.entry, this.world)), ...building.route.filter((point) => point.y >= bot.y - 0.15 && point.y <= movementTarget.y + 0.15), destination] : [...building.route.slice().reverse().filter((point) => point.y <= bot.y + 0.15 && point.y >= destinationY - 0.15), ...findPath(building.entry, movementTarget, this.world), destination];
          bot.stairRouteKey = key;
        }
      } else { bot.stairRouteKey = null; bot.botPath = findPath(bot, movementTarget, this.world); }
      bot.nextPathAt = now + 850;
    }
    const pathPoint = followBotPath(bot, this.world), direct = visible && Math.abs(target.y - bot.y) < .2 && canTraverse(bot, target, this.world, RULES.crouchHeight);
    const objectiveMoving = objectiveGoal && (bot.isWaveEnemy ? Math.hypot(objectiveGoal.x - bot.x, objectiveGoal.z - bot.z) > 18 || !this.objectives.coreVisible(origin, objectiveGoal) : Math.hypot(objectiveGoal.x - bot.x, objectiveGoal.z - bot.z) > 1.1 || Math.abs((objectiveGoal.y || 0) - bot.y) > .2);
    const navigating = objectiveGoal ? objectiveMoving : !direct || !!(bot.stairRouteKey && bot.botPath.length), waypoint = navigating ? pathPoint : target;
    const navigationYaw = Math.atan2(-(waypoint.x - bot.x), -(waypoint.z - bot.z));
    const targetYaw = Math.atan2(-(target.x - bot.x), -(target.z - bot.z));
    const perceived = visible && Math.abs(angleDelta(targetYaw, bot.yaw)) <= behavior.viewHalfAngle;
    if (!perceived) {
      brain.visibleSince = null; brain.reactAt = 0; brain.aimPoint = null;
      brain.nextAimSampleAt = 0; brain.burstLeft = 0;
    } else {
      if (brain.visibleSince === null) {
        brain.visibleSince = now;
        brain.reactAt = now + behavior.reactionMinMs + this.random() * (behavior.reactionMaxMs - behavior.reactionMinMs);
      }
      // Delayed observations and body aim make moving/flanking players harder to hit.
      if (now >= brain.nextAimSampleAt) {
        brain.aimPoint = { x: target.x, y: target.y + (target.isObjective ? 1.5 : playerPose(target).aimHeight), z: target.z };
        brain.nextAimSampleAt = now + behavior.aimSampleMs;
      }
      if (now >= brain.nextAimErrorAt) {
        brain.yawError = (this.random() * 2 - 1) * behavior.aimYawError;
        brain.pitchError = (this.random() * 2 - 1) * behavior.aimPitchError;
        brain.nextAimErrorAt = now + behavior.aimErrorMinMs + this.random() * (behavior.aimErrorMaxMs - behavior.aimErrorMinMs);
      }
    }
    const aim = brain.aimPoint;
    const desiredYaw = aim ? Math.atan2(-(aim.x - bot.x), -(aim.z - bot.z)) + brain.yawError : navigationYaw;
    const desiredPitch = aim ? Math.atan2(aim.y - origin.y, Math.max(Math.hypot(aim.x - bot.x, aim.z - bot.z), 0.01)) + brain.pitchError : 0;
    const yaw = bot.yaw + clamp(angleDelta(desiredYaw, bot.yaw), -dt * behavior.turnRadiansPerSecond, dt * behavior.turnRadiansPerSecond);
    const pitch = bot.pitch + clamp(desiredPitch - bot.pitch, -dt * behavior.pitchRadiansPerSecond, dt * behavior.pitchRadiansPerSecond);
    const facing = aim && Math.abs(angleDelta(desiredYaw, yaw)) < behavior.firingAngle && Math.abs(desiredPitch - pitch) < behavior.firingAngle;
    const ready = perceived && facing && now >= brain.reactAt && distance < behavior.firingRange;
    if (ready && brain.burstLeft === 0 && now >= brain.nextBurstAt) {
      brain.burstLeft = behavior.burstMinShots + Math.floor(this.random() * (behavior.burstMaxShots - behavior.burstMinShots + 1));
      brain.triggerPending = true;
    }
    const bearing = angleDelta(navigationYaw, yaw);
    const botWeapon = getWeapon(bot.weaponId), preferred = botWeapon.type === 'SNIPER' ? 30 : botWeapon.type === 'SHOTGUN' ? 7 : botWeapon.type === 'SMG' || botWeapon.type === 'SIDEARM' ? 10 : 16;
    brain.moveSeed ??= [...bot.id].reduce((value, letter) => (value * 31 + letter.charCodeAt(0)) >>> 0, 0);
    brain.strafeSide ||= brain.moveSeed % 2 ? 1 : -1;
    brain.nextStrafeAt ||= now + 1200 + brain.moveSeed % 800;
    if (now >= brain.nextStrafeAt) { brain.strafeSide *= -1; brain.nextStrafeAt = now + 1200 + brain.moveSeed % 800; }
    const sniper = botWeapon.type === 'SNIPER'; let hold = false;
    if (sniper) {
      if (bot.lastShot > (brain.sniperLastShot || 0)) { brain.sniperLastShot = bot.lastShot; brain.repositionUntil = now + Math.min(650, Math.max(350, botWeapon.fireSeconds * 500)); brain.sniperSettleAt = 0; }
      hold = perceived && now >= brain.reactAt && distance < behavior.firingRange && bot.grounded && !navigating && now >= bot.nextFireAt - 250 && now >= (brain.repositionUntil || 0) && bot.reloadUntil <= now;
      if (hold) brain.sniperSettleAt ||= now + 220; else brain.sniperSettleAt = 0;
    }
    brain.nextDuckAt ||= now + 3500 + brain.moveSeed % 2000;
    if (now >= brain.nextDuckAt && perceived && bot.grounded && !navigating && nearBotCover(bot, this.world)) { brain.duckUntil = now + 550; brain.nextDuckAt = now + 4500 + brain.moveSeed % 1500; }
    const crouch = bot.grounded && !navigating && (sniper && hold && distance > 18 || now < (brain.duckUntil || 0) || bot.reloadUntil > now && nearBotCover(bot, this.world));
    const fire = !!(ready && brain.burstLeft > 0 && now >= brain.nextBurstAt && now >= bot.nextFireAt && (!sniper || hold && now >= brain.sniperSettleAt && bot.moveSpeed < .2));
    return steerBot(bot, {
      ...EMPTY_INPUT, weaponId: bot.weaponId, yaw, pitch,
      forward: hold || target.isNavigation && !navigating ? 0 : navigating ? Math.cos(bearing) * .8 : objectiveGoal && !bot.isWaveEnemy ? Math.sin(now / 1600 + brain.moveSeed % 11) * .1 : distance > preferred + 3 ? .65 : distance < preferred - 4 ? -.35 : Math.sin(now / 1600 + brain.moveSeed % 11) * .12,
      strafe: hold ? 0 : navigating ? -Math.sin(bearing) * .8 : perceived ? brain.strafeSide * (sniper || botWeapon.type === 'DMR' ? .28 : .5) : 0,
      ads: sniper ? hold : ready && distance > 12 && ['ASSAULT', 'DMR', 'LMG'].includes(botWeapon.type),
      fire, crouch, reload: bot.ammo < 1,
    }, this.world, now);
  }

  tick(dt) {
    const now = this.clock();
    for (const [key, impact] of this.impacts) { if (now - impact.at >= BULLET_MARK_RULES.lifetimeMs) this.impacts.delete(key); else break; }
    for (const [id, drop] of this.droppedWeapons) { if (now >= drop.expiresAt) this.droppedWeapons.delete(id); else settleDroppedWeapon(drop, dt, this.world); }
    if (this.phase !== 'active') return;
    if (now >= this.endsAt) { this.finish(); return; }
    for (const player of this.players.values()) {
      if (player.roomStatus === 'waiting') continue;
      if (player.hp <= 0) { if (now >= player.respawnAt) this.spawn(player); else continue; }
      const input = player.isBot ? this.botInput(player, now, dt) : now - player.lastInput > 500 ? { ...EMPTY_INPUT, yaw: player.yaw, pitch: player.pitch, weaponId: player.weaponId } : player.input;
      movePlayer(player, input, dt, this.world, now);
      player.shotHeat = Math.max(0, (player.shotHeat || 0) - dt * 1.35);
      const weapon = getWeapon(player.weaponId);
      if (player.reloadUntil && now >= player.reloadUntil) { player.ammo = weapon.magazine; player.reloadUntil = 0; }
      if (input.reload || player.ammo === 0) this.startReload(player, now);
      if (player.pendingShot && now - player.pendingShot.at > 150) player.pendingShot = null;
      const shot = player.pendingShot || (player.isBot && input.fire && player.botBrain?.triggerPending ? { newTrigger: true, fireSeq: null } : null);
      const triggerReady = (input.fire || shot) && (weapon.automatic || !player.fireLatched || shot);
      if (weapon.burstCount && !player.burstLeft && triggerReady && !player.reloadUntil && player.ammo > 0 && now >= player.nextFireAt) player.burstLeft = weapon.burstCount;
      const ready = weapon.burstCount ? player.burstLeft > 0 : triggerReady;
      if (ready && !player.reloadUntil && (weapon.melee || player.ammo > 0) && now >= player.nextFireAt && now >= player.switchUntil) { this.shoot(player, now, shot?.ads ?? input.ads, shot || (!player.isBot && player.viewTime != null ? { viewTime: player.viewTime } : null)); player.pendingShot = null; }
      player.fireLatched = input.fire;
      player.magazines[player.weaponId] = player.ammo;
      if (this.phase !== 'active') break;
    }
    for (const player of this.players.values()) this.recordPlayerHistory(player, now);
    this.objectives?.tick(dt, now);
  }

  shoot(player, now, ads = false, shot = null) {
    if (!player || player.hp <= 0 || this.phase !== 'active' || this.players.get(player.id) !== player) return false;
    const weapon = getWeapon(player.weaponId);
    if (weapon.melee) return this.melee(player, now, shot);
    if (player.ammo <= 0) return false;
    if (shot?.newTrigger) { player.triggerSeq = shot.fireSeq; player.triggerShotIndex = 0; }
    player.triggerShotIndex++; player.shotSerial++;
    player.ammo--; player.lastShot = now; player.protectedUntil = 0;
    player.magazines[player.weaponId] = player.ammo;
    const held = player.isBot || player.input.fire, interval = shotInterval(weapon, player.triggerShotIndex, held);
    const withinBurst = weapon.burstCount && player.burstLeft > 1 || weapon.hyperburstCount && player.triggerShotIndex < weapon.hyperburstCount && held, behavior = player.botDifficulty ? getBotDifficulty(player.botDifficulty).behavior : this.botBehavior;
    player.nextFireAt = now + Math.max(interval * 1000, player.isBot && !withinBurst ? behavior.shotIntervalMs : 0);
    if (player.isBot && player.botBrain) player.botBrain.triggerPending = false;
    if (weapon.burstCount) { player.burstLeft = Math.max(0, (player.burstLeft || 0) - 1); if (player.ammo === 0) player.burstLeft = 0; if (!player.burstLeft) player.nextFireAt = Math.max(player.nextFireAt, now + weapon.burstPause * 1000); }
    if (player.isBot && player.botBrain?.burstLeft > 0) {
      player.botBrain.burstLeft--;
      if (player.botBrain.burstLeft === 0) player.botBrain.nextBurstAt = now + behavior.burstPauseMinMs + this.random() * (behavior.burstPauseMaxMs - behavior.burstPauseMinMs);
    }
    const hits = new Map(), rays = [];
    const origin = { x: player.x, y: player.y + playerPose(player).eyeHeight, z: player.z };
    const firingWeapon = player.isBot ? { ...weapon, spread: weapon.spread + behavior.shotSpread, adsSpread: weapon.adsSpread + behavior.shotSpread } : weapon;
    const targets = shot?.viewTime != null && !player.isBot ? this.playersAt(clamp(shot.viewTime, now - 200, now)) : [...this.players.values()];
    const firingState = shot?.movement ? { ...player, ...shot.movement, grounded: player.grounded && shot.movement.grounded } : player;
    for (const angle of shotAngles(firingWeapon, ads, this.random, firingState)) {
      const direction = aimDirection((shot?.yaw ?? player.yaw) + angle.yaw, (shot?.pitch ?? player.pitch) + angle.pitch);
      const trace = traceShot(player, targets, now, this.world, direction, weapon.range);
      const { headshot, end, distance, protectedTarget, friendlyTarget, bodyPart, damageMultiplier, limbProgress, surface } = trace, victim = trace.victim ? this.players.get(trace.victim.id) : null;
      if (surface) {
        if (this.gameType === 'defense' && surface.id === this.world.defenseCore.id) this.objectives.damageCore(player, damageAtDistance(weapon, distance));
        const mark = { ...surface, id: `${this.roundId}-${player.id}-${player.shotSerial}-${rays.length}`, surfaceId: surface.id, at: now, weaponId: weapon.id };
        const key = `${surface.id}/${surface.normal.x},${surface.normal.y},${surface.normal.z}/${Math.round(end.x * BULLET_MARK_RULES.cellScale)},${Math.round(end.y * BULLET_MARK_RULES.cellScale)},${Math.round(end.z * BULLET_MARK_RULES.cellScale)}`;
        this.impacts.delete(key); this.impacts.set(key, mark); while (this.impacts.size > BULLET_MARK_RULES.maxMarks) this.impacts.delete(this.impacts.keys().next().value);
        rays.push({ end, hit: null, headshot, protectedTarget, bodyPart, damageMultiplier, limbProgress, surface: mark });
      } else rays.push({ end, hit: victim?.id || null, headshot, protectedTarget, friendlyTarget, bodyPart, damageMultiplier, limbProgress });
      if (!victim || victim.hp <= 0) continue;
      const hit = hits.get(victim.id) || { victim, damage: 0, headshot: false };
      hit.damage += damageAtDistance(weapon, distance, headshot) * damageMultiplier;
      hit.headshot ||= headshot; hits.set(victim.id, hit);
    }
    player.shotHeat = Math.min(1, (player.shotHeat || 0) + (weapon.type === 'ASSAULT' ? 0.25 : 0.17));
    this.events.push({ type: 'shot', shotId: `${this.roundId}-${player.id}-${player.shotSerial}`, spawnCount: player.spawnCount, equipmentSeq: player.equipmentSeq, fireSeq: player.triggerSeq, shotIndex: player.triggerShotIndex, id: player.id, weaponId: weapon.id, suppressor: player.suppressor === true, origin, rays, end: rays[0].end, hit: rays.find((r) => r.hit)?.hit || null, headshot: rays.some((r) => r.hit && r.headshot) });
    for (const { victim, damage: rawDamage, headshot } of hits.values()) this.applyDamage(player, victim, rawDamage, headshot, origin, weapon, now);
    if (player.ammo === 0) this.startReload(player, now);
    return true;
  }

  melee(player, now, shot) {
    const weapon = getWeapon(player.weaponId);
    if (now < player.nextFireAt || now < player.switchUntil || player.reloadUntil) return false;
    if (shot?.newTrigger) { player.triggerSeq = shot.fireSeq; player.triggerShotIndex = 0; }
    player.triggerShotIndex++; player.shotSerial++; player.lastShot = now; player.protectedUntil = 0; player.nextFireAt = now + weapon.fireSeconds * 1000;
    // A blade sweep is forgiving at arm's length, never lag-rewound and never
    // allowed through cover. Only the nearest contact receives damage.
    let contact = null;
    for (const yaw of [0, -.13, .13]) for (const pitch of [0, -.1, .1]) {
      const trace = traceShot(player, this.players.values(), now, this.world, aimDirection((shot?.yaw ?? player.yaw) + yaw, (shot?.pitch ?? player.pitch) + pitch), weapon.range);
      if (!contact || (trace.victim || trace.protectedTarget || trace.friendlyTarget) && (!(contact.victim || contact.protectedTarget || contact.friendlyTarget) || trace.distance < contact.distance)) contact = trace;
    }
    const { origin, end, protectedTarget, friendlyTarget, victim } = contact;
    this.events.push({ type: 'shot', melee: true, shotId: `${this.roundId}-${player.id}-${player.shotSerial}`, spawnCount: player.spawnCount, equipmentSeq: player.equipmentSeq, fireSeq: player.triggerSeq, shotIndex: player.triggerShotIndex, id: player.id, weaponId: weapon.id, origin, end, hit: victim?.id || null, headshot: false, rays: [{ end, hit: victim?.id || null, protectedTarget, friendlyTarget, headshot: false }] });
    if (victim) this.applyDamage(player, victim, weapon.damage, false, origin, weapon, now);
    return true;
  }

  applyDamage(player, victim, rawDamage, headshot, origin, weapon, now) {
      if (this.phase !== 'active' || sameTeam(player, victim) || victim.hp <= 0) return;
      const damage = Math.round(rawDamage);
      if (damage > 0 && player.id !== victim.id) {
        const hits = (victim.damageContributors.get(player.id) || []).filter(hit => now - hit.at <= ASSIST_RULES.windowMs);
        hits.push({ damage: Math.min(victim.hp, damage), at: now }); victim.damageContributors.set(player.id, hits);
      }
      victim.hp = Math.max(0, victim.hp - damage);
      if (damage > 0) victim.hitSlowUntil = victim.hp > 0 ? now + RULES.hitSlowSeconds * 1000 : 0;
      this.events.push({ type: 'damage', id: victim.id, attacker: player.id, damage, headshot, origin, hitSlowUntil: victim.hitSlowUntil });
      if (victim.hp <= 0) {
        for (const [id, hits] of victim.damageContributors) {
          const helper = this.players.get(id);
          const recentDamage = hits.reduce((sum, hit) => sum + (now - hit.at <= ASSIST_RULES.windowMs ? hit.damage : 0), 0);
          if (id !== player.id && helper && !helper.abandoned && recentDamage >= ASSIST_RULES.minDamage && (!isTeamGame(this.gameType) || sameTeam(helper, player))) helper.assists++;
        }
        victim.damageContributors.clear();
        this.dropWeapon(victim, now); victim.reloadUntil = 0;
        victim.deaths++; victim.diedAt = now; victim.loadoutSelecting = false; victim.pendingShot = null; victim.burstLeft = 0; victim.respawnAt = now + RULES.respawnSeconds * 1000;
        if (victim.isWaveEnemy) victim.respawnAt = Infinity;
        victim.hitSlowUntil = 0;
        victim.killChain = 0; victim.lastKillAt = null;
        player.weaponKills[weapon.id] = (player.weaponKills[weapon.id] || 0) + 1;
        if (['lan', 'practice', 'casual', 'ranked'].includes(this.mode) && !isObjectiveGame(this.gameType)) player.masteryKills[weapon.id] = Math.min(1_000_000_000, (player.masteryKills[weapon.id] || 0) + 1);
        const mastery = weaponMastery(player.masteryKills[weapon.id]);
        player.killChain = player.lastKillAt !== null && now - player.lastKillAt <= 5000 ? player.killChain + 1 : 1; player.lastKillAt = now;
        victim.lastDeath = { attackerId: player.id, attackerName: player.name, attackerRankBadge: player.rankBadge, weaponId: weapon.id, weaponLevel: mastery.level, headshot, damage, at: now };
        victim.input = { ...EMPTY_INPUT, yaw: victim.yaw, pitch: victim.pitch, weaponId: victim.weaponId }; player.kills++;
        this.events.push({ type: 'kill', killId: `${this.roundId}-${player.id}-kill-${player.kills}`, at: now, killer: player.name, victim: victim.name, killerId: player.id, victimId: victim.id, killerRankBadge: player.rankBadge, victimRankBadge: victim.rankBadge, weaponId: weapon.id, weaponLevel: mastery.level, weaponKills: mastery.kills, killChain: player.killChain, headshot });
        if (this.gameType === 'teams') this.teamScores[player.teamId]++;
        if (!isObjectiveGame(this.gameType) && (this.gameType === 'teams' ? this.teamScores[player.teamId] : player.kills) >= this.fragLimit) this.finish();
      }
  }

  finish() {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    const teamGame = isTeamGame(this.gameType), defense = this.gameType === 'defense', winnerTeam = defense ? this.objectives.state.cleared >= this.waves && this.objectives.state.coreHealth > 0 ? 'blue' : 'red' : teamGame ? this.teamScores.blue > this.teamScores.red ? 'blue' : this.teamScores.red > this.teamScores.blue ? 'red' : null : null;
    const winner = [...this.players.values()].filter((p) => p.roomStatus !== 'waiting' && (!teamGame || p.teamId === winnerTeam)).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0];
    const winnerName = defense ? winnerTeam === 'blue' ? '수비 성공' : '방어 실패' : teamGame ? TEAM_NAMES[winnerTeam] || '무승부' : winner?.name || 'OPERATOR';
    const rewards = Object.fromEntries([...this.players.values()].filter((player) => !player.isBot && player.roomStatus !== 'waiting').map((player) => [player.id, { kills: player.kills, deaths: player.deaths, weaponKills: { ...player.weaponKills }, ...roundReward(player.kills, teamGame ? !!winnerTeam && player.teamId === winnerTeam : player.id === winner?.id), ...(this.mode === 'custom' || isObjectiveGame(this.gameType) ? { completion: 0, killBonus: 0, winBonus: 0, points: 0 } : {}) }]));
    this.result = { roundId: this.roundId, winnerId: winner?.id || null, winnerName, winnerKills: teamGame ? this.teamScores[winnerTeam] || 0 : winner?.kills || 0, rewards, ...(teamGame ? { winnerTeam, teamScores: { ...this.teamScores } } : {}), ...(defense ? { reason: this.objectives.state.reason || 'time-expired', cleared: this.objectives.state.cleared, totalWaves: this.waves, coreHealth: this.objectives.state.coreHealth } : {}) };
    this.events.push({ type: 'ended', winner: winnerName, winnerId: winner?.id || null, ...(teamGame ? { winnerTeam } : {}) });
    if (defense) for (const [id, player] of this.players) if (player.isWaveEnemy) this.players.delete(id);
  }

  summary() {
    const humans = [...this.players.values()].filter((p) => !p.isBot);
    return { code: this.code, mapId: this.world.id, gameType: this.gameType, botDifficulty: this.botDifficulty, fragLimit: this.fragLimit, scoreLimit: this.scoreLimit, waves: this.waves, roundSeconds: this.roundSeconds, name: this.roomName || humans.find((p) => p.id === this.hostId)?.name || 'OPERATOR', players: humans.length, bots: [...this.players.values()].filter((p) => p.isBot && !p.isWaveEnemy).length, capacity: this.gameType === 'defense' ? 4 : RULES.maxPlayers, phase: this.phase, teams: isTeamGame(this.gameType) ? Object.fromEntries(['blue', 'red'].map((team) => [team, [...this.players.values()].filter((p) => p.teamId === team).length])) : null };
  }

  impactHistory() { const now = this.clock(); return [...this.impacts.values()].filter((mark) => now - mark.at < BULLET_MARK_RULES.lifetimeMs).slice(-BULLET_MARK_RULES.historyLimit); }

  snapshot(flushEvents = true) {
    const now = this.clock();
    const result = {
      type: 'state', serverTime: now, sequence: this.snapshotSequence = (this.snapshotSequence || 0) + 1,
      room: { protocolVersion: NETWORK_PROTOCOL, code: this.code, roundId: this.roundId, result: this.result, mapId: this.world.id, gameType: this.gameType, teamScores: { ...this.teamScores }, scoreLimit: this.scoreLimit, waves: this.waves, objective: this.objectives?.snapshot(now) || null, name: this.roomName, botDifficulty: this.botDifficulty, mode: this.mode, hostId: this.hostId, phase: this.phase, timeLeft: Math.max(0, Math.ceil((this.endsAt - now) / 1000)), fragLimit: this.fragLimit, roundSeconds: this.roundSeconds },
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot, isWaveEnemy: p.isWaveEnemy, rankBadge: p.rankBadge, teamId: p.teamId, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), yaw: p.yaw, pitch: p.pitch,
        vx: p.vx, vy: p.vy, vz: p.vz, grounded: p.grounded, crouching: p.crouching, crouchAmount: p.crouchAmount, walking: p.walking, sprinting: false, moveSpeed: p.moveSpeed, stepDistance: +p.stepDistance.toFixed(3), shotHeat: p.shotHeat, hp: p.hp, ammo: p.ammo, kills: p.kills, deaths: p.deaths, assists: p.assists, spawnId: p.spawnId, spawnLevel: p.spawnLevel, lastDeath: p.lastDeath,
        reloadUntil: p.reloadUntil, respawnAt: p.respawnAt, protectedUntil: p.protectedUntil, hitSlowUntil: p.hitSlowUntil,
        weaponId: p.weaponId, weaponSkinId: p.weaponSkinId, suppressor: p.suppressor === true, suppressedWeapons: [...(p.suppressedWeapons || [])], equipmentSeq: p.equipmentSeq, nextWeaponId: p.nextWeaponId, loadoutSelecting: p.loadoutSelecting, skinId: p.skinId, outfitId: p.outfitId, characterId: p.characterId, magazines: { ...p.magazines }, switchUntil: p.switchUntil, nextFireAt: p.nextFireAt,
        spawnCount: p.spawnCount, ownedWeapons: [...p.ownedWeapons], weaponKills: { ...p.weaponKills }, masteryKills: { ...p.masteryKills }, weaponLevel: weaponMastery(p.masteryKills[p.weaponId]).level,
      })),
      droppedWeapons: [...this.droppedWeapons.values()].map(({ vy, nextFireAt, ...drop }) => ({ ...drop, x: +drop.x.toFixed(3), y: +drop.y.toFixed(3), z: +drop.z.toFixed(3) })),
      events: [...this.events],
    };
    if (flushEvents) this.events.length = 0;
    return result;
  }
}
