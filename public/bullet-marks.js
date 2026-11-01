import * as THREE from '/vendor/three.module.js';
import { BULLET_MARK_RULES } from '/shared/world.js';
import { getWeapon } from '/shared/catalog.js';

let atlasCanvas;
const hash = (text) => { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619); return value >>> 0; };

// Project-authored circular pitting, chipped lips and soft powder. No downloaded
// decal pack, engine workflow, account data or per-shot image generation.
function atlas() {
  if (atlasCanvas) return atlasCanvas;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256; const ctx = canvas.getContext('2d');
  for (let tile = 0; tile < 8; tile++) {
    let seed = tile * 7919 + 1777; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const image = ctx.createImageData(128, 128), stone = tile >= 4;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const dx = (x - 64) / 128, dy = (y - 64) / 128, angle = Math.atan2(dy, dx), rough = 1 + .06 * Math.sin(angle * 7 + tile) + .025 * Math.sin(angle * 13 + tile * 2), r = Math.hypot(dx, dy) / rough, noise = random();
      let alpha = 0, color = stone ? [100, 94, 83] : [85, 89, 88];
      if (r < .095) { alpha = .88; const shade = 22 + r / .095 * 22 + noise * 9; color = stone ? [shade + 4, shade + 1, shade - 2] : [shade, shade + 2, shade + 3]; }
      else if (r < .155) { alpha = .64 + noise * .20; const lip = 75 + noise * 50 + Math.cos(angle + .8) * 22; color = stone ? [lip + 10, lip + 2, lip - 9] : [lip, lip + 4, lip + 5]; }
      else if (r < .45) alpha = (stone ? .27 : .15) * (1 - (r - .155) / .295) ** 2 * (.45 + noise * .55);
      const i = (y * 128 + x) * 4; image.data[i] = color[0]; image.data[i + 1] = color[1]; image.data[i + 2] = color[2]; image.data[i + 3] = alpha * 255;
    }
    const ox = tile % 4 * 128, oy = Math.floor(tile / 4) * 128; ctx.putImageData(image, ox, oy);
    ctx.strokeStyle = stone ? 'rgba(31,26,20,.18)' : 'rgba(22,27,29,.13)'; ctx.lineWidth = .7;
    for (let crack = 0; crack < (stone ? 6 : 3); crack++) { const angle = random() * Math.PI * 2, length = 24 + random() * 22; ctx.beginPath(); ctx.moveTo(ox + 64 + Math.cos(angle) * 17, oy + 64 + Math.sin(angle) * 17); ctx.lineTo(ox + 64 + Math.cos(angle + .06) * length * .7, oy + 64 + Math.sin(angle + .06) * length * .7); ctx.lineTo(ox + 64 + Math.cos(angle - .04) * length, oy + 64 + Math.sin(angle - .04) * length); ctx.stroke(); }
  }
  atlasCanvas = canvas; return canvas;
}

export class BulletMarks {
  constructor(scene, worldMeshes) {
    this.scene = scene;
    // Do not raycast every triangle of a merged arena for every shotgun pellet.
    // Small local details refine the hit; large batches use the exact collider.
    this.worldMeshes = worldMeshes.filter((mesh) => (mesh.geometry.index?.count || mesh.geometry.getAttribute('position').count) / 3 <= 2500).map((mesh) => ({ mesh, bounds: new THREE.Box3().setFromObject(mesh) }));
    this.items = []; this.cells = new Map(); this.seen = new Map(); this.now = { value: 0 }; this.caster = new THREE.Raycaster();
    this.geometry = new THREE.PlaneGeometry(1, 1);
    for (const [name, size] of [['markBorn', 1], ['markTile', 2], ['markMin', 3], ['markMax', 3]]) { const attribute = new THREE.InstancedBufferAttribute(new Float32Array(BULLET_MARK_RULES.maxMarks * size), size); attribute.setUsage(THREE.DynamicDrawUsage); this.geometry.setAttribute(name, attribute); }
    this.geometry.getAttribute('markBorn').array.fill(-1e8);
    this.texture = new THREE.CanvasTexture(atlas()); this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 4;
    this.material = new THREE.MeshStandardMaterial({ map: this.texture, color: '#ffffff', roughness: 1, metalness: 0, transparent: true, alphaTest: .008, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.markNow = this.now;
      shader.vertexShader = 'attribute float markBorn; attribute vec2 markTile; attribute vec3 markMin; attribute vec3 markMax; uniform float markNow; varying float vMarkFade; varying vec3 vMarkPosition; varying vec3 vMarkMin; varying vec3 vMarkMax;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = vMapUv * vec2(.25, .5) + markTile; vMarkFade = clamp((${BULLET_MARK_RULES.lifetimeMs}.0 - (markNow - markBorn)) / ${BULLET_MARK_RULES.fadeMs}.0, 0.0, 1.0); vMarkPosition = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz; vMarkMin = markMin; vMarkMax = markMax;`);
      shader.fragmentShader = 'varying float vMarkFade; varying vec3 vMarkPosition; varying vec3 vMarkMin; varying vec3 vMarkMax;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', 'if (any(lessThan(vMarkPosition, vMarkMin)) || any(greaterThan(vMarkPosition, vMarkMax))) discard; diffuseColor.a *= vMarkFade;\n#include <alphatest_fragment>');
    };
    this.material.customProgramCacheKey = () => 'instanced-bullet-scars-v1';
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, BULLET_MARK_RULES.maxMarks); this.mesh.name = 'persistent-bullet-scars'; this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(10000, -10000, 10000)); scene.add(this.mesh);
  }

  prepareWarmup() { this.mesh.count = Math.max(1, this.items.length); }
  finishWarmup() { this.mesh.count = this.items.length; }

  refine(surface, origin) {
    let point = new THREE.Vector3(surface.point.x, surface.point.y, surface.point.z), normal = new THREE.Vector3(surface.normal.x, surface.normal.y, surface.normal.z).normalize();
    const incoming = origin ? point.clone().sub(new THREE.Vector3(origin.x, origin.y, origin.z)).normalize() : normal.clone().negate();
    this.caster.set(point.clone().addScaledVector(incoming, -.14), incoming); this.caster.near = 0; this.caster.far = .28;
    const nearby = this.worldMeshes.filter((entry) => entry.bounds.distanceToPoint(point) < .18).map((entry) => entry.mesh);
    for (const hit of this.caster.intersectObjects(nearby, false)) {
      const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material;
      if (material?.transparent && material.opacity < .5) continue;
      const transform = hit.object.matrixWorld.clone();
      if (hit.object.isInstancedMesh) { const instance = new THREE.Matrix4(); hit.object.getMatrixAt(hit.instanceId, instance); transform.multiply(instance); }
      const facing = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(transform));
      if (facing.dot(normal) < .6 || facing.dot(incoming) >= -.01) continue;
      point = hit.point.clone(); normal = facing; break;
    }
    return { point, normal };
  }

  add(surface, origin = null, born = performance.now()) {
    const now = performance.now();
    if (typeof surface?.id !== 'string' || surface.id.length > 256 || !surface.point || !surface.normal || !surface.bounds || ![surface.point.x, surface.point.y, surface.point.z, surface.normal.x, surface.normal.y, surface.normal.z, born, ...['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'].map((key) => surface.bounds[key])].every(Number.isFinite) || now - born >= BULLET_MARK_RULES.lifetimeMs || this.seen.has(surface.id)) return false;
    this.seen.set(surface.id, born); while (this.seen.size > BULLET_MARK_RULES.maxMarks * 4) this.seen.delete(this.seen.keys().next().value);
    const { point, normal } = this.refine(surface, origin); if (normal.lengthSq() < .9) return false;
    const key = `${surface.surfaceId}/${surface.normal.x},${surface.normal.y},${surface.normal.z}/${Math.round(point.x * BULLET_MARK_RULES.cellScale)},${Math.round(point.y * BULLET_MARK_RULES.cellScale)},${Math.round(point.z * BULLET_MARK_RULES.cellScale)}`;
    const existing = this.cells.get(key);
    if (existing && existing.normal.dot(normal) > .95) { existing.born = born; this.geometry.getAttribute('markBorn').setX(existing.index, born); this.geometry.getAttribute('markBorn').needsUpdate = true; return true; }
    if (this.items.length >= BULLET_MARK_RULES.maxMarks) { let oldest = 0; for (let i = 1; i < this.items.length; i++) if (this.items[i].born < this.items[oldest].born) oldest = i; this.removeAt(oldest); }
    const seed = hash(surface.id), weapon = getWeapon(surface.weaponId), size = (weapon.type === 'SHOTGUN' ? .07 : weapon.type === 'SNIPER' ? .14 : weapon.type === 'SIDEARM' ? .09 : .115) * (.92 + seed % 17 / 100);
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), seed / 0xffffffff * Math.PI * 2));
    const matrix = new THREE.Matrix4().compose(point.clone().addScaledVector(normal, .0025), rotation, new THREE.Vector3(size, size * (.96 + seed % 9 / 100), 1));
    const limits = surface.bounds, axes = ['x', 'y', 'z'], axis = axes.reduce((a, b) => Math.abs(surface.normal[a]) > Math.abs(surface.normal[b]) ? a : b), min = [], max = [];
    for (const component of axes) { const suffix = component.toUpperCase(); min.push(component === axis ? -10000 : limits[`min${suffix}`] - .001); max.push(component === axis ? 10000 : limits[`max${suffix}`] + .001); }
    const tile = seed % 4 + (['container', 'equipment', 'reactor'].includes(surface.kind) ? 0 : 4), item = { key, index: this.items.length, born, normal, point, matrix, tile, min, max };
    this.items.push(item); this.cells.set(key, item); this.write(item); this.mesh.count = this.items.length; return true;
  }

  write(item) {
    this.mesh.setMatrixAt(item.index, item.matrix); this.mesh.instanceMatrix.needsUpdate = true;
    this.geometry.getAttribute('markBorn').setX(item.index, item.born); this.geometry.getAttribute('markTile').setXY(item.index, item.tile % 4 / 4, (1 - Math.floor(item.tile / 4)) / 2); this.geometry.getAttribute('markMin').setXYZ(item.index, ...item.min); this.geometry.getAttribute('markMax').setXYZ(item.index, ...item.max);
    for (const name of ['markBorn', 'markTile', 'markMin', 'markMax']) this.geometry.getAttribute(name).needsUpdate = true;
  }
  removeAt(index) {
    const item = this.items[index], last = this.items.pop(); if (this.cells.get(item.key) === item) this.cells.delete(item.key);
    if (index < this.items.length) { last.index = index; this.items[index] = last; this.write(last); }
    this.mesh.count = this.items.length;
  }
  update(now) {
    this.now.value = now;
    for (let i = this.items.length - 1; i >= 0; i--) if (now - this.items[i].born >= BULLET_MARK_RULES.lifetimeMs) this.removeAt(i);
    for (const [id, at] of this.seen) { if (now - at > BULLET_MARK_RULES.lifetimeMs + 1500) this.seen.delete(id); else break; }
  }
  clear() { this.items.length = 0; this.cells.clear(); this.seen.clear(); this.mesh.count = 0; }
  dispose() { this.clear(); this.worldMeshes.length = 0; this.scene.remove(this.mesh); this.mesh.dispose(); this.geometry.dispose(); this.material.dispose(); this.texture.dispose(); }
}
