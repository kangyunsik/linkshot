import * as THREE from '/vendor/three.module.js';
import { mergeGeometries } from '/vendor/addons/utils/BufferGeometryUtils.js';

const shapeFrom = (points, radius = 0) => {
  if (!radius) { const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))); shape.closePath(); return shape; }
  const shape = new THREE.Shape(), vertices = points.map(([x, y]) => new THREE.Vector2(x, y));
  vertices.forEach((point, i) => {
    const before = vertices[(i + vertices.length - 1) % vertices.length].clone().sub(point), after = vertices[(i + 1) % vertices.length].clone().sub(point);
    const trim = Math.min(radius, before.length() * .3, after.length() * .3), a = point.clone().addScaledVector(before.normalize(), trim), b = point.clone().addScaledVector(after.normalize(), trim);
    if (!i) shape.moveTo(a.x, a.y); else shape.lineTo(a.x, a.y); shape.quadraticCurveTo(point.x, point.y, b.x, b.y);
  });
  shape.closePath(); return shape;
};

// Author continuous, chamfered silhouettes instead of stacking full-size boxes.
// Prototypes stay CPU-side; each WeaponModels owner uploads one shared copy.
export class FirearmGeometry {
  constructor() { this.batches = new Map(); this.groups = new Map([['frame', [0, 0, 0]]]); this.features = []; }

  add(name, geometry, slot, position = [0, 0, 0], parent = 'frame', rotation = null, kind = 'detail', holes = 0) {
    if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    geometry.translate(...position); geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    this.features.push({ name, kind, holes, parent, min: box.min.toArray(), max: box.max.toArray() });
    const key = `${parent}/${slot}`; if (!this.batches.has(key)) this.batches.set(key, []);
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const attribute of Object.keys(flat.attributes)) if (!['position', 'normal', 'uv'].includes(attribute)) flat.deleteAttribute(attribute);
    this.batches.get(key).push(flat); if (flat !== geometry) geometry.dispose();
  }

  profile(name, points, width, slot = 'coat', parent = 'frame', { bevel = .004, round = 0, holes = [], position = [0, 0, 0] } = {}) {
    const shape = shapeFrom(points, round); for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
    const edge = Math.min(bevel, width * .22);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: width - edge * 2, steps: 1, curveSegments: 3, bevelEnabled: edge > 0, bevelSize: edge, bevelThickness: edge, bevelSegments: 1 });
    geometry.rotateY(-Math.PI / 2); geometry.translate(width / 2 - edge, 0, 0);
    this.add(name, geometry, slot, position, parent, null, 'chamfered-profile', holes.length);
  }

  block(name, size, position, slot = 'black', parent = 'frame', bevel = .002) {
    const [w, h, d] = size, edge = Math.min(bevel, w * .2, h * .2, d * .2);
    this.profile(name, [[-d / 2, -h / 2], [d / 2, -h / 2], [d / 2, h / 2], [-d / 2, h / 2]], w, slot, parent, { bevel: edge, position });
  }

  tube(name, radius, length, position, slot = 'steel', parent = 'frame', { front = radius, bore = 0, through = false } = {}) {
    const half = length / 2, lip = Math.min(.003, length * .08, radius * .14);
    const points = [[through ? bore : 0, -half], [radius - lip, -half], [radius, -half + lip], [front, half - lip], [front - lip, half]];
    if (bore && through) points.push([bore, half], [bore, -half]);
    else if (bore) points.push([bore, half], [bore, half - Math.min(.05, length * .7)], [0, half - Math.min(.05, length * .7)]); else points.push([0, half]);
    const geometry = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 16); geometry.rotateX(-Math.PI / 2);
    this.add(name, geometry, slot, position, parent, null, through ? 'open-optic-tube' : bore ? 'bored-barrel' : 'turned-metal', through ? 1 : 0);
  }

  ring(name, radius, thickness, position, slot = 'black', parent = 'frame') {
    this.add(name, new THREE.TorusGeometry(radius, thickness, 6, 20), slot, position, parent, null, 'open-ring', 1);
  }

  frame(name, width, height, depth, position, slot = 'black', parent = 'frame', { rim = .007 } = {}) {
    const rounded = (w, h, r) => {
      const shape = new THREE.Shape(); shape.moveTo(-w / 2 + r, -h / 2); shape.lineTo(w / 2 - r, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
      shape.lineTo(w / 2, h / 2 - r); shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); shape.lineTo(-w / 2 + r, h / 2); shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); shape.lineTo(-w / 2, -h / 2 + r); shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2); return shape;
    };
    const shape = rounded(width, height, .009), opening = rounded(width - rim * 2, height - rim * 2, .006); shape.holes.push(opening);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, steps: 1, curveSegments: 4, bevelEnabled: true, bevelSize: .001, bevelThickness: .001, bevelSegments: 1 }); geometry.translate(0, 0, -depth / 2);
    this.add(name, geometry, slot, position, parent, null, 'open-optic', 1);
  }

  section(name, sections, slot = 'coat', parent = 'frame') {
    const vertices = [], indices = [];
    for (const { z, w, h, y = 0 } of sections) {
      const x = w / 2, v = h / 2, b = Math.min(w, h) * .19;
      for (const [px, py] of [[-x + b, -v], [x - b, -v], [x, -v + b], [x, v - b], [x - b, v], [-x + b, v], [-x, v - b], [-x, -v + b]]) vertices.push(px, py + y, z);
    }
    for (let ring = 0; ring < sections.length - 1; ring++) for (let i = 0; i < 8; i++) { const a = ring * 8 + i, b = ring * 8 + (i + 1) % 8; indices.push(a, b, a + 8, b, b + 8, a + 8); }
    for (let i = 1; i < 7; i++) { indices.push(0, i + 1, i); const start = (sections.length - 1) * 8; indices.push(start, start + i, start + i + 1); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices);
    const flat = geometry.toNonIndexed(); geometry.dispose(); flat.computeVertexNormals();
    const p = flat.getAttribute('position'), uv = [];
    for (let i = 0; i < p.count; i++) uv.push(p.getZ(i) * 2, p.getY(i) * 4 + p.getX(i) * 2);
    flat.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); this.add(name, flat, slot, [0, 0, 0], parent, null, 'tapered-octagonal-section');
  }

  finish() {
    const parts = [];
    for (const [key, geometries] of this.batches) {
      const [parent, slot] = key.split('/'), geometry = mergeGeometries(geometries, false); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      parts.push({ parent, slot, geometry }); for (const source of geometries) source.dispose();
    }
    return { parts, groups: [...this.groups], features: this.features };
  }
}
