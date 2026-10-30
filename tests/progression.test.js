import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, normalizeProfile, profileStats, roundReward, recordRound, purchaseOutfit, equipOutfit, applyProfileOperation } from '../shared/progression.js';
import { OUTFITS, getOutfit, CHARACTERS, getCharacter } from '../shared/outfits.js';
import { Room } from '../shared/simulation.js';
import { playerPose } from '../shared/world.js';
import { movementSpeed, EMPTY_INPUT } from '../shared/movement.js';
import { ProfileStore, PROFILE_KEY } from '../public/profile.js';

const identity = 'device-test-0001';
const round = (extra = {}) => ({ roundId: 'round-test-0001', kills: 5, deaths: 2, ...extra });
function memoryStorage() { const data = new Map(); return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) }; }

test('new profiles start without points, retain a device ID and expose correct K/D statistics', () => {
  const profile = createProfile(identity, 1000, 'ALPHA');
  assert.equal(profile.id, identity); assert.equal(profile.points, 0); assert.deepEqual(profile.ownedOutfits, ['field']);
  const stats = profileStats({ kills: 8, deaths: 4 });
  assert.equal(stats.kills, 8); assert.equal(stats.deaths, 4); assert.equal(stats.ratio, 2); assert.ok(Math.abs(stats.killRate - 100 * 8 / 12) < 1e-9);
  assert.equal(profileStats({ kills: 0, deaths: 0 }).ratio, 0); assert.equal(profileStats({ kills: 3, deaths: 0 }).ratio, 3);
  for (const field of ['hostname', 'mac', 'ip', 'email', 'account']) assert.equal(profile[field], undefined);
});

test('both adult characters are free, persistent and preserve existing cosmetics, mastery and points', async () => {
  const old = { ...createProfile(identity), points: 1500, kills: 300, ownedOutfits: ['field', 'runner'], equippedOutfitId: 'runner', weaponKills: { rifle: 150 }, ownedWeapons: ['rifle', 'ak47'] }; delete old.characterId;
  let profile = normalizeProfile(old, identity); assert.equal(profile.characterId, 'male'); assert.equal(getCharacter('__proto__').id, 'male');
  for (const character of CHARACTERS) {
    profile = applyProfileOperation(profile, { type: 'character', characterId: character.id }).profile;
    assert.equal(profile.characterId, character.id); assert.equal(profile.points, 1500); assert.equal(profile.equippedOutfitId, 'runner'); assert.equal(profile.weaponKills.rifle, 150); assert.ok(profile.ownedWeapons.includes('ak47'));
    const room = new Room('GENDER', { bots: 0 }), p = room.addPlayer('a', 'ALPHA', false, { characterId: character.id, outfitId: 'runner' });
    assert.equal(p.hp, 100); assert.equal(playerPose(p).height, 1.8); assert.equal(movementSpeed(p, { ...EMPTY_INPUT, forward: 1 }), 5.7);
    assert.equal(room.snapshot().players[0].characterId, character.id); room.spawn(p); assert.equal(p.characterId, character.id);
  }
  assert.throws(() => applyProfileOperation(profile, { type: 'character', characterId: 'unknown' }), /존재/);
  const storage = memoryStorage(); storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  const store = await new ProfileStore({ storage }).load(); await store.setCharacter('female');
  const restored = await new ProfileStore({ storage }).load(); assert.equal(restored.profile.characterId, 'female'); assert.equal(restored.profile.points, 1500); assert.equal(restored.profile.equippedOutfitId, 'runner');
});

test('live kills/deaths persist but points are granted only once after round completion', () => {
  let profile = createProfile(identity);
  profile = recordRound(profile, round()).profile;
  assert.equal(profile.kills, 5); assert.equal(profile.deaths, 2); assert.equal(profile.points, 0); assert.equal(profile.roundsPlayed, 0);
  const final = recordRound(profile, round({ completed: true, won: true })); profile = final.profile;
  assert.equal(profile.points, 250); assert.equal(profile.roundsPlayed, 1); assert.equal(profile.wins, 1);
  assert.deepEqual(final.award, { completion: 50, killBonus: 100, winBonus: 100, points: 250, won: true });
  const replay = recordRound(profile, round({ completed: true, won: true })); assert.equal(replay.changed, false); assert.equal(replay.profile.points, 250);
  profile = normalizeProfile(JSON.parse(JSON.stringify(profile)), identity);
  assert.equal(recordRound(profile, round({ completed: true, won: true })).profile.points, 250);
  assert.equal(recordRound(profile, round({ kills: 1, deaths: 1 })).profile.kills, 5);
});

test('leaving one round cannot claim completion points and a new round has its own ledger', () => {
  let profile = recordRound(createProfile(identity), round({ kills: 3 })).profile;
  profile = recordRound(profile, round({ roundId: 'round-test-0002', kills: 2, deaths: 1, completed: true })).profile;
  assert.equal(profile.kills, 5); assert.equal(profile.deaths, 3); assert.equal(profile.points, 90); assert.equal(profile.roundsPlayed, 1);
  assert.equal(profile.roundLedger['round-test-0001'].awarded, false);
});

test('outfit purchases validate balance, charge once and cannot equip unowned outfits', () => {
  const original = createProfile(identity); original.points = 249;
  assert.throws(() => purchaseOutfit(original, 'runner'), /부족/); assert.equal(original.points, 249); assert.deepEqual(original.ownedOutfits, ['field']);
  original.points = 250;
  const bought = purchaseOutfit(original, 'runner'); assert.equal(bought.cost, 250); assert.equal(bought.profile.points, 0); assert.equal(bought.profile.equippedOutfitId, 'runner');
  assert.equal(purchaseOutfit(bought.profile, 'runner').cost, 0); assert.equal(bought.profile.ownedOutfits.filter((id) => id === 'runner').length, 1);
  assert.throws(() => equipOutfit(bought.profile, 'orbital'), /보유/); assert.throws(() => purchaseOutfit(original, '../unknown'), /존재/);
});

test('profile normalization blocks malformed values and prototype-shaped IDs', () => {
  const profile = normalizeProfile({ id: '__proto__', points: -5, kills: Infinity, deaths: 1.5, ownedOutfits: ['runner', 'unknown', 'runner'], equippedOutfitId: 'orbital', roundLedger: JSON.parse('{"constructor":{"kills":9,"awarded":true},"__proto__":{"kills":9}}') }, identity);
  assert.equal(profile.id, identity); assert.equal(profile.points, 0); assert.equal(profile.kills, 0); assert.equal(profile.deaths, 0);
  assert.deepEqual(profile.ownedOutfits, ['field', 'runner']); assert.equal(profile.equippedOutfitId, 'field'); assert.deepEqual(profile.roundLedger, {});
  assert.equal(recordRound(profile, round({ roundId: 'constructor', completed: true })).changed, false);
  assert.throws(() => applyProfileOperation(profile, { type: 'give-points', points: 9999 }), /지원하지/);
});

test('outfits are cosmetic only: identical health, posture, speed and weapon state', () => {
  const baselinePose = playerPose({ crouching: true }), speed = movementSpeed({ weaponId: 'rifle' }, { ...EMPTY_INPUT, forward: 1 });
  for (const outfit of OUTFITS) {
    for (const field of ['hp', 'damage', 'armorBonus', 'speed', 'walkMultiplier', 'hitbox']) assert.equal(outfit[field], undefined);
    const room = new Room('LOOK2', { bots: 0 }); const player = room.addPlayer('human', 'HUMAN', false, { outfitId: outfit.id, hp: 999, speed: 999 });
    assert.equal(player.hp, 100); assert.equal(player.outfitId, outfit.id); assert.equal(movementSpeed(player, { ...EMPTY_INPUT, forward: 1 }), speed);
    assert.deepEqual(playerPose({ ...player, crouching: true, crouchAmount: 1 }), baselinePose);
    assert.equal(room.snapshot().players[0].outfitId, outfit.id);
  }
  assert.equal(getOutfit('invalid').id, 'field');
});

test('room finish freezes rewards once, excludes bots/late joiners and restart creates a new round ID', () => {
  const room = new Room('PAY22', { bots: 1 }); const a = room.addPlayer('a', 'ALPHA'), b = room.addPlayer('b', 'BRAVO');
  a.kills = 5; a.deaths = 2; b.kills = 3; b.deaths = 3;
  const id = room.roundId; room.finish();
  assert.equal(room.result.rewards.a.points, 250); assert.equal(room.result.rewards.b.points, 110);
  assert.equal(Object.keys(room.result.rewards).length, 2); assert.equal(room.result.winnerId, 'a');
  room.finish(); assert.equal(room.events.filter((event) => event.type === 'ended').length, 1);
  room.addPlayer('late', 'LATE'); assert.equal(room.result.rewards.late, undefined);
  room.restart('a'); assert.notEqual(room.roundId, id); assert.equal(room.result, null); assert.equal(room.snapshot().room.result, null);
});

test('browser storage restores identity, statistics, points and purchased outfits without a network service', async () => {
  const storage = memoryStorage(); let network = 0;
  const store = await new ProfileStore({ storage, fetcher: async () => { network++; }, name: 'ALPHA' }).load(); const id = store.profile.id;
  await store.syncRound(round({ kills: 20, completed: true })); await store.purchase('runner');
  const restored = await new ProfileStore({ storage, name: 'OTHER' }).load();
  assert.equal(restored.profile.id, id); assert.equal(restored.profile.callsign, 'ALPHA'); assert.equal(restored.profile.kills, 20); assert.equal(restored.profile.points, 200); assert.equal(restored.profile.equippedOutfitId, 'runner');
  assert.equal(network, 0); assert.ok(storage.getItem(PROFILE_KEY));
});

test('host operation queue uses canonical balances and does not duplicate round rewards', async () => {
  let hostProfile = createProfile('host-test-0001'); let posts = 0;
  const fetcher = async (_url, options = {}) => {
    if (!options.method) return new Response(JSON.stringify({ profile: hostProfile }));
    posts++; const result = applyProfileOperation(hostProfile, JSON.parse(options.body)); hostProfile = result.profile;
    return new Response(JSON.stringify({ profile: hostProfile, award: result.award, cost: result.cost }));
  };
  const store = await new ProfileStore({ storage: memoryStorage(), host: true, fetcher }).load();
  assert.equal(store.scope, 'host'); assert.equal(store.profile.id, 'host-test-0001');
  await Promise.all([store.setName('ALPHA'), store.syncRound(round({ kills: 20, completed: true }))]);
  await store.purchase('runner'); assert.equal(hostProfile.points, 200); assert.equal(store.profile.points, 200);
  const priorPosts = posts; await store.syncRound(round({ kills: 20, completed: true })); assert.equal(posts, priorPosts);
});

test('host conflicts roll back an optimistic purchase rather than granting a free outfit', async () => {
  let hostProfile = createProfile('host-test-0002'); hostProfile.points = 250;
  const storage = memoryStorage();
  const fetcher = async (_url, options = {}) => {
    if (!options.method) return new Response(JSON.stringify({ profile: hostProfile }));
    return new Response(JSON.stringify({ message: '포인트가 부족합니다.', profile: hostProfile }), { status: 409 });
  };
  const store = await new ProfileStore({ storage, host: true, fetcher }).load(); hostProfile = { ...hostProfile, points: 0 };
  await assert.rejects(store.purchase('runner'), /부족/); assert.equal(store.profile.points, 0); assert.deepEqual(store.profile.ownedOutfits, ['field']); assert.equal(store.saving, false);
});

test('temporary host write failures retain retry operations and settle safely after reconnect', async () => {
  let hostProfile = createProfile('host-test-0003'), fail = true;
  const storage = memoryStorage();
  const fetcher = async (_url, options = {}) => {
    if (!options.method) return new Response(JSON.stringify({ profile: hostProfile }));
    if (fail) throw new TypeError('Temporary connection failure');
    const result = applyProfileOperation(hostProfile, JSON.parse(options.body)); hostProfile = result.profile;
    return new Response(JSON.stringify({ profile: hostProfile, award: result.award }));
  };
  const store = await new ProfileStore({ storage, host: true, fetcher }).load();
  const saved = store.syncRound(round({ completed: true, won: true })); await new Promise(setImmediate);
  clearTimeout(store.retry); assert.equal(store.saving, true); assert.ok(store.warning);
  fail = false; await store.drain(); await saved;
  assert.equal(hostProfile.points, roundReward(5, true).points); assert.equal(store.saving, false); assert.equal(store.warning, null);
});
