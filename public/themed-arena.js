import * as THREE from '/vendor/three.module.js';
import { drawBuildings } from './building-view.js';
import { drawConservatory } from './conservatory-view.js';
import { drawNightMarket } from './nightmarket-view.js';

// Static, batched scenery: no per-leaf objects, real-time reflections, animated
// foliage or extra shadow maps. Solid silhouettes use the shared colliders.
export function drawThemedArena(scene, world, material) {
  const garden = world.theme === 'greenhouse', group = new THREE.Group(); group.name = `themed-${world.id}`; scene.add(group);
  const geometries = new Map(), batches = new Map(), palette = new Map();
  const color = (key, value, options = {}) => palette.set(key, { value, options });
  color('wall', world.wall); color('stone', garden ? '#a4a58c' : '#9b9791'); color('wood', garden ? '#65513b' : '#77614c');
  color('trim', garden ? '#36534c' : '#353d4b'); color('metal', garden ? '#759286' : '#a5a9aa', { metalness: .4, roughness: .6 });
  color('soil', '#3d4230'); color('terracotta', '#ad7453'); color('leaf', '#52724b'); color('leaf-light', '#7e995d'); color('leaf-dark', '#315b48');
  color('red', '#b85247'); color('teal', '#408783'); color('cream', '#decda4'); color('crate', '#94784e'); color('food', '#bf592c');
  color('vault', '#527b6d', { metalness: .4 }); color('glass', '#b9d2be', { transparent: true, opacity: .12, depthWrite: false, side: THREE.DoubleSide, metalness: .1 });
  color('annex', garden ? '#879485' : '#756965'); color('closed-window', garden ? '#54786e' : '#3b5661');
  color('amber', '#ffbd72', { emissive: '#ff973c', emissiveIntensity: 1.5 }); color('cyan', '#90e4d7', { emissive: '#49c7be', emissiveIntensity: .9 });
  const add = (key, size, position, rotation = null, shape = 'box') => {
    const id = `${key}/${shape}`; if (!batches.has(id)) batches.set(id, { key, shape, items: [] });
    batches.get(id).items.push({ size, position, rotation });
  };
  const beam = (key, a, b, thickness = .15, shape = 'box') => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
    add(key, [thickness, direction.length(), thickness], start.add(end).multiplyScalar(.5).toArray(), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()), shape);
  };
  const foliage = (position, size, light = false) => add(light ? 'leaf-light' : 'leaf', size, position, null, 'leaf');
  const texture = (paint, width = 512, height = 512) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; paint(canvas.getContext('2d'), width, height);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; return map;
  };
  const sign = (text, subtitle, position, width, height, rotation = 0, tint = '#ffd59d') => {
    const map = texture((ctx, w, h) => {
      ctx.fillStyle = '#182831'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = tint; ctx.lineWidth = 8; ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = tint; ctx.font = 'bold 100px Arial, sans-serif';
      ctx.fillText(text, w / 2, subtitle ? h * .42 : h * .53, w - 65);
      if (subtitle) { ctx.fillStyle = '#c3cabc'; ctx.font = '25px Arial, sans-serif'; ctx.fillText(subtitle, w / 2, h * .79, w - 60); }
    }, 1024, 256);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map }));
    mesh.position.set(...position); mesh.rotation.y = rotation; mesh.name = garden ? 'botanical-sign' : 'korean-market-sign'; mesh.userData.text = text; group.add(mesh);
  };

  if (garden) color('bark', '#957653', { map: texture((ctx, w, h) => {
    ctx.fillStyle = '#aaa18a'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 75; i++) {
      const x = i * w / 75; ctx.strokeStyle = i % 3 ? '#393f2d66' : '#e4d4ad55'; ctx.lineWidth = 1 + i % 4;
      ctx.beginPath(); ctx.moveTo(x, 0); for (let y = 0; y <= h; y += 24) ctx.lineTo(x + Math.sin(i * 3 + y / 55) * 5, y); ctx.stroke();
    }
  }) });

  const groundMap = texture((ctx, w, h) => {
    ctx.fillStyle = garden ? '#c1c0ac' : '#a2a7ae'; ctx.fillRect(0, 0, w, h);
    let seed = 171; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 2200; i++) { ctx.fillStyle = garden ? `rgba(55,75,39,${random() * .2})` : `rgba(19,28,43,${random() * .15})`; ctx.fillRect(random() * w, random() * h, 2 + random() * 10, 2 + random() * 8); }
    ctx.strokeStyle = garden ? '#59675055' : '#28334144'; ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * w / 4, 0); ctx.lineTo(i * w / 4, h); ctx.moveTo(0, i * h / 4); ctx.lineTo(w, i * h / 4); ctx.stroke(); }
  });
  groundMap.wrapS = groundMap.wrapT = THREE.RepeatWrapping; groundMap.repeat.set(world.width / 8, world.depth / 8);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(world.width + 20, world.depth + 20), material('theme-ground', garden ? '#c5b48e' : world.ground, { map: groundMap, roughness: garden ? .96 : .7, metalness: garden ? 0 : .12 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; group.add(floor);

  const fernBed = (box) => {
    add('terracotta', [box.w, box.h, box.d], [box.x, box.y + box.h / 2, box.z]);
    add('soil', [box.w - .2, .04, box.d - .2], [box.x, box.y + box.h + .01, box.z]);
    for (const side of [-1, 1]) {
      add('stone', [box.w + .08, .12, .14], [box.x, box.y + box.h - .03, box.z + side * box.d / 2]);
      add('stone', [.14, .12, box.d], [box.x + side * box.w / 2, box.y + box.h - .03, box.z]);
    }
    for (let i = 0; i < 6; i++) {
      const x = box.x + ((i * 7) % 9 / 9 - .5) * (box.w - .9), z = box.z + ((i * 5) % 7 / 7 - .5) * (box.d - .9);
      for (let blade = 0; blade < 5; blade++) {
        const angle = blade * Math.PI * 2 / 5 + i, rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, -.18 - blade % 2 * .1));
        add(i % 3 ? 'leaf' : 'leaf-light', [.52, .045, .15], [x + Math.cos(angle) * .15, box.y + box.h + .13, z - Math.sin(angle) * .15], rotation, 'leaf');
      }
    }
  };
  const crate = (box) => {
    add('crate', [box.w, box.h, box.d], [box.x, box.y + box.h / 2, box.z]);
    for (let level = .2; level < box.h; level += .38) for (const side of [-1, 1]) {
      add('wood', [box.w + .015, .055, .025], [box.x, box.y + level, box.z + side * box.d / 2]);
      add('wood', [.025, .055, box.d], [box.x + side * box.w / 2, box.y + level, box.z]);
    }
  };

  for (const box of world.obstacles) {
    if (box.buildingId) continue;
    const { x, y, z, w, h, d, kind } = box, position = [x, y + h / 2, z];
    if (kind === 'closed-annex') {
      add('annex', [w, h, d], position); add('trim', [w, .2, d], [x, y + h - .07, z]);
      for (const side of [-1, 1]) {
        for (let along = -w / 2 + 1.2; along < w / 2 - .8; along += 3) for (let level = 3; level < h - 1; level += 3) add('closed-window', [Math.min(1.5, w * .6), 1.5, .03], [x + along, y + level, z + side * (d / 2 + .02)]);
        for (let along = -d / 2 + 1.2; along < d / 2 - .8; along += 3) for (let level = 3; level < h - 1; level += 3) add('closed-window', [.03, 1.5, Math.min(1.5, d * .6)], [x + side * (w / 2 + .02), y + level, z + along]);
      }
    } else if (kind === 'planter' || garden && kind === 'crate' && h < 1.9 && w > 1) fernBed(box);
    else if (kind === 'tree') {
      add('bark', [w, h, d], position);
      for (let i = 0; i < 8; i++) add('trim', [.09, h - .4, .045], [x - w / 2 + (i + .5) * w / 8, y + h / 2, z + d / 2 + .025]);
    } else if (kind === 'root' || kind === 'tree-bark') {
      add('bark', [w, h, d], position); if (kind === 'root') add('leaf-dark', [w * .85, .035, d * .8], [x, y + h + .015, z]);
    } else if (kind === 'garden-shed') {
      add('trim', [w, h, d], position); add('metal', [w + .12, .14, d + .12], [x, y + h - .05, z]);
      for (let i = 0; i < 4; i++) add('wood', [w * .9, .13, .06], [x, y + .35 + i * (h - .5) / 4, z + d / 2 + .025]);
      sign('육묘실 / NURSERY', 'BOTANICAL MAINTENANCE', [x, y + h * .64, z + d / 2 + .07], Math.min(w - .3, 2.8), .45, 0, '#b5d0a1');
    } else if (kind === 'market-stall') {
      add('wood', [w, h, d], position); add('metal', [w + .06, .07, d + .06], [x, y + h - .015, z]);
      const menu = ['떡볶이', '김밥', '어묵', '만두', '호떡'][Number(box.id.split('-').at(-1)) % 5];
      const front = box.front || (x < 0 ? 1 : -1), facing = front * Math.PI / 2, frontX = x + front * (w / 2 + .045);
      sign(menu, '밤빛시장 · 정성 가득', [frontX, .67, z], 2.6, .55, facing, box.color === 'orange' ? '#ffc699' : '#a0e2d6');
      for (let i = 0; i < 3; i++) {
        const trayX = x + front * .75, trayZ = z - 1.2 + i * 1.15;
        add('metal', [.5, .035, .7], [trayX, h + .055, trayZ]);
        for (let piece = 0; piece < 5; piece++) add(i % 2 ? 'cream' : 'food', [.09, .06, .15], [trayX - .12 + piece % 2 * .22, h + .105, trayZ - .22 + Math.floor(piece / 2) * .2]);
      }
    } else if (kind === 'market-awning') {
      const key = box.color === 'orange' ? 'red' : 'teal'; add(key, [w, h, d], position);
      for (let i = 0; i < 6; i++) {
        const stripeZ = z - d / 2 + (i + .5) * d / 6;
        add('cream', [w, .018, d / 12], [x, y + h + .006, stripeZ]);
      }
      add(key, [.06, .22, d], [x + (box.front || (x < 0 ? 1 : -1)) * w / 2, y - .06, z]);
    } else if (kind === 'market-tree') {
      add('wood', [w, h, d], position);
    } else if (kind === 'market-bench') {
      add('wood', [w, h, d], position); add('crate', [w + .05, .07, d + .05], [x, y + h - .02, z]);
    } else if (kind === 'market-kiosk') {
      add('teal', [w, h, d], position); add('trim', [w + .15, .16, d + .15], [x, y + h, z]);
      add('cream', [w * .76, h * .4, .035], [x, y + h * .55, z + d / 2 + .02]);
      sign('밤빛상회', '식료품 · 생활용품', [x, y + h * .84, z + d / 2 + .045], Math.min(3.8, w - .25), .44, 0, '#a0e2d6');
    } else if (kind === 'market-crates' || !garden && kind === 'crate') crate(box);
    else {
      const key = kind === 'wall' ? 'wall' : kind === 'market-back' ? 'wood' : kind === 'equipment' ? 'metal' : kind.includes('rail') || kind.includes('column') || kind === 'market-post' ? 'trim' : kind === 'platform' || kind.includes('deck') ? 'wood' : kind === 'step' || kind.includes('step') ? 'stone' : 'trim';
      add(key, [w, h, d], position);
      if (kind === 'wall') add('trim', [w + .05, .18, d + .05], [x, y + h - .06, z]);
      if (kind.includes('step') || kind === 'platform') add('cream', [Math.max(.1, w - .12), .02, .065], [x, y + h + .005, z - d / 2 + .04]);
    }
  }
  drawBuildings(scene, world, material);

  const halfW = world.width / 2, halfD = world.depth / 2; let lamps = [];
  if (garden) {
    drawConservatory({ group, world, add, beam, foliage, sign, color, texture });
  } else {
    lamps = drawNightMarket({ scene, group, world, add, beam, sign, color });
  }

  for (const { key, shape, items } of batches.values()) {
    const { value, options } = palette.get(key), surface = material(`theme-${key}`, value, { roughness: .9, metalness: .05, ...options });
    if (!geometries.has(shape)) {
      const geometry = shape === 'leaf' ? new THREE.SphereGeometry(1, 6, 4) : shape === 'tube' ? new THREE.CylinderGeometry(.5, .5, 1, 7) : shape === 'plane' ? new THREE.PlaneGeometry(1, 1) : shape === 'disc' ? new THREE.CircleGeometry(.5, 32) : shape === 'ring' ? new THREE.RingGeometry(.46, .5, 40) : shape === 'shard' ? new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-.5, 0, 0, .5, 0, 0, -.15, .8, 0], 3)) : new THREE.BoxGeometry(1, 1, 1);
      if (shape === 'shard') { geometry.computeVertexNormals(); geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, .35, 1], 2)); }
      geometries.set(shape, geometry);
    }
    const mesh = new THREE.InstancedMesh(geometries.get(shape), surface, items.length), matrix = new THREE.Matrix4();
    items.forEach(({ size, position, rotation }, index) => { matrix.compose(new THREE.Vector3(...position), rotation || new THREE.Quaternion(), new THREE.Vector3(...size)); mesh.setMatrixAt(index, matrix); });
    mesh.name = `themed-${key}-${shape}`; mesh.castShadow = !['glass', 'amber', 'cyan'].includes(key); mesh.receiveShadow = key !== 'glass'; group.add(mesh);
  }
  group.userData.colliderIds = world.obstacles.filter((box) => !box.buildingId).map((box) => box.id);
  const dustGeometry = new THREE.BufferGeometry(), positions = [];
  for (let i = 0; i < 48; i++) positions.push(Math.sin(i * 7.6) * halfW, 2 + i % 10, Math.cos(i * 3.2) * halfD);
  dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: garden ? '#d8e2bc' : '#ead4b6', size: .025, transparent: true, opacity: .25, depthWrite: false })); scene.add(dust);
  return { lamps, dust };
}
