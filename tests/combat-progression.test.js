import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, FREE_WEAPON_IDS, ownsWeapon, getWeapon } from '../shared/catalog.js';
import { createProfile, normalizeProfile, weaponMastery, recordRound, purchaseWeapon } from '../shared/progression.js';
import { Room } from '../shared/simulation.js';
import { RULES, playerPose } from '../shared/world.js';
import { EMPTY_INPUT, movePlayer } from '../shared/movement.js';
import { ShotFeedback } from '../public/shot-feedback.js';

test('twenty sequential slots swap PX–9/PD–9 and only four starters are free', () => {
  assert.deepEqual(WEAPONS.map((weapon) => weapon.slot), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(WEAPONS[1].id, 'pistol'); assert.equal(WEAPONS[4].id, 'smg'); assert.equal(WEAPONS[19].id, 'glock18c');
  assert.equal(getWeapon('glock18c').automatic, true); assert.equal(getWeapon('glock18c').magazine, 33);
  assert.deepEqual(FREE_WEAPON_IDS, ['rifle', 'pistol', 'shotgun', 'sniper']);
  for (const weapon of WEAPONS.slice(4)) assert.ok(weapon.price >= 600 && weapon.price <= 2000);
});

test('legacy profiles retain LP, total stats and cosmetics without fabricating old weapon kills', () => {
  const old = { ...createProfile('legacy-profile-0001'), points: 2000, kills: 999, deaths: 50, ownedOutfits: ['field', 'runner'], equippedOutfitId: 'runner' };
  delete old.weaponKills; delete old.ownedWeapons;
  const migrated = normalizeProfile(old, old.id);
  assert.equal(migrated.points, 2000); assert.equal(migrated.kills, 999); assert.equal(migrated.equippedOutfitId, 'runner');
  assert.deepEqual(migrated.weaponKills, {}); assert.deepEqual(migrated.ownedWeapons, FREE_WEAPON_IDS);
  const bought = purchaseWeapon(migrated, 'ak47'); assert.equal(bought.cost, 1400); assert.equal(bought.profile.points, 600);
  assert.equal(ownsWeapon(bought.profile, 'ak47'), true); assert.equal(purchaseWeapon(bought.profile, 'ak47').cost, 0);
  assert.equal(ownsWeapon(normalizeProfile(JSON.parse(JSON.stringify(bought.profile)), old.id), 'ak47'), true);
  assert.throws(() => purchaseWeapon(bought.profile, 'm82'), /부족/); assert.throws(() => purchaseWeapon(bought.profile, '__proto__'), /존재/);
  assert.equal(purchaseWeapon(bought.profile, 'rifle').cost, 0);
});

test('weapon mastery uses 50, 100, 200, 400 additional kills and doubles thereafter', () => {
  for (const [kills, level, inLevel, required] of [[0, 0, 0, 50], [49, 0, 49, 50], [50, 1, 0, 100], [149, 1, 99, 100], [150, 2, 0, 200], [350, 3, 0, 400], [750, 4, 0, 800], [1550, 5, 0, 1600]]) {
    const mastery = weaponMastery(kills); assert.equal(mastery.level, level); assert.equal(mastery.inLevel, inLevel); assert.equal(mastery.required, required); assert.equal(mastery.progress, inLevel / required);
  }
});

test('round weapon ledgers are monotonic, support late detail and never double-count kills or awards', () => {
  let profile = createProfile('mastery-profile-0001');
  const round = { roundId: 'mastery-round-0001', kills: 5, deaths: 1 };
  profile = recordRound(profile, round).profile;
  profile = recordRound(profile, { ...round, weaponKills: { rifle: 3, pistol: 2 }, completed: true }).profile;
  assert.equal(profile.kills, 5); assert.deepEqual(profile.weaponKills, { rifle: 3, pistol: 2 }); assert.equal(profile.points, 150);
  const replay = recordRound(profile, { ...round, weaponKills: { rifle: 3, pistol: 2 }, completed: true }); assert.equal(replay.changed, false);
  const stale = recordRound(profile, { ...round, kills: 2, weaponKills: { rifle: 1, pistol: 1 } }); assert.equal(stale.changed, false);
  profile = recordRound(profile, { ...round, kills: 6, weaponKills: { rifle: 3, pistol: 3 } }).profile;
  assert.deepEqual(profile.weaponKills, { rifle: 3, pistol: 3 }); assert.equal(profile.kills, 6); assert.equal(profile.points, 150);
  const inflated = recordRound(profile, { ...round, kills: 6, weaponKills: { rifle: 999, constructor: 9, unknown: 99 } }); assert.equal(inflated.changed, false);
});

test('server enforces ownership at entry and death selection while keeping starter weapons available', () => {
  const room = new Room('OWNED', { bots: 0 }), player = room.addPlayer('a', 'ALPHA', false, { weaponId: 'ak47' });
  assert.equal(player.weaponId, 'rifle'); player.hp = 0;
  assert.equal(room.selectLoadout('a', { weaponId: 'ak47' }), false);
  assert.equal(room.selectLoadout('a', { weaponId: 'pistol' }), true); room.spawn(player); assert.equal(player.weaponId, 'pistol');
  const unlocked = room.addPlayer('b', 'BRAVO', false, { ownedWeapons: ['ak47', '__proto__'], weaponId: 'ak47' }); assert.equal(unlocked.weaponId, 'ak47'); assert.equal(unlocked.hp, 100);
});

test('a dead, disconnected or post-round shooter cannot consume ammo, damage, emit a shot or resume a burst', () => {
  const room = new Room('DEAD2', { bots: 0, clock: () => 1000 }), player = room.addPlayer('a', 'ALPHA', false, { weaponId: 'famas', ownedWeapons: ['famas'] });
  player.hp = 0; player.respawnAt = 5000; player.burstLeft = 2; player.pendingShot = { at: 1000 };
  const ammo = player.ammo; room.events.length = 0;
  room.setInput('a', { ...EMPTY_INPUT, fire: true, reload: true, fireSeq: 7 }); room.tick(1 / 60);
  assert.equal(room.shoot(player, 1000), false); assert.equal(player.ammo, ammo); assert.equal(player.burstLeft, 0); assert.equal(player.pendingShot, null); assert.deepEqual(room.events, []);
  player.hp = 100; room.phase = 'ended'; assert.equal(room.shoot(player, 1000), false);
  room.phase = 'active'; room.removePlayer('a'); assert.equal(room.shoot(player, 1000), false);
});

test('kills carry persistent weapon mastery, bounded kill chains and three-second death details', () => {
  let now = 1000; const room = new Room('KILL2', { bots: 0, clock: () => now, random: () => 0 });
  room.world = { ...room.world, obstacles: [] };
  const killer = room.addPlayer('a', 'ALPHA', false, { weaponKills: { rifle: 49 } }), victim = room.addPlayer('b', 'BRAVO');
  const kill = () => {
    Object.assign(killer, { x: 0, y: 0, z: 5, yaw: 0, pitch: 0, ammo: 30 });
    Object.assign(victim, { x: 0, y: 0, z: 0, hp: 1, protectedUntil: 0 }); room.shoot(killer, now);
    return room.events.findLast((event) => event.type === 'kill');
  };
  let event = kill(); assert.equal(event.weaponLevel, 1); assert.equal(event.weaponKills, 50); assert.equal(event.killChain, 1);
  assert.equal(victim.lastDeath.attackerName, 'ALPHA'); assert.equal(victim.lastDeath.weaponLevel, 1); assert.equal(victim.lastDeath.weaponId, 'rifle'); assert.equal(victim.respawnAt - now, 3000);
  now += 2000; event = kill(); assert.equal(event.killChain, 2); now += 1000; event = kill(); assert.equal(event.killChain, 3);
  now += 5001; event = kill(); assert.equal(event.killChain, 1);
  const snapshot = room.snapshot(); assert.deepEqual(snapshot.players[0].weaponKills, { rifle: 4 }); assert.equal(snapshot.players[0].masteryKills.rifle, 53);
  room.finish(); assert.equal(room.result.rewards.a.weaponKills.rifle, 4); room.restart('a'); assert.deepEqual(killer.weaponKills, {}); assert.equal(killer.masteryKills.rifle, 53); assert.equal(victim.lastDeath, null);
});

test('shot sound feedback is sequence-based, survives delayed ACKs and ignores duplicate events', () => {
  const feedback = new ShotFeedback(); feedback.predict(4, 1); feedback.predict(4, 2); feedback.predict(9, 1);
  const shot = { id: 'me', shotId: 'round-me-1', fireSeq: 4, shotIndex: 1, weaponId: 'ak47' };
  assert.deepEqual(feedback.acknowledge(shot), { duplicate: false, predicted: true });
  assert.deepEqual(feedback.acknowledge(shot), { duplicate: true, predicted: false });
  assert.equal(feedback.acknowledge({ ...shot, shotId: 'round-me-2', shotIndex: 2 }).predicted, true);
  assert.equal(feedback.acknowledge({ ...shot, shotId: 'round-me-3', fireSeq: 8 }).predicted, false);
  assert.equal(feedback.acknowledge({ ...shot, shotId: 'round-me-4', fireSeq: 9 }).predicted, true);
  for (let i = 0; i < 3000; i++) feedback.predict(100 + i, 1); assert.ok(feedback.predictions.size <= 2048);
  feedback.reset(); assert.equal(feedback.predictions.size, 0); assert.equal(feedback.events.size, 0);
});

test('old-life input cannot overwrite an exit-facing respawn yaw or re-arm a previous trigger', () => {
  let now = 1000; const room = new Room('LIFE2', { bots: 0, clock: () => now, random: () => 0 }), player = room.addPlayer('a', 'ALPHA');
  const oldLife = player.spawnCount; player.hp = 0; room.spawn(player); const yaw = player.yaw;
  room.setInput(player.id, { ...EMPTY_INPUT, spawnCount: oldLife, yaw: yaw + 1, fire: true, fireSeq: 1 }); now += 17; room.tick(1 / 60);
  assert.equal(player.yaw, yaw); assert.equal(player.input.fire, false); assert.equal(player.pendingShot, null); assert.equal(player.ammo, 30);
  room.setInput(player.id, { ...EMPTY_INPUT, spawnCount: player.spawnCount, yaw: yaw + 0.2 }); room.tick(1 / 60); assert.equal(player.yaw, yaw + 0.2);
});

test('standing/crouching eye height and hitbox transition over 100ms at 30–144Hz', () => {
  const world = { width: 20, depth: 20, obstacles: [] };
  for (const hz of [30, 60, 120, 144]) {
    const player = { x: 0, y: 0, z: 0, vy: 0, grounded: true, crouchAmount: 0 };
    movePlayer(player, { ...EMPTY_INPUT, crouch: true }, 1 / hz, world);
    assert.ok(player.crouchAmount > 0 && player.crouchAmount < 1); assert.ok(playerPose(player).eyeHeight > RULES.crouchEyeHeight && playerPose(player).eyeHeight < RULES.eyeHeight);
    for (let i = 1; i < Math.ceil(hz * 0.1); i++) movePlayer(player, { ...EMPTY_INPUT, crouch: true }, 1 / hz, world);
    assert.equal(player.crouchAmount, 1); assert.equal(playerPose(player).eyeHeight, RULES.crouchEyeHeight);
    for (let i = 0; i < Math.ceil(hz * 0.1); i++) movePlayer(player, EMPTY_INPUT, 1 / hz, world);
    assert.equal(player.crouchAmount, 0); assert.equal(playerPose(player).eyeHeight, RULES.eyeHeight);
  }
});
