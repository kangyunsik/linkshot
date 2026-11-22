import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('all arena renderers avoid conflicting opaque coplanar skins on floors, doors, scenery and signs', async ({ page }) => {
  await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const [THREE, { FPSGame }, { MAPS }] = await Promise.all([import('/vendor/three.module.js'), import('/game.js'), import('/shared/world.js')]);
    const prototype = FPSGame.prototype, tolerance = .00004;
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    function intersection(a, b) {
      let polygon = a;
      const sign = Math.sign(cross(...b));
      for (let j = 0; j < 3 && polygon.length; j++) {
        const u = b[j], v = b[(j + 1) % 3], next = [];
        for (let i = 0; i < polygon.length; i++) {
          const p = polygon[i], q = polygon[(i + 1) % polygon.length], x = sign * cross(u, v, p), y = sign * cross(u, v, q);
          if (x >= 0) next.push(p);
          if ((x >= 0) !== (y >= 0)) { const t = x / (x - y); next.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
        }
        polygon = next;
      }
      return polygon;
    }
    const vertices = Array.from({ length: 3 }, () => new THREE.Vector3()), normal = new THREE.Vector3(), edge = new THREE.Vector3();
    const center = new THREE.Vector3(), local = new THREE.Vector3(), matrix = new THREE.Matrix4(), instance = new THREE.Matrix4(), color = new THREE.Color();
    return MAPS.map(world => {
      const view = {
        world, scene: new THREE.Scene(), renderer: { capabilities: { getMaxAnisotropy: () => 8 } },
        materials: {}, boxGeometry: new THREE.BoxGeometry(1, 1, 1), material: prototype.material, box: prototype.box,
      };
      view.scene.background = new THREE.Color(world.sky); view.scene.fog = new THREE.FogExp2(world.sky, .02);
      prototype.makeWorld.call(view); view.scene.updateMatrixWorld(true);
      const materialNames = new Map(Object.entries(view.materials).map(([name, material]) => [material, name]));
      const planes = new Map(), solids = [], floor = world.underground?.floor ?? 0;
      // The basement surface is a merged mesh; include each of its real slab
      // volumes when deciding whether a seam can be seen from the play space.
      for (const slab of world.obstacles.filter(b => b.kind === 'ground-slab')) {
        const bounds = new THREE.Box3(new THREE.Vector3(slab.x - slab.w / 2, slab.y, slab.z - slab.d / 2),
          new THREE.Vector3(slab.x + slab.w / 2, slab.y + slab.h, slab.z + slab.d / 2));
        solids.push({ id: -1, bounds, worldBox: bounds, inverse: new THREE.Matrix4() });
      }
      let meshes = 0, faces = 0;
      view.scene.traverseVisible(mesh => {
        const material = mesh.material;
        if (!mesh.isMesh || Array.isArray(material) || !material.depthWrite || material.polygonOffset) return;
        const geometry = mesh.geometry, { position } = geometry.attributes, indices = geometry.getIndex();
        geometry.computeBoundingBox();
        const label = mesh.name || materialNames.get(material) || `${geometry.type}${material.map ? '/texture' : ''}`;
        for (let i = 0; i < (mesh.isInstancedMesh ? mesh.count : 1); i++) {
          matrix.copy(mesh.matrixWorld);
          if (mesh.isInstancedMesh) { mesh.getMatrixAt(i, instance); matrix.multiply(instance); }
          if (mesh.instanceColor) mesh.getColorAt(i, color); else color.set('#ffffff');
          const shading = `${material.id}/${color.getHexString()}/${+mesh.receiveShadow}`;
          const id = meshes++;
          if (geometry.type === 'BoxGeometry' && !mesh.name.endsWith('-ramp')) {
            solids.push({ id, bounds: geometry.boundingBox, worldBox: geometry.boundingBox.clone().applyMatrix4(matrix), inverse: matrix.clone().invert() });
          }
          for (let j = 0; j < (indices?.count ?? position.count); j += 3) {
            for (let k = 0; k < 3; k++) vertices[k].fromBufferAttribute(position, indices ? indices.getX(j + k) : j + k).applyMatrix4(matrix);
            normal.subVectors(vertices[1], vertices[0]).cross(edge.subVectors(vertices[2], vertices[0]));
            if (normal.lengthSq() < 1e-12) continue;
            normal.normalize();
            if (normal.y < -.99 && vertices.every(v => v.y <= floor + tolerance)) continue;
            const plane = normal.dot(vertices[0]), n = [normal.x, normal.y, normal.z], axis = n.reduce((max, v, index) => Math.abs(v) > Math.abs(n[max]) ? index : max, 0);
            const flat = vertices.map(point => point.toArray().filter((_, index) => index !== axis));
            const bounds = [0, 1].flatMap(d => [Math.min(...flat.map(p => p[d])), Math.max(...flat.map(p => p[d]))]);
            const key = [...n, plane].map(value => Math.round(value / tolerance)).join('/');
            if (!planes.has(key)) planes.set(key, []);
            planes.get(key).push({ id, label, shading, textured: !!material.map, plane, axis, n, flat, bounds });
            faces++;
          }
        }
      });
      const hidden = (point, a, b) => solids.some(solid => {
        if (solid.id === a || solid.id === b || !solid.worldBox.containsPoint(point)) return false;
        local.copy(point).applyMatrix4(solid.inverse);
        const { min, max } = solid.bounds;
        return ['x', 'y', 'z'].every(axis => local[axis] > min[axis] + 1e-5 && local[axis] < max[axis] - 1e-5);
      });
      const pairs = new Map();
      for (const list of planes.values()) {
        list.sort((a, b) => a.bounds[0] - b.bounds[0]);
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j].bounds[0] < list[i].bounds[1] - tolerance; j++) {
          const a = list[i], b = list[j];
          // Identical untextured shading doesn't show competing colors at equal depth.
          if (a.id === b.id || a.bounds[2] >= b.bounds[3] - tolerance || b.bounds[2] >= a.bounds[3] - tolerance ||
              a.shading === b.shading && !a.textured && !b.textured) continue;
          const poly = intersection(a.flat, b.flat);
          if (poly.length < 3) continue;
          const area = Math.abs(poly.reduce((s, p, k) => s + p[0] * poly[(k + 1) % poly.length][1] - p[1] * poly[(k + 1) % poly.length][0], 0)) / 2;
          if (area < .0001) continue;
          const mean = poly.reduce((p, q) => [p[0] + q[0] / poly.length, p[1] + q[1] / poly.length], [0, 0]);
          if (![mean, ...poly.map(p => p.map((v, d) => .3 * mean[d] + .7 * v))].some(point => {
            const value = (a.plane - point.reduce((s, v, d) => s + v * a.n[d >= a.axis ? d + 1 : d], 0)) / a.n[a.axis];
            const xyz = point.slice(); xyz.splice(a.axis, 0, value);
            center.set(...xyz).addScaledVector(normal.set(...a.n), .0007);
            return !hidden(center, a.id, b.id);
          })) continue;
          const pair = [a.label, b.label].sort().join(' / ');
          const finding = pairs.get(pair) || { area: 0, near: center.toArray().map(value => +value.toFixed(3)) };
          finding.area += area; pairs.set(pair, finding);
        }
      }
      prototype.disposeObject.call(view, view.scene);
      return { mapId: world.id, meshes, faces, overlaps: [...pairs.entries()].map(([pair, finding]) => ({ pair, ...finding, area: +finding.area.toFixed(4) })) };
    });
  });
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/map-depth-audit.json', JSON.stringify(result, null, 2));
  expect(result).toHaveLength(12);
  expect(result.flatMap(map => map.overlaps.map(overlap => ({ mapId: map.mapId, ...overlap })))).toEqual([]);
});
