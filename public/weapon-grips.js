import * as THREE from '/vendor/three.module.js';

// Weapon-local sockets, not camera-space offsets. As in engine weapon IK rigs,
// recoil/ADS move the item and its targets together; the pump owns its target.
const support = {
  rifle: [-.065, -.045, -.255], smg: [-.061, -.05, -.225], shotgun: [-.065, -.065, -.405],
  sniper: [-.065, -.045, -.315], lmg: [-.067, -.052, -.495], dmr: [-.065, -.046, -.395],
};
const overrides = { m82: [-.073, -.05, -.375], p90: [-.072, -.07, -.205], mp5: [-.059, -.051, -.235], ump45: [-.067, -.051, -.235], famas: [-.062, -.05, -.255], m14: [-.064, -.052, -.395] };

export function weaponGrip(shape, id, right, palmLength) {
  const rotation = new THREE.Quaternion(); let wrist, profile;
  if (right || shape === 'pistol') {
    profile = right ? 'trigger' : 'wrap';
    wrist = [right ? .057 : -.055, right ? -.135 : -.16, .13 + palmLength + (right ? 0 : .008)];
    rotation.setFromEuler(new THREE.Euler(-1.64, 0, right ? .04 : -.05));
  } else {
    profile = shape === 'knife' ? 'fist' : 'cradle';
    const along = new THREE.Vector3(.30, .75, -.58).normalize(), normal = new THREE.Vector3(.85, -.1, .51);
    normal.addScaledVector(along, -normal.dot(along)).normalize();
    rotation.setFromRotationMatrix(new THREE.Matrix4().makeBasis(normal, along, normal.clone().cross(along)));
    const center = new THREE.Vector3(...(shape === 'knife' ? [-.19, -.13, -.10] : overrides[id] || support[shape]));
    wrist = center.addScaledVector(along, -palmLength * .64).toArray();
  }
  if (shape === 'knife' && right) profile = 'fist';
  return { wrist, rotation, profile, foreend: (overrides[id] || support[shape])?.[2] - .025 || null, parent: shape === 'shotgun' && !right ? 'pump' : 'frame' };
}
