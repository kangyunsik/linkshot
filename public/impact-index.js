import * as THREE from '/vendor/three.module.js';

// Static visual geometry only: authoritative collision/hit registration is not
// involved. Index individual instances, not a whole arena-sized batch bound.
export class ImpactIndex {
  constructor(meshes, cellSize = 4) {
    this.cellSize = cellSize; this.cells = new Map(); this.entries = []; this.visit = 0;
    const matrix = new THREE.Matrix4(), instance = new THREE.Matrix4();
    for (const mesh of meshes) {
      const geometry = mesh.geometry;
      if ((geometry.index?.count || geometry.getAttribute('position').count) / 3 > 2500) continue;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      for (let i = 0; i < (mesh.isInstancedMesh ? mesh.count : 1); i++) {
        if (mesh.isInstancedMesh) { mesh.getMatrixAt(i, instance); matrix.multiplyMatrices(mesh.matrixWorld, instance); }
        else matrix.copy(mesh.matrixWorld);
        const entry = { mesh, instanceId: mesh.isInstancedMesh ? i : null, bounds: geometry.boundingBox.clone().applyMatrix4(matrix), order: this.entries.length, visit: 0 };
        this.entries.push(entry);
        for (let x = Math.floor(entry.bounds.min.x / cellSize); x <= Math.floor(entry.bounds.max.x / cellSize); x++) {
          for (let z = Math.floor(entry.bounds.min.z / cellSize); z <= Math.floor(entry.bounds.max.z / cellSize); z++) {
            const key = `${x},${z}`;
            if (!this.cells.has(key)) this.cells.set(key, []);
            this.cells.get(key).push(entry);
          }
        }
      }
    }
  }

  nearby(point, radius, result) {
    result.length = 0; const visit = ++this.visit, size = this.cellSize;
    for (let x = Math.floor((point.x - radius) / size); x <= Math.floor((point.x + radius) / size); x++) {
      for (let z = Math.floor((point.z - radius) / size); z <= Math.floor((point.z + radius) / size); z++) {
        const entries = this.cells.get(`${x},${z}`); if (!entries) continue;
        for (const entry of entries) {
          if (entry.visit === visit) continue;
          entry.visit = visit;
          if (entry.bounds.distanceToPoint(point) < radius) result.push(entry);
        }
      }
    }
    return result;
  }

  clear() { this.cells.clear(); this.entries.length = 0; }
}
