import * as THREE from '/vendor/three.module.js';

function rampGeometry(box, inset = 0) {
  const geometry = new THREE.BoxGeometry(box.w, box.h, box.d), p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const t = box.slope.axis === 'x' ? (p.getX(i) + box.w / 2) / box.w : (p.getZ(i) + box.d / 2) / box.d;
    p.setY(i, p.getY(i) > 0 ? box.slope.low + (box.slope.high - box.slope.low) * t : 0);
    if (inset) {
      if (box.slope.axis === 'z') p.setX(i, p.getX(i) - Math.sign(p.getX(i)) * inset);
      else p.setZ(i, p.getZ(i) - Math.sign(p.getZ(i)) * inset);
    }
  }
  // A ramp is mounted on the ground plane; its underside has no visible face.
  const normals = geometry.getAttribute('normal'), index = geometry.getIndex().array;
  geometry.setIndex(Array.from(index).filter(i => normals.getY(i) !== -1)); geometry.clearGroups();
  geometry.computeVertexNormals(); return geometry;
}
function clipPolygon(polygon, axis, sign, cut) {
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], da = sign * a[axis] - cut, db = sign * b[axis] - cut;
    if (da >= 0) result.push(a);
    if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }); }
  }
  return result;
}
function ringGeometry(box) {
  const positions = [], uv = [], triangles = [], radius = box.w / 2, inner = box.innerRadius, cut = box.cutHalf || 0;
  const vertex = (p, y) => { const index = positions.length / 3; positions.push(p.x, y, p.z); uv.push(p.x / 4, p.z / 4); return index; };
  for (let i = 0; i < 128; i++) {
    const a = i * Math.PI / 64, b = (i + 1) * Math.PI / 64, source = [{ x: Math.cos(a) * radius, z: Math.sin(a) * radius }, { x: Math.cos(b) * radius, z: Math.sin(b) * radius }, { x: Math.cos(b) * inner, z: Math.sin(b) * inner }, { x: Math.cos(a) * inner, z: Math.sin(a) * inner }];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const polygon = clipPolygon(clipPolygon(source, 'x', sx, cut), 'z', sz, cut); if (polygon.length < 3) continue;
      const bottom = polygon.map((p) => vertex(p, 0)), top = polygon.map((p) => vertex(p, box.h));
      for (let j = 1; j < polygon.length - 1; j++) triangles.push(bottom[0], bottom[j], bottom[j + 1], top[0], top[j + 1], top[j]);
      for (let j = 0; j < polygon.length; j++) { const next = (j + 1) % polygon.length; triangles.push(bottom[j], top[j], top[next], bottom[j], top[next], bottom[next]); }
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(triangles); geometry.computeVertexNormals(); return geometry;
}

export function drawTeamArena(scene, world, material) {
  const root = new THREE.Group(); root.name = `team-arena-${world.id}`; scene.add(root);
  const map = new THREE.TextureLoader().load('/assets/terrain-concrete.png'); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(world.width / 5, world.depth / 5); map.anisotropy = 8;
  const stone = world.theme === 'quarry' ? new THREE.TextureLoader().load('/assets/quarry-strata.png') : map;
  if (stone !== map) { stone.colorSpace = THREE.SRGBColorSpace; stone.wrapS = stone.wrapT = THREE.RepeatWrapping; stone.repeat.set(2, 2); stone.anisotropy = 2; }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(world.width + 8, world.depth + 8), material('team-ground', world.ground, { map, roughness: .98, metalness: .01 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; root.add(floor);
  const colors = { rock: world.theme === 'quarry' ? '#8f826b' : '#6c7779', wall: world.wall, machine: '#596d74', pipe: '#528b88', support: '#364e56', 'terrain-deck': world.theme === 'quarry' ? '#8a806b' : '#698b89', 'tunnel-roof': '#4d6669', ramp: world.theme === 'quarry' ? '#9a886c' : '#789994', core: '#76cdbc', antenna: '#a9c4bd' };
  const geometries = new Map([['box', new THREE.BoxGeometry(1, 1, 1)], ['cylinder', new THREE.CylinderGeometry(.5, .5, 1, 48)]]), batches = new Map();
  for (const solid of world.obstacles) {
    const box = solid.id === 'west' || solid.id === 'east' ? { ...solid, d: world.depth } : solid;
    const kind = Object.hasOwn(colors, box.kind) ? box.kind : 'machine', surface = material(`team-${kind}`, colors[kind], { roughness: kind === 'rock' ? .98 : .72, metalness: kind === 'rock' ? .03 : .28, ...(['rock', 'wall', 'terrain-deck', 'ramp', 'tunnel-roof'].includes(kind) ? { map: kind === 'rock' ? stone : map } : {}), ...(kind === 'core' ? { emissive: '#53bfa9', emissiveIntensity: .4 } : {}) });
    if (box.slope || box.shape === 'ring') {
      // Keep the walking slope, but avoid the coincident sides on the Sump deck joins.
      const inset = world.id === 'sump' && box.id.endsWith('-outer-ramp') ? .008 : 0;
      const mesh = new THREE.Mesh(box.slope ? rampGeometry(box, inset) : ringGeometry(box), surface); mesh.position.set(box.x, box.y, box.z); mesh.castShadow = mesh.receiveShadow = true; mesh.name = box.id; root.add(mesh); continue;
    }
    const shape = box.shape === 'cylinder' ? 'cylinder' : 'box', key = `${kind}/${shape}`;
    if (!batches.has(key)) batches.set(key, { shape, surface, boxes: [] }); batches.get(key).boxes.push(box);
  }
  for (const [key, { shape, surface, boxes }] of batches) {
    const mesh = new THREE.InstancedMesh(geometries.get(shape), surface, boxes.length), matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
    boxes.forEach((box, i) => { matrix.compose(new THREE.Vector3(box.x, box.y + box.h / 2, box.z), rotation, new THREE.Vector3(box.w, box.h, box.d)); mesh.setMatrixAt(i, matrix); });
    mesh.name = `team-batch-${key}`; mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
  }
  // Team entry markings are visual only; no invisible spawn-only barriers.
  const ring = new THREE.RingGeometry(.65, .85, 32);
  for (const point of world.spawns) { const marker = new THREE.Mesh(ring, material(`entry-${point.teamId}`, point.teamId === 'blue' ? '#79baff' : '#ff817a', { emissive: point.teamId === 'blue' ? '#38658b' : '#8a403a', emissiveIntensity: .4 })); marker.rotation.x = -Math.PI / 2; marker.position.set(point.x, point.y + .01, point.z); root.add(marker); }
  const signCanvas = document.createElement('canvas'); signCanvas.width = 1024; signCanvas.height = 256; const sign = signCanvas.getContext('2d'); sign.fillStyle = '#14242c'; sign.fillRect(0, 0, 1024, 256); sign.fillStyle = world.accent; sign.font = 'bold 100px sans-serif'; sign.textAlign = 'center'; sign.fillText(world.title, 512, 140); sign.fillStyle = '#cae3df'; sign.font = '24px sans-serif'; sign.fillText(world.label, 512, 205);
  const signMap = new THREE.CanvasTexture(signCanvas); signMap.colorSpace = THREE.SRGBColorSpace; signMap.anisotropy = 8;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshBasicMaterial({ map: signMap })); board.position.set(0, 5, -world.depth / 2 + .1); root.add(board);
  const dustGeometry = new THREE.BufferGeometry(); dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(Array.from({ length: 72 }, (_, i) => Math.sin(i * 11) * (i % 3 === 1 ? world.depth : world.width) * .35), 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: '#bad5ca', size: .025, transparent: true, opacity: .18, depthWrite: false })); scene.add(dust);
  return { lamps: [], dust };
}
