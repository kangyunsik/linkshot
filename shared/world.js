export const RULES = Object.freeze({
  tickRate: 60, snapshotRate: 20, maxPlayers: 8, roundSeconds: 300,
  fragLimit: 20, magazine: 30, reloadSeconds: 1.75, fireSeconds: 0.105,
  respawnSeconds: 3, protectionSeconds: 1.5, damage: 28, headDamage: 48,
  playerRadius: 0.34, playerHeight: 1.8, eyeHeight: 1.62,
  crouchHeight: 1.1, crouchEyeHeight: 0.92, crouchSpeed: 2.565,
  walkSpeed: 5.7, sprintSpeed: 8.55, stepHeight: 0.48,
  switchSeconds: 0.32,
});

const STANDING_POSE = Object.freeze({ height: RULES.playerHeight, eyeHeight: RULES.eyeHeight, headHeight: 1.58, headRadius: 0.25, bodyTop: 1.4, aimHeight: 1.05 });
const CROUCHING_POSE = Object.freeze({ height: RULES.crouchHeight, eyeHeight: RULES.crouchEyeHeight, headHeight: 0.88, headRadius: 0.22, bodyTop: 0.7, aimHeight: 0.55 });
export const playerPose = (player) => player?.crouching === true ? CROUCHING_POSE : STANDING_POSE;

// Horizontal bearing of an incoming shot relative to the viewer: front=0, right=+PI/2.
export function damageBearing(viewer, source, yaw = viewer?.yaw ?? 0) {
  if (![viewer?.x, viewer?.z, source?.x, source?.z, yaw].every(Number.isFinite)) return null;
  const dx = source.x - viewer.x, dz = source.z - viewer.z;
  if (Math.hypot(dx, dz) < 0.05) return null;
  return Math.atan2(dx * Math.cos(yaw) - dz * Math.sin(yaw), -dx * Math.sin(yaw) - dz * Math.cos(yaw));
}

function block(id, x, z, w, d, h, kind = 'container', color = 'slate') {
  return { id, x, z, w, d, h, y: 0, kind, color };
}

const FOUNDRY = Object.freeze({
  id: 'foundry', name: 'FOUNDRY 07', title: 'FOUNDRY', label: '파운드리', width: 56, depth: 46,
  tag: '근접 교전', theme: 'industrial', image: 'foundry-hero.png',
  description: '중앙 반응로와 컨테이너를 둘러싼 짧고 빠른 교전. 엄폐물을 활용해 측면을 노리세요.',
  sky: '#213947', ground: '#929997', wall: '#40525a', accent: '#b55d39', light: '#ffe2b9',
  obstacles: [
    block('north', 0, -23.5, 57, 1, 7, 'wall'),
    block('south', 0, 23.5, 57, 1, 7, 'wall'),
    block('west', -28.5, 0, 1, 48, 7, 'wall'),
    block('east', 28.5, 0, 1, 48, 7, 'wall'),
    block('reactor', 0, 0, 5, 5, 3.7, 'reactor'),
    block('container-nw', -12, -9, 9, 3.3, 3.1, 'container', 'orange'),
    block('container-se', 12, 9, 9, 3.3, 3.1, 'container', 'orange'),
    block('container-sw', -12, 9, 7, 3.3, 2.7),
    block('container-ne', 12, -9, 7, 3.3, 2.7),
    block('cover-nw', -5, -9, 2.4, 2.4, 1.65, 'crate'),
    block('cover-se', 5, 9, 2.4, 2.4, 1.65, 'crate'),
    block('cover-w', -18, 0, 3.4, 4, 2, 'crate'),
    block('cover-e', 18, 0, 3.4, 4, 2, 'crate'),
    block('low-n', 0, -16, 5, 2, 1.15, 'crate', 'orange'),
    block('low-s', 0, 16, 5, 2, 1.15, 'crate', 'orange'),
    block('crate-nw', -22, -12, 2, 2, 1.5, 'crate'),
    block('crate-se', 22, 12, 2, 2, 1.5, 'crate'),
  ],
  spawns: [
    { x: -23, z: 18, yaw: -0.907 }, { x: 23, z: -18, yaw: 2.235 },
    { x: -23, z: -18, yaw: -2.235 }, { x: 23, z: 18, yaw: 0.907 },
    { x: 0, z: -20, yaw: Math.PI }, { x: 0, z: 20, yaw: 0 },
    { x: -24, z: 2, yaw: -Math.PI / 2 }, { x: 24, z: -2, yaw: Math.PI / 2 },
  ],
});

function arena(config, obstacles) {
  const { width: w, depth: d } = config;
  const points = [[-w / 2 + 5, d / 2 - 5], [w / 2 - 5, -d / 2 + 5], [-w / 2 + 5, -d / 2 + 5], [w / 2 - 5, d / 2 - 5], [0, -d / 2 + 4], [0, d / 2 - 4], [-w / 2 + 4, 0], [w / 2 - 4, 0]];
  return Object.freeze({
    ...config,
    obstacles: [block('north', 0, -d / 2 - 0.5, w + 2, 1, 7, 'wall'), block('south', 0, d / 2 + 0.5, w + 2, 1, 7, 'wall'), block('west', -w / 2 - 0.5, 0, 1, d + 2, 7, 'wall'), block('east', w / 2 + 0.5, 0, 1, d + 2, 7, 'wall'), ...obstacles],
    spawns: points.map(([x, z]) => ({ x, z, yaw: Math.atan2(x, z) })),
  });
}

const longrail = arena({
  id: 'longrail', name: 'LONGRAIL 12', title: 'LONGRAIL', label: '롱레일', width: 42, depth: 112,
  tag: '장거리 · 세로형', theme: 'rail', image: 'longrail-hero.png',
  description: '112m 길이의 화물 철도. 두 개의 선로와 끊어진 화차 사이로 긴 시야와 우회로가 교차합니다.',
  sky: '#283b51', ground: '#848a92', wall: '#41516b', accent: '#a06c40', light: '#ffdfc2',
}, [
  ...[-34, -12, 12, 34].map((z, i) => block(`train-west-${i}`, -7, z, 4, 13, 3.2, 'container', i % 2 ? 'slate' : 'orange')),
  ...[-25, 0, 25].map((z, i) => block(`train-east-${i}`, 7, z, 4, 14, 3.2, 'container', i % 2 ? 'orange' : 'slate')),
  ...[-42, -20, 20, 42].flatMap((z, i) => [block(`platform-w-${i}`, -14, z, 4, 3, 1.25, 'crate'), block(`platform-e-${i}`, 14, -z, 3, 3, 1.5, 'crate')]),
]);

const drydock = arena({
  id: 'drydock', name: 'DRYDOCK 03', title: 'DRYDOCK', label: '드라이독', width: 96, depth: 72,
  tag: '대형 · 개방형', theme: 'harbor', image: 'drydock-hero.png',
  description: '96 × 72m의 넓은 항만 야드. 중앙 창고, 화물 적재장과 넓은 외곽 동선을 활용하세요.',
  sky: '#44616b', ground: '#929d9d', wall: '#506870', accent: '#ac6949', light: '#ffedce',
}, [
  block('warehouse', 0, 0, 14, 12, 5.2, 'building'),
  ...[-30, -15, 15, 30].flatMap((x, i) => [block(`cargo-n-${i}`, x, -18, 9, 4, 3.2, 'container', i % 2 ? 'slate' : 'orange'), block(`cargo-s-${i}`, -x, 18, 7, 4, 3.2, 'container', i % 2 ? 'orange' : 'slate')]),
  ...[-33, -20, 20, 33].flatMap((x, i) => [block(`cover-n-${i}`, x, -5, 3, 3, 1.6, 'crate'), block(`cover-s-${i}`, -x, 6, 3, 4, 1.5, 'crate')]),
  block('dock-west', -32, 0, 4, 9, 2.6, 'container'), block('dock-east', 32, 0, 4, 9, 2.6, 'container'),
]);

const blocknine = arena({
  id: 'blocknine', name: 'BLOCK NINE', title: 'BLOCK NINE', label: '블록 나인', width: 76, depth: 68,
  tag: '시가전 · 다중 동선', theme: 'city', image: 'blocknine-hero.png',
  description: '건물과 골목이 엇갈리는 폐쇄 구역. 중앙 교차로의 장거리 교전과 좁은 골목의 근접전이 공존합니다.',
  sky: '#252a42', ground: '#78818c', wall: '#47465c', accent: '#775e99', light: '#ded9ff',
}, [
  ...[-20, 20].flatMap((x, i) => [-17, 17].map((z, j) => block(`building-${i}-${j}`, x, z, 10, 11, 6.5, 'building'))),
  block('center-west', -10, 0, 7, 8, 4.2, 'building'), block('center-east', 11, 0, 8, 8, 4.2, 'building'),
  block('crossing-north', 0, -20, 3, 5, 1.4, 'crate', 'orange'), block('crossing-south', 0, 20, 3, 5, 1.4, 'crate', 'orange'),
  ...[-29, 29].flatMap((x, i) => [block(`street-cover-n-${i}`, x, -4, 2, 3, 1.4, 'crate'), block(`street-cover-s-${i}`, x, 7, 2, 3, 1.4, 'crate')]),
]);

const whiteout = arena({
  id: 'whiteout', name: 'WHITEOUT 06', title: 'WHITEOUT', label: '화이트아웃', width: 88, depth: 64,
  tag: '설원 · 중장거리', theme: 'snow', image: 'whiteout-hero.png',
  description: '차가운 설원 연구기지. 흰색 방호벽과 연구동 사이의 넓은 사선에 주의하세요.',
  sky: '#9eb8c7', ground: '#e5eeeb', wall: '#899fa9', accent: '#4f839a', light: '#edf9ff',
}, [
  block('lab-west', -15, -12, 12, 7, 4.5, 'building'), block('lab-east', 15, 12, 12, 7, 4.5, 'building'),
  block('ice-core', 0, 0, 5, 5, 3.7, 'reactor'),
  ...[-28, -12, 12, 28].flatMap((x, i) => [block(`ice-cover-n-${i}`, x, -23, 5, 2, 1.5, 'crate'), block(`ice-cover-s-${i}`, -x, 23, 5, 2, 1.5, 'crate')]),
  block('supply-west', -29, 5, 4, 7, 2.6, 'container'), block('supply-east', 29, -5, 4, 7, 2.6, 'container'),
  block('snow-cover-ne', 13, -8, 3, 3, 1.4, 'crate'), block('snow-cover-sw', -13, 8, 3, 3, 1.4, 'crate'),
]);

const redline = arena({
  id: 'redline', name: 'REDLINE 19', title: 'REDLINE', label: '레드라인', width: 128, depth: 44,
  tag: '초장거리 · 가로형', theme: 'desert', image: 'redline-hero.png',
  description: '128m를 가로지르는 붉은 사막 수송로. 낮은 중앙 엄폐와 양쪽 우회 통로가 저격수의 위치를 흔듭니다.',
  sky: '#b59a80', ground: '#c6aa83', wall: '#9a7358', accent: '#a64b31', light: '#ffe6bd',
}, [
  ...[-42, -21, 21, 42].map((x, i) => block(`depot-${i}`, x, i % 2 ? -8 : 8, 10, 6, 3.5, 'building')),
  block('center-cover', 0, 0, 6, 5, 1.25, 'crate', 'orange'),
  ...[-47, -31, -14, 14, 31, 47].flatMap((x, i) => [block(`road-cover-n-${i}`, x, -15, 3, 2, 1.5, 'crate'), block(`road-cover-s-${i}`, -x, 15, 3, 2, 1.5, 'crate')]),
  block('cargo-west', -30, 0, 4, 3, 1.6, 'crate', 'orange'), block('cargo-east', 30, 0, 4, 3, 1.6, 'crate', 'orange'),
]);

function addTacticalFeatures(base) {
  const obstacles = [...base.obstacles], platforms = [], extraCover = [];
  const candidates = [];
  const distanceTo = (point, anchor) => (point.x - anchor.x) ** 2 + (point.z - anchor.z) ** 2;
  for (let z = Math.ceil(-base.depth / 2 + 7); z <= base.depth / 2 - 7; z += 2) {
    for (let x = Math.ceil(-base.width / 2 + 7); x <= base.width / 2 - 7; x += 2) candidates.push({ x, z });
  }
  function clear(x, z, w, d, padding) {
    if (Math.abs(x) + w / 2 > base.width / 2 - 4.5 || Math.abs(z) + d / 2 > base.depth / 2 - 4.5) return false;
    // Keep the cross-map approaches and the signature long sightlines open.
    if (Math.abs(x) < w / 2 + 2.2 || Math.abs(z) < d / 2 + 2.2) return false;
    if (base.spawns.some((s) => Math.abs(s.x - x) < w / 2 + 2 && Math.abs(s.z - z) < d / 2 + 2)) return false;
    return !obstacles.some((box) => Math.abs(box.x - x) < (box.w + w) / 2 + padding && Math.abs(box.z - z) < (box.d + d) / 2 + padding);
  }
  for (const [index, [sx, sz]] of [[-1, -1], [1, 1], [-1, 1], [1, -1]].entries()) {
    const anchor = { x: Math.round(sx * base.width * 0.29), z: Math.round(sz * base.depth * 0.34) };
    const spot = [...candidates].sort((a, b) => distanceTo(a, anchor) - distanceTo(b, anchor)).find((p) => clear(p.x, p.z, 3.8, 5, 2));
    if (!spot) continue;
    const id = `platform-${index}`;
    for (let step = 0; step < 3; step++) obstacles.push(block(`${id}-step-${step}`, spot.x, spot.z - 2 + step, 3.2, 1, (step + 1) * 0.45, 'step'));
    obstacles.push(block(`${id}-deck`, spot.x, spot.z + 1.5, 3.8, 2, 1.8, 'platform', 'orange'));
    platforms.push({ id, x: spot.x, z: spot.z, height: 1.8, approach: { x: spot.x, z: spot.z - 3.2 } });
  }
  const coverAnchors = [[-0.28, -0.24], [0.28, 0.24], [0.24, -0.28], [-0.24, 0.28], [-0.36, 0.18], [0.36, -0.18], [-0.18, -0.36], [0.18, 0.36], [-0.34, -0.34], [0.34, 0.34], [-0.34, 0.34], [0.34, -0.34]];
  // Integer ranking, rather than transcendental math, keeps layouts identical across browser engines.
  for (let index = 0; index < coverAnchors.length; index++) {
    const low = index % 3 === 0, panel = index % 3 === 1;
    const w = low ? 3.6 : panel ? 0.8 : 2, d = low ? 0.8 : panel ? 3.4 : 2;
    const anchor = { x: Math.round(coverAnchors[index][0] * base.width), z: Math.round(coverAnchors[index][1] * base.depth) };
    const spot = [...candidates].sort((a, b) => distanceTo(a, anchor) - distanceTo(b, anchor)).find((p) => clear(p.x, p.z, w, d, 1.3));
    if (!spot) continue;
    const cover = block(`tactical-cover-${index}`, spot.x, spot.z, w, d, low ? 1.15 : panel ? 2.6 : 1.8, 'crate', low ? 'orange' : 'slate');
    obstacles.push(cover); extraCover.push(cover.id);
  }
  return Object.freeze({ ...base, obstacles, platforms, extraCover });
}

export const WORLD = addTacticalFeatures(FOUNDRY);
export const MAPS = Object.freeze([WORLD, ...[longrail, drydock, blocknine, whiteout, redline].map(addTacticalFeatures)]);
export const getMap = (id) => MAPS.find((map) => map.id === id) || WORLD;

export function bounds(box, padding = 0) {
  return {
    minX: box.x - box.w / 2 - padding, maxX: box.x + box.w / 2 + padding,
    minY: box.y || 0, maxY: (box.y || 0) + box.h,
    minZ: box.z - box.d / 2 - padding, maxZ: box.z + box.d / 2 + padding,
  };
}

export function rayBox(origin, direction, box, maxDistance = 100) {
  const b = 'minX' in box ? box : bounds(box);
  let near = 0;
  let far = maxDistance;
  for (const [axis, lo, hi] of [['x', 'minX', 'maxX'], ['y', 'minY', 'maxY'], ['z', 'minZ', 'maxZ']]) {
    if (Math.abs(direction[axis]) < 1e-9) {
      if (origin[axis] < b[lo] || origin[axis] > b[hi]) return null;
    } else {
      let a = (b[lo] - origin[axis]) / direction[axis];
      let c = (b[hi] - origin[axis]) / direction[axis];
      if (a > c) [a, c] = [c, a];
      near = Math.max(near, a);
      far = Math.min(far, c);
      if (near > far) return null;
    }
  }
  return near <= maxDistance ? near : null;
}

export function raySphere(origin, direction, center, radius) {
  const x = origin.x - center.x, y = origin.y - center.y, z = origin.z - center.z;
  const b = x * direction.x + y * direction.y + z * direction.z;
  const c = x * x + y * y + z * z - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const distance = -b - Math.sqrt(discriminant);
  return distance >= 0 ? distance : null;
}

export function aimDirection(yaw, pitch) {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}

export function wallDistance(origin, direction, maxDistance = 200, world = WORLD) {
  let nearest = maxDistance;
  for (const box of world.obstacles) {
    const hit = rayBox(origin, direction, box, nearest);
    if (hit !== null) nearest = hit;
  }
  return nearest;
}

export function hasLineOfSight(a, b, world = WORLD) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 0.001) return true;
  return wallDistance(a, { x: dx / distance, y: dy / distance, z: dz / distance }, distance, world) >= distance - 0.01;
}
