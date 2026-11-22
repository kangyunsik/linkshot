import * as THREE from '/vendor/three.module.js';
import { mergeGeometries } from '/vendor/addons/utils/BufferGeometryUtils.js';

export const isBasementSolid = box => box.kind === 'ground-slab' || box.kind?.startsWith('basement-');

function surfaceGeometry(items, world) {
  const slabs = items.map(([x, y, z, w, h, d]) => {
    const slab = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    const { position, normal, uv } = slab.attributes;
    for (let i = 0; i < uv.count; i++) {
      // Continue the ground texture across seams instead of repeating the
      // entire arena texture on every narrow slab bounding an opening.
      const leftRight = Math.abs(normal.getX(i)) > .5, flat = Math.abs(normal.getY(i)) > .5;
      uv.setXY(i, leftRight ? .5 + position.getZ(i) / world.depth : .5 + position.getX(i) / world.width,
        flat ? .5 - position.getZ(i) / world.depth : position.getY(i) / world.depth);
    }
    return slab;
  });
  const geometry = mergeGeometries(slabs);
  slabs.forEach(slab => slab.dispose());
  return geometry;
}

export function drawBasements(scene, world, material, surfaceTexture) {
  const u = world.underground;
  if (!u) return;
  const snow = world.theme === 'snow', batches = new Map();
  const solids = world.obstacles.filter(isBasementSolid), ceiling = solids.find(b => b.kind === 'ground-slab')?.y ?? 0;
  const add = (kind, x, y, z, w, h, d) => {
    if (!batches.has(kind)) batches.set(kind, []);
    batches.get(kind).push([x, y, z, w, h, d]);
  };
  for (const b of solids) {
    const top = b.y + b.h;
    if (b.kind === 'basement-wall') {
      // The surface slab already draws the wall's buried upper strip, including
      // the rim of the stair opening. Keep only the portions visible in a hole.
      const cap = Math.min(top, ceiling);
      add(b.kind, b.x, (u.floor + cap) / 2, b.z, b.w, cap - u.floor, b.d);
      if (top > cap) for (const hole of u.holes) {
        const x0 = Math.max(b.x - b.w / 2, hole.x - hole.w / 2), x1 = Math.min(b.x + b.w / 2, hole.x + hole.w / 2);
        const z0 = Math.max(b.z - b.d / 2, hole.z - hole.d / 2), z1 = Math.min(b.z + b.d / 2, hole.z + hole.d / 2);
        if (x1 - x0 > 1e-5 && z1 - z0 > 1e-5) add(b.kind, (x0 + x1) / 2, (cap + top) / 2, (z0 + z1) / 2, x1 - x0, top - cap, z1 - z0);
      }
    } else if (b.kind !== 'basement-step' || top > u.floor + 1e-5) {
      // The final tread is flush with the basement floor; draw the floor alone.
      const bottom = b.kind === 'basement-step' ? u.floor : b.y;
      add(b.kind, b.x, (bottom + top) / 2, b.z, b.w, top - bottom, b.d);
    }
    if (b.kind === 'basement-step') {
      const longX = b.w > b.d;
      add('stripe', b.x, b.y + b.h + .006, b.z, longX ? b.w * .75 : .06, .012, longX ? .06 : b.d * .75);
    }
    if (b.kind === 'basement-wall') {
      add('trim', b.x, u.floor + .16, b.z, b.w + .022, .26, b.d + .022);
      add('trim', b.x, -.47, b.z, b.w + .032, .10, b.d + .032);
      const alongX = b.w > b.d, length = alongX ? b.w : b.d;
      for (let at = -length / 2 + 2.8; at < length / 2 - .9; at += 3.8) {
        add('trim', b.x + (alongX ? at : 0), (u.floor - .47) / 2, b.z + (alongX ? 0 : at),
          alongX ? .10 : b.w + .034, -.68 - u.floor, alongX ? b.d + .034 : .10);
      }
    }
  }
  const guides = (path, service = false) => {
    for (const [i, a] of path.slice(0, -1).entries()) {
      const b = path[i + 1], length = Math.hypot(b.x - a.x, b.z - a.z), horizontal = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
      const count = Math.max(1, Math.floor(length / 3.4));
      for (let j = 0; j < count; j++) {
        const t = (j + .5) / count, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        add(service ? 'service-lamp' : 'lamp', x, -.269, z, horizontal ? .85 : .21, .052, horizontal ? .21 : .85);
        if (service) add('stripe', x, u.floor + .006, z, horizontal ? .56 : .095, .012, horizontal ? .095 : .56);
      }
    }
  };
  guides(u.path);
  for (const branch of u.branches) guides(branch.path, true);
  const geo = new THREE.BoxGeometry(1, 1, 1), matrix = new THREE.Matrix4(), translation = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const palette = {
    'ground-slab': world.ground, 'basement-floor': snow ? '#84989c' : '#778689',
    'basement-wall': snow ? '#a2b3ba' : '#8d9090', 'basement-step': snow ? '#748e9a' : '#676f73',
    'basement-rail': snow ? '#526c79' : '#856246', 'basement-cover': snow ? '#5c7683' : '#806950',
    stripe: '#dca66f', trim: snow ? '#4e6e7d' : '#686457', lamp: snow ? '#ddfaff' : '#ffdbab', 'service-lamp': '#f2ad69',
  };
  for (const [kind, items] of batches) {
    const cap = kind === 'ground-slab', lamp = kind.endsWith('lamp');
    const surface = material(`cellar-${kind}`, palette[kind], {
      roughness: cap ? .98 : .9, metalness: cap ? .01 : .07, emissive: lamp ? palette[kind] : snow ? '#a2b6c1' : '#a6a7a0',
      emissiveIntensity: lamp ? .75 : cap ? .10 : .27, ...(cap ? { map: surfaceTexture } : {}),
    });
    const mesh = cap ? new THREE.Mesh(surfaceGeometry(items, world), surface) : new THREE.InstancedMesh(geo, surface, items.length);
    if (!cap) items.forEach(([x, y, z, w, h, d], i) => {
      matrix.compose(translation.set(x, y, z), rotation, scale.set(w, h, d));
      mesh.setMatrixAt(i, matrix);
    });
    mesh.name = `cellar-${kind}`; mesh.castShadow = !lamp && kind !== 'stripe'; mesh.receiveShadow = !lamp;
    scene.add(mesh);
  }
}
