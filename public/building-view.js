import * as THREE from '/vendor/three.module.js';

export function drawBuildings(scene, world, material) {
  const batches = new Map(), geometry = new THREE.BoxGeometry(1, 1, 1), matrix = new THREE.Matrix4();
  const add = (key, size, position) => { if (!batches.has(key)) batches.set(key, []); batches.get(key).push({ size, position }); };
  for (const box of world.obstacles) if (box.buildingId) {
    const key = box.kind === 'building-step' ? 'stairs' : box.kind === 'building-floor' ? 'floor' : box.kind === 'building-rail' ? 'trim' : 'wall';
    add(key, [box.w, box.h, box.d], [box.x, box.y + box.h / 2, box.z]);
    if (key === 'stairs') add('marking', [box.w * 0.85, 0.025, 0.055], [box.x, box.y + box.h + 0.005, box.z - box.d / 2 + 0.03]);
  }
  for (const building of world.buildings || []) for (const window of building.windows) {
    const { x, y, z, width, height, axis } = window;
    for (const side of [-1, 1]) {
      add('trim', axis === 'x' ? [0.055, height, 0.29] : [0.29, height, 0.055], [axis === 'x' ? x + side * width / 2 : x, y, axis === 'x' ? z : z + side * width / 2]);
      add('trim', axis === 'x' ? [width, 0.06, 0.29] : [0.29, 0.06, width], [x, y + side * height / 2, z]);
    }
  }
  const colors = { wall: world.wall, floor: world.theme === 'greenhouse' ? '#a0a28a' : world.theme === 'market' ? '#9b9388' : '#78868a', stairs: world.theme === 'greenhouse' ? '#7f9178' : '#69777c', trim: world.theme === 'greenhouse' ? '#36534c' : '#293c46', marking: '#e7a765' };
  let masonry;
  if (world.theme === 'market') {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#c7b8ad'; ctx.fillRect(0, 0, 256, 256); ctx.strokeStyle = '#726b6366'; ctx.lineWidth = 2;
    for (let row = 0; row < 8; row++) {
      ctx.beginPath(); ctx.moveTo(0, row * 32); ctx.lineTo(256, row * 32); ctx.stroke();
      for (let x = row % 2 ? -32 : 0; x < 256; x += 64) { ctx.beginPath(); ctx.moveTo(x, row * 32); ctx.lineTo(x, (row + 1) * 32); ctx.stroke(); }
    }
    masonry = new THREE.CanvasTexture(canvas); masonry.colorSpace = THREE.SRGBColorSpace;
  }
  for (const [key, boxes] of batches) {
    const mesh = new THREE.InstancedMesh(geometry, material(`building-${key}`, colors[key], { roughness: 0.92, ...(key === 'wall' && masonry ? { map: masonry } : {}) }), boxes.length);
    boxes.forEach((box, i) => { matrix.compose(new THREE.Vector3(...box.position), new THREE.Quaternion(), new THREE.Vector3(...box.size)); mesh.setMatrixAt(i, matrix); });
    mesh.castShadow = mesh.receiveShadow = true; mesh.name = `architecture-${key}`; scene.add(mesh);
  }
}
