import * as THREE from '/vendor/three.module.js';

const facadeColors = {
  watch: ['#536877', '#608b9d'], service: ['#73746f', '#a79773'], depot: ['#777669', '#bb8b5f'],
  hall: ['#aaa093', '#b37e59'], arcade: ['#805e61', '#b58a73'], lab: ['#a2b6b7', '#70a8aa'],
  research: ['#9babb1', '#6599a6'], utility: ['#82959d', '#789ab3'],
};
const bridgeColors = { steel: '#566e83', lab: '#83aab7', covered: '#946854' };
const WALL = .24;

function visibleBox(box, owner, bridge) {
  if (bridge) return { ...box, w: bridge.w, d: bridge.d };
  if (!owner) return box;
  if (box.id.includes('-partition-') && owner.plates.some(plate =>
    Math.abs(plate.x - box.x) + box.w / 2 < plate.w / 2 && Math.abs(plate.z - box.z) + box.d / 2 < plate.d / 2)) {
    return { ...box, h: box.h - .22 };
  }
  const left = owner.x - owner.w / 2, right = owner.x + owner.w / 2;
  const north = owner.z - owner.d / 2, south = owner.z + owner.d / 2;
  let x0 = box.x - box.w / 2, x1 = box.x + box.w / 2, z0 = box.z - box.d / 2, z1 = box.z + box.d / 2;
  if (box.kind === 'building-floor' && box.id.includes('-plate-')) {
    // The enclosing wall owns the perimeter strips, including at roof height.
    x0 = Math.max(x0, left + WALL); x1 = Math.min(x1, right - WALL);
    z0 = Math.max(z0, north + WALL); z1 = Math.min(z1, south - WALL);
  } else if (['building-wall', 'building-rail'].includes(box.kind) && Math.abs(box.w - WALL) < 1e-5) {
    // Butt side walls against the front/back walls; don't draw both corner skins.
    if (Math.abs(z0 - north) < 1e-5) z0 += WALL;
    if (Math.abs(z1 - south) < 1e-5) z1 -= WALL;
  } else return box;
  return { ...box, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
}

export function drawBuildings(scene, world, material) {
  const batches = new Map(), geometry = new THREE.BoxGeometry(1, 1, 1), matrix = new THREE.Matrix4();
  const colors = { wall: world.wall, floor: world.theme === 'greenhouse' ? '#a0a28a' : world.theme === 'market' ? '#9b9388' : '#78868a', stairs: '#66777c', trim: '#293c46', marking: '#e2ab70', bridge: '#617985' };
  const owners = new Map((world.buildings || []).map(building => [building.id, building]));
  const bridgeDecks = new Map((world.roofBridges || []).map(link => [`${link.id}-deck`, link]));
  const trimFor = new Map((world.buildings || []).map(building => {
    const [wall, accent] = facadeColors[building.style] || facadeColors.service;
    return [building.id, [new THREE.Color(world.wall).lerp(new THREE.Color(wall), .63), new THREE.Color(accent)]];
  }));
  const add = (key, size, position, tint) => {
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push({ size, position, tint });
  };
  for (const solid of world.obstacles) if (solid.buildingId) {
    const box = visibleBox(solid, owners.get(solid.buildingId), bridgeDecks.get(solid.id));
    if (box.w <= 1e-5 || box.d <= 1e-5) continue;
    const key = box.kind === 'building-step' ? 'stairs' : box.kind === 'building-floor' ? 'floor' : box.kind === 'building-rail' ? 'trim' : box.kind === 'building-bridge' ? 'bridge' : 'wall';
    const [wall, accent] = trimFor.get(box.buildingId) || [], bridge = bridgeColors[box.bridgeStyle];
    const cap = key === 'trim' && (box.w > 1 || box.d > 1) ? .055 : 0;
    add(key, [box.w, box.h - cap, box.d], [box.x, box.y + (box.h - cap) / 2, box.z], key === 'wall' ? wall : bridge);
    if (key === 'stairs') {
      const alongX = box.stairAxis === 'x', side = box.stairDirection || 1;
      add('marking', alongX ? [.065, .016, box.d * .83] : [box.w * .83, .016, .065],
        [box.x - (alongX ? side * (box.w / 2 - .06) : 0), box.y + box.h + .004, box.z - (!alongX ? side * (box.d / 2 - .06) : 0)]);
    }
    if (key === 'floor' && box.id.includes('-plate-') && box.w > 2.2 && box.d > 3.3) {
      // Thin task-light strips on the underside, with no extra dynamic lights.
      add('marking', [.085, .016, Math.min(3.2, box.d * .53)], [box.x, box.y - .01, box.z], '#afcdd5');
    }
    if (cap) add('trim', [box.w, cap, box.d], [box.x, box.y + box.h - cap / 2, box.z], accent || bridge);
  }
  for (const building of world.buildings || []) {
    const [, accent] = trimFor.get(building.id);
    for (const opening of [...building.windows, ...building.doors]) {
      const { x, y, z, width, height, axis, side } = opening, door = !!opening.inside, acrossX = axis === 'x';
      const thickness = door ? .103 : .07, depth = .034, inset = .008, reveal = .007;
      // Use face-mounted trim on either side of the .24m wall instead of a
      // sleeve through it. The masonry alone draws the inside of the opening.
      for (const offset of [depth / 2 - inset, -WALL - depth / 2 + inset]) {
        const cx = x + (acrossX ? 0 : side * offset), cz = z + (acrossX ? side * offset : 0);
        for (const end of [-1, 1]) {
          const edge = end * (width / 2 + thickness / 2 + reveal);
          add('trim', acrossX ? [thickness, height, depth] : [depth, height, thickness], [cx + (acrossX ? edge : 0), y, cz + (acrossX ? 0 : edge)], accent);
          if (end === 1 || !door) {
            const span = width + (thickness + reveal) * 2;
            add('trim', acrossX ? [span, thickness, depth] : [depth, thickness, span],
              [cx, y + end * (height / 2 + thickness / 2 + reveal), cz], accent);
          }
        }
      }
    }
  }
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
  const translation = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion(), tint = new THREE.Color();
  for (const [key, boxes] of batches) {
    const fill = key === 'floor' ? { emissive: '#819298', emissiveIntensity: .17 } : key === 'marking' ? { emissive: '#8a9697', emissiveIntensity: .11 } : {};
    const mesh = new THREE.InstancedMesh(geometry, material(`building-${key}`, '#ffffff', { roughness: .92, metalness: key === 'bridge' ? .24 : .08, ...fill, ...(key === 'wall' && masonry ? { map: masonry } : {}) }), boxes.length);
    boxes.forEach((box, i) => {
      matrix.compose(translation.set(...box.position), rotation, scale.set(...box.size)); mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, tint.set(box.tint || colors[key]));
    });
    mesh.castShadow = mesh.receiveShadow = true; mesh.name = `architecture-${key}`; scene.add(mesh);
  }
}
