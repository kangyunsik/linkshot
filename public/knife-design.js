import * as THREE from '/vendor/three.module.js';
import { FirearmGeometry } from './firearm-geometry.js';

let template;
export function createKnifeBody(models, group, materials) {
  if (!template) {
    const g = new FirearmGeometry();
    g.profile('knife-full-tang', [[-.48, -.12], [-.36, -.071], [-.04, -.071], [.21, -.101], [.21, -.145], [-.36, -.145]], .009, 'steel', 'frame', { bevel: .001 });
    g.profile('knife-honed-edge', [[-.48, -.12], [-.36, -.145], [-.045, -.145], [-.045, -.132], [-.35, -.131]], .004, 'plate', 'frame', { bevel: .0006 });
    g.profile('knife-textured-handle', [[-.02, -.09], [.18, -.09], [.205, -.108], [.205, -.15], [.17, -.16], [-.02, -.15]], .044, 'rubber', 'frame', { bevel: .005, round: .009 });
    g.block('knife-crossguard', [.065, .125, .018], [0, -.115, -.034], 'black');
    for (const side of [-1, 1]) for (const z of [.025, .13]) g.add('knife-handle-pin', new THREE.CylinderGeometry(.005, .005, .003, 8), 'steel', [side * .024, -.12, z], 'frame', [0, 0, Math.PI / 2]);
    template = g.finish();
  }
  const body = new THREE.Group(); body.name = 'knife-body'; group.add(body);
  for (const part of template.parts) { const mesh = new THREE.Mesh(models.sharedOperatorGeometry(`knife/${part.slot}`, part.geometry), materials[part.slot]); mesh.name = `knife-${part.slot}`; body.add(mesh); }
  body.userData.features = template.features; return { body, muzzleZ: -.48, aimHeight: 0 };
}
