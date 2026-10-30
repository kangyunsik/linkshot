import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, RULES, bounds, playerPose } from '../shared/world.js';
import { movePlayer, EMPTY_INPUT } from '../shared/movement.js';

const player = (extra = {}) => ({ x: 0, y: 0, z: 4, yaw: 0, pitch: 0, vy: 0, grounded: true, weaponId: 'rifle', ...extra });
const input = (extra = {}) => ({ ...EMPTY_INPUT, ...extra });
const arena = (obstacles = []) => ({ width: 30, depth: 30, obstacles });
const deck = { x: 0, y: 0, z: 0, w: 4, d: 4, h: 1.8 };
const rates = [30, 60, 120, 144];
function clearBody(p, world) {
  return world.obstacles.every((box) => {
    const b = bounds(box, RULES.playerRadius - 0.00001);
    return !(p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && p.y < b.maxY - 0.00001 && p.y + playerPose(p).height > b.minY + 0.00001);
  });
}

test('ledge support uses the same footprint as side collisions, without sinking or ejecting', () => {
  const world = arena([deck]);
  for (const hz of rates) for (const edge of [2.24, 2.29, 2.339]) {
    const p = player({ x: edge, y: 1.8, z: 1 });
    for (let i = 0; i < hz / 4; i++) {
      movePlayer(p, input({ forward: 1 }), 1 / hz, world);
      assert.equal(p.y, 1.8, `${hz}Hz edge ${edge}`); assert.equal(p.grounded, true);
      assert.ok(clearBody(p, world));
    }
    assert.ok(p.z < 0, 'walking along the edge must make progress');
  }
});

test('walking off a deck releases support and falls without sideways teleports', () => {
  const world = arena([deck]);
  for (const hz of rates) {
    const p = player({ x: 2.29, y: 1.8, z: 0 });
    for (let i = 0; i < hz; i++) {
      const x = p.x; movePlayer(p, input({ strafe: 1 }), 1 / hz, world);
      assert.ok(p.x >= x && p.x - x <= RULES.walkSpeed / hz + 0.00001);
      assert.ok(clearBody(p, world));
    }
    assert.equal(p.y, 0); assert.equal(p.grounded, true);
  }
});

test('standing jumps land on 1.15m cover and 1.8m decks at all frame rates', () => {
  for (const hz of rates) for (const h of [1.15, 1.8]) {
    const world = arena([{ ...deck, h }]), p = player({ z: 2 + RULES.playerRadius }); let landed = false;
    for (let i = 0; i < hz * 1.4; i++) {
      movePlayer(p, input({ jump: true, forward: p.z > 0.7 ? 1 : 0 }), 1 / hz, world);
      assert.ok(clearBody(p, world), `${hz}Hz/${h}m: no solid penetration`);
      if (p.grounded && p.y === h) landed = true;
    }
    assert.ok(landed, `${hz}Hz/${h}m must be reachable from a wall-adjacent jump`);
    assert.equal(p.y, h); assert.equal(p.grounded, true);
  }
});

test('jump height is frame-rate independent, but high walls remain unclimbable', () => {
  const peaks = [];
  for (const hz of rates) {
    const p = player({ x: 8 }); let peak = 0;
    for (let i = 0; i < hz * 1.4; i++) { movePlayer(p, input({ jump: true }), 1 / hz, arena()); peak = Math.max(peak, p.y); }
    peaks.push(peak); assert.ok(peak > 2 && peak < 2.15); assert.equal(p.y, 0);
    const world = arena([{ ...deck, h: 2.6 }]), blocked = player({ z: 2 + RULES.playerRadius });
    for (let i = 0; i < hz * 1.5; i++) movePlayer(blocked, input({ jump: true, forward: 1 }), 1 / hz, world);
    assert.ok(blocked.z >= 2 + RULES.playerRadius - 0.00001); assert.equal(blocked.y, 0);
  }
  assert.ok(Math.max(...peaks) - Math.min(...peaks) < 0.004);
});

test('every actual 1.8m firing deck can be jumped onto from its non-stair side', () => {
  for (const world of MAPS) for (const platform of world.platforms) for (const hz of [30, 60, 144]) {
    const p = player({ x: platform.x, z: platform.z + 2.5 + RULES.playerRadius }); let landed = false;
    for (let i = 0; i < hz * 1.3; i++) {
      movePlayer(p, input({ jump: true, forward: p.z > platform.z + 1.5 ? 0.35 : 0 }), 1 / hz, world);
      assert.ok(clearBody(p, world), `${world.id}/${platform.id}: jump never enters solid geometry`);
      landed ||= p.grounded && p.y === platform.height;
    }
    assert.ok(landed, `${world.id}/${platform.id}/${hz}Hz`);
  }
});

test('all staircases support diagonal ascent, edge traversal and grounded descent', () => {
  for (const world of MAPS) for (const platform of world.platforms) for (const hz of [30, 60, 144]) {
    const p = player({ x: platform.approach.x - 0.7, z: platform.approach.z });
    let top = 0;
    for (let i = 0; i < hz * 1.2; i++) {
      movePlayer(p, input({ forward: 1, yaw: Math.PI, strafe: p.x < platform.x ? -0.3 : 0 }), 1 / hz, world);
      assert.ok(clearBody(p, world), `${world.id}/${platform.id} ascent`); top = Math.max(top, p.y);
    }
    assert.equal(top, platform.height, `${world.id}/${platform.id}/${hz}Hz`);
    Object.assign(p, { x: platform.x + 1.7, z: platform.z + 1.3, y: platform.height, vy: 0, grounded: true });
    for (let i = 0; i < hz / 4; i++) { movePlayer(p, input({ forward: 0.4 }), 1 / hz, world); assert.equal(p.y, platform.height); }
    Object.assign(p, { x: platform.x, z: platform.z + 1.4, y: platform.height, vy: 0, grounded: true });
    for (let i = 0; i < hz * 1.1; i++) {
      movePlayer(p, input({ forward: 1 }), 1 / hz, world);
      assert.ok(clearBody(p, world)); assert.equal(p.grounded, true, 'normal stair descent must keep feet supported');
    }
    assert.equal(p.y, 0);
  }
});

test('auto-step never raises a player through a ceiling or climbs an oversized riser', () => {
  const world = arena([{ ...deck, h: 0.45 }, { ...deck, y: 1.9, h: 0.25 }]);
  const p = player({ z: 2 + RULES.playerRadius });
  for (let i = 0; i < 120; i++) { movePlayer(p, input({ forward: 1 }), 1 / 60, world); assert.ok(clearBody(p, world)); }
  assert.equal(p.y, 0); assert.ok(p.z >= 2 + RULES.playerRadius - 0.00001);
  const tall = arena([{ ...deck, h: RULES.stepHeight + 0.03 }]);
  for (let i = 0; i < 120; i++) movePlayer(p, input({ forward: 1 }), 1 / 60, tall);
  assert.equal(p.y, 0);
});

test('upward collision uses the full footprint and cannot pass through a ceiling edge', () => {
  const world = arena([{ ...deck, y: 2, h: 0.25 }]);
  for (const hz of rates) {
    const p = player({ x: 2.29, z: 0 }); let head = 0;
    for (let i = 0; i < hz; i++) { movePlayer(p, input({ jump: true }), 1 / hz, world); head = Math.max(head, p.y + playerPose(p).height); }
    assert.ok(head <= 2.00001); assert.equal(p.y, 0);
  }
});

test('airborne direction and speed remain fixed despite WASD, mouse turns, sprint and ADS changes', () => {
  for (const hz of rates) for (const sprint of [false, true]) {
    const world = { width: 100, depth: 100, obstacles: [] }, p = player({ x: 0, z: 0 });
    movePlayer(p, input({ jump: true, forward: 1, sprint }), 1 / hz, world);
    const vx = p.vx, vz = p.vz, speed = Math.hypot(vx, vz);
    for (let frame = 0; frame < hz / 2; frame++) {
      const before = { x: p.x, z: p.z };
      movePlayer(p, input({ yaw: frame % 2 ? Math.PI / 2 : Math.PI, pitch: 0.4, forward: frame % 3 - 1, strafe: frame % 2 ? -1 : 1, sprint: !sprint, ads: true }), 1 / hz, world);
      assert.equal(p.grounded, false); assert.equal(p.vx, vx); assert.equal(p.vz, vz);
      assert.ok(Math.abs(p.x - before.x - vx / hz) < 1e-9); assert.ok(Math.abs(p.z - before.z - vz / hz) < 1e-9);
      assert.ok(Math.abs(p.moveSpeed - speed) < 1e-9); assert.equal(p.pitch, 0.4, 'aiming is independent of the locked trajectory');
    }
    while (!p.grounded) movePlayer(p, input(), 1 / hz, world);
    const before = { x: p.x, z: p.z }; movePlayer(p, input({ strafe: 1 }), 1 / hz, world);
    assert.ok(p.x > before.x); assert.equal(p.z, before.z, 'landing restores ground steering');
  }
});

test('a standing jump cannot gain movement in midair and a ledge fall retains its departure momentum', () => {
  const world = arena(), p = player({ x: 0, z: 0 }); movePlayer(p, input({ jump: true }), 1 / 60, world);
  for (let i = 0; i < 30; i++) movePlayer(p, input({ forward: 1, strafe: 1, sprint: true, yaw: Math.PI / 2 }), 1 / 60, world);
  assert.equal(p.x, 0); assert.equal(p.z, 0);
  const falling = player({ x: 2.3, y: 1.8, z: 0 }); const ledge = arena([deck]);
  while (falling.grounded) movePlayer(falling, input({ strafe: 1 }), 1 / 60, ledge);
  const before = { x: falling.x, z: falling.z }; movePlayer(falling, input({ forward: -1, yaw: Math.PI, ads: true }), 1 / 60, ledge);
  assert.ok(falling.x > before.x); assert.equal(falling.z, before.z);
});
