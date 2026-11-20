import test from 'node:test';
import assert from 'node:assert/strict';
import { EQUIPMENT, getWeapon } from '../shared/catalog.js';
import { reloadProgress, reloadFraming, reloadKind, visualInsert } from '../public/reload-time.js';

test('first-person reload visuals sample the same authoritative deadline without changing weapon clocks', () => {
  for (const weapon of EQUIPMENT) {
    const start = 125_000, duration = weapon.reloadSeconds * 1000, until = start + duration;
    assert.equal(reloadProgress(until,until,weapon),null);
    assert.equal(reloadProgress(0,start,weapon),null);
    assert.equal(reloadProgress(Infinity,start,weapon),null);
    if (weapon.melee) { assert.equal(reloadKind(weapon),null); continue; }
    assert.equal(reloadProgress(until,start-1000,weapon),0);
    assert.equal(reloadProgress(until,start,weapon),0);
    assert.ok(Math.abs(reloadProgress(until,start+duration*.63,weapon)-.63) < 1e-10);
    const motion = reloadFraming(.6,weapon), reduced = reloadFraming(.6,weapon,true);
    assert.ok(Math.abs(reduced.roll) < Math.abs(motion.roll));
    assert.ok(Object.values(reloadFraming(null,weapon)).every(delta => delta === 0));
  }
});

test('shell choreography inserts exactly the missing visual count in deterministic equal beats', () => {
  for (const id of ['shotgun','spas12','s686']) {
    const weapon = getWeapon(id), start = .29, end = .82;
    assert.equal(reloadKind(weapon),id === 's686' ? 'break' : 'shell');
    for (let count = 1; count <= weapon.magazine; count++) {
      const samples = Array.from({length: count}, (_,i) => visualInsert(start + (end-start)*(i+.48)/count,start,end,count));
      assert.deepEqual(samples.map(sample => sample.index), Array.from({length:count}, (_,i) => i));
      assert.ok(samples.every(sample => Math.abs(sample.fraction-.48) < 1e-10));
      assert.equal(visualInsert(.1,start,end,count),null); assert.equal(visualInsert(end,start,end,count),null);
    }
  }
  assert.equal(reloadKind(getWeapon('p90')),'top');
  assert.equal(reloadKind(getWeapon('m249')),'belt');
  assert.equal(reloadKind(getWeapon('rifle')),'magazine');
});
