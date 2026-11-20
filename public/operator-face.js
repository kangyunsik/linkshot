import * as THREE from '/vendor/three.module.js';

const shaping = {
  nari: { jaw: -.022, cheek: .018, eye: .89, arch: .06, nose: -.004, smile: .0037, brow: .83 },
  rhea: { jaw: -.036, cheek: .010, eye: .92, arch: .13, nose: .003, smile: .0011, brow: .82 },
  jin:  { jaw: -.068, cheek: -.014, eye: .81, arch: .055, nose: -.006, smile: .0018, brow: .91 },
};
const cache = new WeakMap();
const { smoothstep } = THREE.MathUtils;
const bell = (v, at, radius) => 1 - smoothstep(Math.abs(v - at), 0, radius);

// Soft identity-specific sculpt of the licensed head. The face, eyelids,
// eyeballs and brows receive the same transform, in the original bind space.
// No bone, position on the network, player size or hitbox is changed.
export function operatorFace(geometry, character, meshName) {
  const shape = shaping[character.id];
  if (!shape) return geometry;
  if (!cache.has(geometry)) cache.set(geometry, new Map());
  const identities = cache.get(geometry);
  if (!identities.has(character.id)) {
    const sculpt = geometry.clone(), positions = sculpt.getAttribute('position');
    const male = character.rig === 'male', height = male ? .0438 : 0, eyes = 1.654;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i) - height, z = positions.getZ(i), side = Math.abs(x);
      if (y < 1.532 || y > 1.711 || z < -.036 || side > .083) continue;
      const face = smoothstep(z,-.028,.045) * (1 - smoothstep(side,.071,.084));
      const jaw = bell(y,1.57,.039), cheek = bell(y,1.618,.040) * smoothstep(side,.024,.066);
      const eye = bell(y,eyes,.032) * smoothstep(side,.009,.026) * (1 - smoothstep(side,.058,.073));
      const nose = bell(y,1.613,.044) * (1 - smoothstep(side,.010,.033));
      const smile = bell(y,1.585,.023) * bell(side,.030,.030);
      const brow = meshName === 'Eyebrows' ? (y - 1.675) * (shape.brow - 1) : 0;
      positions.setXYZ(i, x * (1 + (jaw * shape.jaw + cheek * shape.cheek) * face),
        y + height + face * (eye * ((y - eyes) * (shape.eye - 1) + (side - .035) * shape.arch) + smile * shape.smile + brow),
        z + face * (nose * shape.nose + cheek * .003));
    }
    // Keep the body normals (already welded across texture seams), and smooth
    // the transformed eye and brow surfaces without disturbing their UVs.
    if (meshName === 'Eyebrows' || meshName === 'Eyes') sculpt.computeVertexNormals();
    identities.set(character.id, sculpt);
  }
  return identities.get(character.id);
}
