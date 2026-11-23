import assert from 'node:assert/strict';
import test from 'node:test';
import { ShootingRange } from '../shared/shooting-range.js';
import { RANGE_DISTANCES, RANGE_TARGET, RANGE_WORLD } from '../shared/range-world.js';
import { getWeapon, ownsWeapon, WEAPONS } from '../shared/catalog.js';
import { MAPS } from '../shared/world.js';
import { recordsLocalProgress } from '../public/play-modes.js';

function fixture(options) {
  let now = 1000;
  const room = new ShootingRange('viewer', 'VIEWER', options, { clock: () => now, random: () => 0 });
  const shooter = room.players.get('viewer');
  return { room, shooter, target: room.players.get(RANGE_TARGET.id),
    shoot() { return room.shoot(shooter, now, true); }, tick(ms) { now += ms; room.tick(1 / 60); } };
}

test('the fixed range has no time cap, enemy attacks, or profile rewards', () => {
  const { room, shooter, target, tick } = fixture();
  assert.ok(!MAPS.some(map => map.id === RANGE_WORLD.id));
  assert.equal(shooter.z - target.z, 30);
  assert.ok(WEAPONS.every(weapon => ownsWeapon(shooter, weapon.id)));
  tick(3_600_001);
  const state = room.snapshot();
  assert.equal(state.room.phase, 'active');
  assert.equal(state.room.timeLeft, null);
  assert.equal(recordsLocalProgress(state.room), false);
  assert.equal(target.z, RANGE_TARGET.z);
  assert.ok(!room.shoot(target, room.clock(), false));
});

test('a real hit, a miss at the target plane, and a ray that never reaches the plane are distinguished', () => {
  const { room, shooter, target, shoot } = fixture();
  assert.ok(shoot());
  shooter.yaw = .027;
  assert.ok(shoot());
  shooter.yaw = Math.PI / 2;
  assert.ok(shoot());
  const { range, events } = room.snapshot();
  assert.deepEqual([range.shots, range.hits, range.outside], [3, 1, 1]);
  assert.deepEqual(range.points.map(point => point.hit), [true, false]);
  assert.equal(range.points[0].x, 0);
  assert.ok(Math.abs(range.points[1].x) > .5);
  assert.ok(events.some(event => event.type === 'shot' && event.hit === target.id));
  assert.equal(shooter.kills, 0);
  assert.equal(target.hp, 100);
  assert.deepEqual(shooter.masteryKills, {});
});

test('selecting a supported distance and weapon resets marks, ammo, and the old shot state', () => {
  const { room, shooter, target, shoot } = fixture();
  assert.ok(shoot());
  const roundId = room.roundId;
  assert.equal(room.configure({ roundId, distance: 11, weaponId: 'ak47' }), false);
  assert.equal(room.configure({ roundId, distance: 10, weaponId: 'knife' }), false);
  for (const distance of RANGE_DISTANCES) {
    const oldRound = room.roundId;
    assert.ok(room.configure({ roundId: oldRound, distance, weaponId: 'ak47' }));
    assert.notEqual(room.roundId, oldRound);
    assert.equal(shooter.z - target.z, distance);
    assert.equal(target.weaponId, 'rifle');
    assert.equal(shooter.weaponId, 'ak47');
    assert.equal(shooter.ammo, getWeapon('ak47').magazine);
    assert.equal(room.snapshot().range.shots, 0);
  }
  assert.equal(room.configure({ roundId, distance: 10, weaponId: 'rifle' }), false);
});

test('one trigger counts once even with many pellets, and the next magazine starts a new group', () => {
  const { room, shooter, shoot, tick } = fixture({ weaponId: 's686', distance: 10 });
  assert.ok(shoot() && shoot());
  assert.equal(room.snapshot().range.shots, 2);
  assert.equal(room.snapshot().range.hits, 2);
  assert.equal(shooter.ammo, 0);
  tick(getWeapon('s686').reloadSeconds * 1000 + 1);
  assert.ok(shoot());
  const { range } = room.snapshot();
  assert.deepEqual([range.shots, range.hits], [1, 1]);
  assert.ok(range.points.length + range.outside <= getWeapon('s686').pellets);
});
