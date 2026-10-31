import * as THREE from '/vendor/three.module.js';

// The greenhouse has been reclaimed by a single old banyan. All new roots and
// leaves are either against an existing solid surface or above reachable play;
// the shared cover, bridge, stairs and spawn routes stay readable. Every stem,
// leaf and roof fragment is still instanced.
export function drawConservatory({ group, world, add, beam, foliage, sign, color, texture }) {
  const halfW = world.width / 2, halfD = world.depth / 2;
  color('vine', '#334e36'); color('fern', '#397961'); color('orchid', '#c575ac'); color('pollen', '#e6bf71'); color('rust', '#a87043');
  const mossMap = texture((ctx, w, h) => {
    let seed = 403; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 900; i++) {
      const x = random() * w, y = random() * h, edge = Math.max(0, 1 - Math.hypot(x - w / 2, y - h / 2) / (w * .49));
      ctx.fillStyle = `rgba(${55 + i % 30},${80 + i % 40},${36 + i % 22},${edge * .42})`;
      ctx.beginPath(); ctx.ellipse(x, y, 4 + random() * 20, 3 + random() * 12, random() * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
  });
  color('moss', '#8eae69', { map: mossMap, transparent: true, depthWrite: false, roughness: 1, metalness: 0 });
  const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  for (let i = 0; i < 26; i++) {
    const angle = i * 2.39996, radius = 6 + i % 6 * 3.5;
    add('moss', [5 + i % 4 * 1.4, 4 + i % 3 * 1.2, 1], [Math.cos(angle) * radius, .02, -7 + Math.sin(angle) * radius * .75], flat, 'plane');
  }

  // A twisted trunk breaks through the central roof opening instead of ending
  // in a small, flat row of foliage. Its lowest new branch is above bridge-jump
  // headroom, and far from the accessible laboratory roofs.
  const trunk = [[0, 8.8, -9], [.8, 12, -8.5], [-.6, 15.7, -9.4], [.5, 19.5, -8.5], [1.4, 22, -9]];
  for (let i = 1; i < trunk.length; i++) beam('bark', trunk[i - 1], trunk[i], 3.5 - i * .5, 'tube');
  for (let bough = 0; bough < 9; bough++) {
    const angle = bough * Math.PI * 2 / 9, radius = 8 + bough % 3 * 2;
    const start = [0, 11.5 + bough % 3 * 2, -9], middle = [Math.cos(angle) * radius * .55, 16.3 + bough % 3, -9 + Math.sin(angle) * radius * .5];
    const end = [Math.cos(angle) * radius, 18 + bough % 4 * 1.2, -9 + Math.sin(angle) * radius * .8];
    beam('bark', start, middle, 1.05, 'tube'); beam('bark', middle, end, .65, 'tube');
    foliage([end[0], end[1] + 1, end[2]], [3.9, 1.7, 3.1], bough % 3 === 0);
    for (let leaf = 0; leaf < 8; leaf++) {
      const azimuth = angle + (leaf - 3.5) * .38;
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(.15, azimuth, -.3 + leaf % 3 * .18));
      add(leaf % 2 ? 'fern' : 'leaf-light', [2.2, .12, .65], [end[0] + Math.cos(azimuth) * 1.3, end[1] + .7 + leaf % 3 * .22, end[2] - Math.sin(azimuth) * 1.3], rotation, 'leaf');
    }
  }
  foliage([1.5, 23, -9], [5.3, 2.3, 4.6], true);

  const vine = (x, top, z, length, seed) => {
    let previous = [x, top, z];
    for (let step = 1; step <= Math.ceil(length / .65); step++) {
      const drop = Math.min(length, step * .65), point = [x + Math.sin(seed + drop) * .22, top - drop, z + Math.cos(seed * 2 + drop) * .17];
      beam('vine', previous, point, .045, 'tube');
      for (const side of [-1, 1]) add(step % 3 ? 'fern' : 'leaf-light', [.34, .08, .16], [point[0] + side * .19, point[1] + .08, point[2]], new THREE.Quaternion().setFromEuler(new THREE.Euler(0, seed + step * .8, side * .32)), 'leaf');
      previous = point;
    }
  };
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1, z = -25 + Math.floor(i / 2) * 7;
    vine(side * (18 + i % 3), 19.2, z, 4.6 + i % 3, i * .7);
  }
  for (let i = 0; i < 7; i++) vine(-6 + i * 2, 15 + i % 2, -12 + i % 3 * 2, 4 + i % 3 * .6, i + 5);

  // Roof ribs, individual glazing bars and missing/jagged panes make the broken
  // glasshouse readable from player height. The crown grows through the gap.
  let brokenPanes = 0;
  for (const [pavilion, room] of world.footprint.entries()) {
    const half = room.w / 2, startZ = room.z - room.d / 2, bay = room.d / 8, peak = pavilion ? 19 : 23;
    for (let rib = 0; rib <= 8; rib++) {
      const z = startZ + rib * bay;
      const arch = [[room.x - half, 14, z], [room.x - half * .55, peak - 2.5, z], [room.x, peak, z], [room.x + half * .55, peak - 2.5, z], [room.x + half, 14, z]];
      for (let i = 1; i < arch.length; i++) { if (!pavilion && rib === 3 && (i === 2 || i === 3)) continue; beam('vault', arch[i - 1], arch[i], .22); }
      for (const side of [-1, 1]) add('rust', [.35, .65, .28], [room.x + side * half, 13.5, z]);
    }
    for (const side of [-1, 1]) {
      for (const [x, height] of [[half, 14], [half * .55, peak - 2.5]]) beam('vault', [room.x + side * x, height, startZ], [room.x + side * x, height, startZ + room.d], .15);
      for (let pane = 0; pane < 8; pane++) {
        const z = startZ + (pane + .5) * bay, broken = !pavilion && Math.abs(z + 9) < 10 || (pane + pavilion + side + 8) % 7 === 0;
        const spans = [[[room.x + side * half, 14], [room.x + side * half * .55, peak - 2.5]], [[room.x + side * half * .55, peak - 2.5], [room.x, peak]]];
        for (const [index, [a, b]] of spans.entries()) {
          const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy), rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.atan2(dy, dx)));
          const position = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z];
          if (broken && index === 1) {
            brokenPanes++; add('glass', [length * .6, bay * .8, 1], position, rotation.clone().multiply(flat), 'shard');
          } else add('glass', [length, .035, bay - .18], position, rotation);
          for (let bar = 0; bar < 4; bar++) { const lineZ = z - bay / 2 + bar * bay / 4; if (!broken || index === 0) beam('vault', [a[0], a[1], lineZ], [b[0], b[1], lineZ], .055); }
        }
      }
    }
  }
  for (const side of [-1, 1]) {
    sign('OVERGROWTH', 'BOTANICAL CONSERVATORY / 폐쇄된 식물원', [0, 6, side * (halfD - .1)], 10, 1.8, side < 0 ? 0 : Math.PI, '#d2deac');
    for (let i = 0; i < 9; i++) {
      const x = -halfW + i * 9, z = side * (halfD + 8 + i % 3);
      beam('bark', [x, 0, z], [x, 8 + i % 4, z], 1.2, 'tube'); foliage([x, 10 + i % 4, z], [5, 5, 4], i % 2 === 0);
    }
  }

  // Botanical wings, weathered identifying signs and creepers at solid corners
  // replace the anonymous military-block appearance without hiding openings.
  for (const [index, building] of world.buildings.entries()) {
    const label = building.id.startsWith('botanical-lab') ? index % 2 ? 'ORCHID HOUSE' : 'SEED VAULT' : index % 2 ? 'FERN VALLEY' : 'BOTANICAL ARCHIVE';
    sign(label, index % 2 ? '식물 보존동 / 출입 통제' : '종자 보관실 / CONSERVATION', [building.x, 2.7, building.z + building.d / 2 + .04], Math.min(building.w - .8, 6.5), .5, 0, index % 2 ? '#e1b8cb' : '#d2dca1');
    for (const side of [-1, 1]) {
      const x = building.x + side * (building.w / 2 + .035), z = building.z + building.d / 2 - .4;
      for (let y = .5; y < building.height - .4; y += .55) {
        const next = Math.min(building.height - .3, y + .55);
        beam('vine', [x, y, z], [x, next, z + Math.sin(y) * .08], .035, 'tube');
        add(y % 2 > 1 ? 'fern' : 'leaf', [.04, .15, .32], [x + side * .025, y + .15, z], null, 'leaf');
      }
    }
  }
  for (const box of world.obstacles.filter((box) => box.kind === 'planter' && box.x > 0 && box.z > 5)) {
    for (let flower = 0; flower < 12; flower++) {
      const x = box.x + ((flower * 7) % 11 / 11 - .5) * (box.w - .7), z = box.z + ((flower * 3) % 7 / 7 - .5) * (box.d - .7), y = box.y + box.h + .16;
      add('pollen', [.045, .04, .045], [x, y + .025, z], null, 'leaf');
      for (let petal = 0; petal < 5; petal++) {
        const angle = petal * Math.PI * 2 / 5;
        add('orchid', [.13, .035, .065], [x + Math.cos(angle) * .08, y, z + Math.sin(angle) * .08], new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -angle, 0)), 'leaf');
      }
    }
  }
  for (const side of [-1, 1]) {
    sign(side < 0 ? 'FERN VALLEY' : 'ORCHID HOUSE', side < 0 ? '양치식물원 / A' : '난초 보존원 / B', [side * 9, .75, 14.55], 3.8, .6, 0, side < 0 ? '#b9d7a2' : '#e6b7ce');
    for (let x = -9; x <= 9; x += 3) {
      add('terracotta', [.35, .3, .3], [x, 3.65, side * 1.7]);
      for (let leaf = 0; leaf < 4; leaf++) add('fern', [.4, .06, .12], [x + Math.sin(leaf * 2) * .15, 3.88, side * 1.75], new THREE.Quaternion().setFromEuler(new THREE.Euler(0, leaf * 1.6, -.2)), 'leaf');
    }
  }
  sign('THE FIRST TREE', '보존수 001 / 뿌리 보호 구역', [0, 2.4, -6.72], 2.6, .7, 0, '#dfce9a');
  sign('CANOPY WALK', '관리교 / 아래 통로 연결', [0, 3.44, 1.64], 3.8, .5, 0, '#d5dfb8');
  group.userData.conservatory = { pavilions: world.footprint.length, brokenPanes, hangingVines: 23, zones: ['SEED VAULT', 'FERN VALLEY', 'ORCHID HOUSE'], reclaimedTree: true };
}
