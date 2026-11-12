import * as THREE from '/vendor/three.module.js';

// Batch only the immutable box scenery built before players/weapons exist.
// Spatial chunks retain useful frustum culling instead of one map-sized batch.
export function batchStaticBoxes(scene, geometry, cellSize = 16) {
  scene.updateMatrixWorld(true);
  const groups = new Map(), inverse = scene.matrixWorld.clone().invert(), matrix = new THREE.Matrix4();
  let sources = 0, batches = 0, instances = 0;
  scene.traverseVisible((mesh) => {
    if (!mesh.isMesh || mesh.isInstancedMesh || mesh.geometry !== geometry || Array.isArray(mesh.material) || mesh.material.transparent || !mesh.visible) return;
    const position = mesh.matrixWorld.elements;
    const key = `${mesh.material.id}/${+mesh.castShadow}/${+mesh.receiveShadow}/${mesh.layers.mask}/${mesh.renderOrder}/${Math.floor(position[12] / cellSize)},${Math.floor(position[14] / cellSize)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mesh); sources++;
  });
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const source = meshes[0], batch = new THREE.InstancedMesh(geometry, source.material, meshes.length);
    batch.name = 'static-scenery'; batch.castShadow = source.castShadow; batch.receiveShadow = source.receiveShadow; batch.layers.mask = source.layers.mask; batch.renderOrder = source.renderOrder; batch.matrixAutoUpdate = false;
    meshes.forEach((mesh, index) => { batch.setMatrixAt(index, matrix.multiplyMatrices(inverse, mesh.matrixWorld)); mesh.removeFromParent(); });
    batch.computeBoundingBox(); batch.computeBoundingSphere(); scene.add(batch); batches++; instances += meshes.length;
  }
  return { sources, batches, instances, draws: sources - instances + batches };
}
