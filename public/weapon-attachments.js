import * as THREE from '/vendor/three.module.js';
import { FirearmGeometry } from './firearm-geometry.js';

const prototypes = new Map();

export function createSuppressor(models, weapon, muzzleZ, material) {
  const length = weapon.type === 'SNIPER' ? .24 : weapon.type === 'SHOTGUN' ? .22 : .18, radius = weapon.type === 'SHOTGUN' || weapon.id === 'm82' ? .049 : .037;
  const tip = muzzleZ + .02 - length;
  if (!prototypes.has(weapon.id)) {
    const parts = new FirearmGeometry();
    for (const y of weapon.id === 's686' ? [.02, -.033] : [.02]) parts.tube('sound-suppressor', weapon.id === 's686' ? .030 : radius, length, [0, y, muzzleZ + .02 - length / 2], 'black', 'frame', { bore: weapon.type === 'SHOTGUN' ? weapon.id === 's686' ? .014 : .022 : .012, through: true });
    prototypes.set(weapon.id, parts.finish().parts[0].geometry);
  }
  const mesh = new THREE.Mesh(models.sharedOperatorGeometry(`suppressor-v1/${weapon.id}`, prototypes.get(weapon.id)), material); mesh.name = 'weapon-suppressor'; mesh.visible = false;
  return { mesh, tip };
}

export function setModelSuppressor(model, enabled) {
  const data = model.userData, active = enabled === true && !!data.suppressorMesh;
  data.suppressor = active;
  if (data.suppressorMesh) data.suppressorMesh.visible = active;
  if (data.muzzle) data.muzzle.position.z = active ? data.suppressorTip : data.baseMuzzleZ;
  if (data.flash) { data.flash.position.z = data.muzzle.position.z - .10; data.flash.scale.setScalar(active ? .32 : 1); }
}
