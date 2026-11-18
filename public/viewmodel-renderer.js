export const VIEWMODEL_LAYER = 1;
export const normalizeWeaponHand = (value) => value === 'left' ? 'left' : 'right';
export const VIEWMODEL_HIP_OFFSET = Object.freeze({ x: .26, y: -.28, z: -.54 });
export const VIEWMODEL_SNIPER_OFFSET = Object.freeze({ x: .37, y: -.37, z: -.48 });
export const viewmodelHipOffset = (weapon) => weapon.type === 'SNIPER' ? VIEWMODEL_SNIPER_OFFSET : VIEWMODEL_HIP_OFFSET;
export const VIEWMODEL_ADS_Z = -.35;

export async function compileViewmodelPrograms(renderer, scene, camera) {
  const mask = camera.layers.mask;
  try {
    camera.layers.set(0); await renderer.compileAsync(scene, camera);
    camera.layers.set(VIEWMODEL_LAYER); await renderer.compileAsync(scene, camera);
  } finally { camera.layers.mask = mask; }
}

// A separate depth pass lets fingers and the gun occlude each other normally,
// without letting a nearby wall clip the first-person model. The camera/FOV is
// unchanged, so the rendered sight still matches authoritative aiming exactly.
export function renderViewmodelFrame(renderer, scene, camera, viewmodel) {
  const mask = camera.layers.mask, background = scene.background, autoClear = renderer.autoClear;
  const reset = renderer.info.autoReset, shadows = renderer.shadowMap.autoUpdate;
  renderer.info.reset(); renderer.info.autoReset = false;
  try {
    camera.layers.set(0); renderer.render(scene, camera);
    if (viewmodel.visible) {
      renderer.autoClear = false; scene.background = null; renderer.shadowMap.autoUpdate = false;
      renderer.clearDepth(); camera.layers.set(VIEWMODEL_LAYER); renderer.render(scene, camera);
    }
  } finally {
    camera.layers.mask = mask; scene.background = background; renderer.autoClear = autoClear;
    renderer.info.autoReset = reset; renderer.shadowMap.autoUpdate = shadows;
  }
}
