import * as THREE from '/vendor/three.module.js';
import { operatorFace } from './operator-face.js';

export const WEAVE = 'operator-weave';

// One tile is shared by the body and first-person sleeves. Fine neutral weave,
// not lighting or a picture of a jacket baked onto a plate.
export function operatorWeave(models) {
  if (!models.textures.has(WEAVE)) {
    const size = 128, data = new Uint8Array(size * size * 4);
    let seed = 307;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const twill = Math.cos((x + y) * Math.PI * .25) * 8 + Math.sin(x * Math.PI * .5) * 3;
      const value = 227 + twill + ((seed >>> 27) - 16) * .48;
      data.set([value, value, value, 255], (x + y * size) * 4);
    }
    const texture = new THREE.DataTexture(data, size, size); texture.name = WEAVE;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
    models.textures.set(WEAVE, texture);
  }
  return models.textures.get(WEAVE);
}

// Two fitted base rigs with the original rig weights. Details are authored in
// bind space and stitched to that surface, then batched into one skinned mesh.
const cuts = {
  utility: { hem: .96, lapel: .065, collar: .071, pockets: .092 },
  scout:   { hem: .99, lapel: .071, collar: .085, pockets: .082, diagonal: true },
  bomber:  { hem: 1.02, lapel: .078, collar: .064, pockets: .072, fullYoke: true, ribbed: true },
  work:    { hem: .93, lapel: .065, collar: .044, pockets: .101, angular: true },
  track:   { hem: .99, lapel: .048, collar: .078, pockets: 0, doubleLine: true },
  coach:   { hem: .95, lapel: .082, collar: .044, pockets: 0, snaps: true, ribbed: true },
};
const dressed = new Map(), tailoring = new Map();
const { lerp, smoothstep } = THREE.MathUtils;
const paletteNames = ['suit', 'panel', 'pants', 'dark', 'accent', 'hardware'];
const point = (x, y, z) => new THREE.Vector3(x, y, z);

function positionOf(attribute, i) {
  return point(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
}

function weightBlend(entries) {
  const combined = new Map();
  for (const [joint, weight] of entries) if (weight > 1e-7) combined.set(joint, (combined.get(joint) || 0) + weight);
  const strongest = [...combined].sort((a,b) => b[1] - a[1]).slice(0,4);
  const total = strongest.reduce((acc, pair) => acc + pair[1], 0) || 1;
  return [Array.from({ length: 4 }, (_, i) => strongest[i]?.[0] || 0), Array.from({ length: 4 }, (_, i) => (strongest[i]?.[1] || 0) / total)];
}

// Split only triangles that cross a neckline or wrist. This gives the shirt
// and cuffs a clean boundary without either stretching the face texture
// or painting by the nearest dominant bone (which gives jagged edges).
function clipSkin(geometry, categories, distance, source) {
  const attributes = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'color', 'clothBlend'];
  const buffers = attributes.map(key => Array.from(geometry.getAttribute(key).array));
  const [p,n,uv,bones,weights,color,cloth] = buffers, appended = new Map();
  const midpoint = (a, b) => {
    if (a > b) [a,b] = [b,a];
    const hash = a * distance.length + b;
    if (appended.has(hash)) return appended.get(hash);
    const t = distance[a] / (distance[a] - distance[b]), slot = p.length / 3;
    for (const [array,size] of [[p,3],[n,3],[uv,2],[color,3],[cloth,3]]) {
      for (let j = 0; j < size; j++) array.push(lerp(array[a * size + j], array[b * size + j], t));
    }
    const entries = [];
    for (const [i,fraction] of [[a,1-t],[b,t]]) for (let j=0; j<4; j++) entries.push([bones[i * 4 + j],weights[i * 4 + j] * fraction]);
    const [joints, values] = weightBlend(entries);
    bones.push(...joints); weights.push(...values);
    appended.set(hash, slot); return slot;
  };
  const groups = [[], [], []], polygonSkin = [], polygonCloth = [];
  for (let i = 0; i < source.length; i += 3) {
    const a = source[i], b = source[i + 1], c = source[i + 2];
    const skins = Number(distance[a] >= 0) + Number(distance[b] >= 0) + Number(distance[c] >= 0);
    const footwear = Number(categories[a] === 2) + Number(categories[b] === 2) + Number(categories[c] === 2);
    if (skins === 3 || skins === 0) { groups[skins ? 0 : footwear >= 2 ? 2 : 1].push(a,b,c); continue; }
    const triangle = [a,b,c];
    polygonSkin.length = polygonCloth.length = 0;
    for (let s = 0; s < 3; s++) {
      const one = triangle[s], two = triangle[(s + 1) % 3], skin = distance[one] >= 0;
      (skin ? polygonSkin : polygonCloth).push(one);
      if (skin !== (distance[two] >= 0)) {
        const vertex = midpoint(one,two); polygonSkin.push(vertex); polygonCloth.push(vertex);
      }
    }
    for (const [poly,type] of [[polygonSkin,0],[polygonCloth,footwear ? 2 : 1]]) {
      for (let j = 1; j < poly.length - 1; j++) groups[type].push(poly[0],poly[j],poly[j+1]);
    }
  }
  for (const [i,key] of attributes.entries()) {
    const attribute = geometry.getAttribute(key);
    geometry.setAttribute(key, new THREE.BufferAttribute(new attribute.array.constructor(buffers[i]), attribute.itemSize, attribute.normalized));
  }
  geometry.setIndex(groups.flat()); geometry.clearGroups();
  let offset = 0; for (const [i, group] of groups.entries()) { geometry.addGroup(offset, group.length, i); offset += group.length; }
}

function buildBody(mesh, rig, covered, cut) {
  const geometry = mesh.geometry.clone();
  const p = geometry.getAttribute('position');
  const joints = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
  const originalNormals = geometry.getAttribute('normal').clone(), source = geometry.index.array;
  const height = rig === 'female' ? 0 : .038;
  const categories = [], regions = [], distances = [], neighbors = Array.from({ length: p.count }, () => new Set()), aliases = new Map();
  const rgb = new Float32Array(p.count * 3).fill(1);
  // The glTF duplicates vertices at UV seams. Move both sides together
  // and reconcile their normals so the seams aren't open cracks in the jacket.
  for (let i = 0; i < p.count; i++) {
    const key = [p.getX(i), p.getY(i), p.getZ(i)].map(n => Math.round(n * 1e5)).join('/');
    if (!aliases.has(key)) aliases.set(key, []);
    aliases.get(key).push(i);
    let best = 0; for (let j = 1; j < 4; j++) if (weights.getComponent(i, j) > weights.getComponent(i, best)) best = j;
    const bone = mesh.skeleton.bones[joints.getComponent(i, best)].name;
    const hand = /hand|index|middle|pinky|ring|thumb/i.test(bone), arm = /arm_|clavicle_/i.test(bone);
    const y = p.getY(i) - height, x = Math.abs(p.getX(i)), z = p.getZ(i);
    const neck = y - 1.493 - .017 * smoothstep(-z, -.05, .12) - Math.max(0, x - .057) * .95;
    const wrist = covered ? -1 : x - (rig === 'female' ? .646 : .720);
    distances[i] = Math.max(neck,wrist);
    categories[i] = distances[i] >= 0 ? 0 : /foot|ball/i.test(bone) || hand || /calf/.test(bone) && y < (rig === 'female' ? .143 : .105) ? 2 : 1;
    regions[i] = arm ? 'arm' : /leg|calf|thigh/.test(bone) ? 'leg' : 'body';
  }
  for (let i = 0; i < source.length; i += 3) for (let j = 0; j < 3; j++) neighbors[source[i + j]].add(source[i + (j + 1) % 3]).add(source[i + (j + 2) % 3]);
  for (const group of aliases.values()) {
    if (group.length < 2) continue;
    const connected = new Set(group.flatMap(i => [...neighbors[i]]));
    for (const i of group) neighbors[i] = connected;
  }
  for (let pass = 0; pass < 2; pass++) {
    const before = p.array.slice();
    for (let i = 0; i < p.count; i++) {
      if (categories[i] !== 1 || !neighbors[i].size || [...neighbors[i]].some(n => categories[n] !== 1)) continue;
      let x = 0, y = 0, z = 0;
      for (const n of neighbors[i]) { x += before[n * 3]; y += before[n * 3 + 1]; z += before[n * 3 + 2]; }
      const blend = .27 / neighbors[i].size;
      p.setXYZ(i, before[i * 3] * .73 + x * blend, before[i * 3 + 1] * .73 + y * blend, before[i * 3 + 2] * .73 + z * blend);
    }
  }
  for (let i = 0; i < p.count; i++) {
    if (categories[i] === 0) continue;
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (categories[i] === 1 && [...neighbors[i]].every(n => categories[n] !== 0)) {
      const arm = regions[i] === 'arm', leg = regions[i] === 'leg';
      const lowerLeg = leg ? smoothstep(y,.115,.27) * (1 - smoothstep(y,.47,.74)) : 0;
      const ply = arm ? cut.ribbed ? .019 : .014 : leg ? .013 + lowerLeg * .010 : .009;
      const phase = arm ? Math.abs(x) * 62 + z * 21 : y * 55 + x * 16;
      const fold = (leg ? .006 : .0048) * Math.sin(phase) * Math.sin(phase * .45 + 1.5);
      const allowance = ply + fold;
      const fittedY = y - height;
      const chest = !arm && !leg ? smoothstep(fittedY,1.09,1.24) * (1 - smoothstep(fittedY,1.36,1.469))
        * (1 - smoothstep(Math.abs(x),.125,.172)) * smoothstep(z,.025,.077) : 0;
      // Let the fabric bridge individual chest contours rather than printing
      // every muscle or curve through the jacket.
      const drape = (rig === 'female' ? .143 : .118) - .021 * (x / .154) ** 2;
      p.setXYZ(i, x + originalNormals.getX(i) * allowance, y + originalNormals.getY(i) * allowance,
        z + originalNormals.getZ(i) * allowance + Math.max(0,drape - z) * chest * .84);
    }
    if (categories[i] === 2) {
      const tread = y < .019 ? .48 : y < .04 ? .71 : 1;
      rgb.set([tread, tread, tread], i * 3);
    }
  }
  for (const group of aliases.values()) if (group.length > 1) {
    const reference = group.find(i => categories[i] === 0) ?? group[0];
    for (const i of group) p.setXYZ(i, p.getX(reference), p.getY(reference), p.getZ(reference));
  }
  // The cut's cuff and trouser blend is cached in the geometry; colors stay
  // uniforms so it can be reused for every identity and team.
  const blends = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i) - height;
    const outer = Math.abs(x), arm = regions[i] === 'arm';
    const trousers = arm ? 0 : 1 - smoothstep(y, cut.hem - .026, cut.hem + .024);
    const cuff = arm ? smoothstep(outer, rig === 'female' ? .595 : .667, rig === 'female' ? .623 : .698) : 0;
    const rib = cut.ribbed && !arm ? smoothstep(y, cut.hem, cut.hem + .022) * (1 - smoothstep(y, cut.hem + .028, cut.hem + .047)) * .68 : 0;
    blends.set([Math.max(cuff,rib),trousers,Number(arm)], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  geometry.setAttribute('clothBlend', new THREE.BufferAttribute(blends, 3));
  clipSkin(geometry, categories, distances, source);
  for (const key of Object.keys(geometry.attributes)) if (!['position','normal','uv','skinIndex','skinWeight','color','clothBlend'].includes(key)) geometry.deleteAttribute(key);
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal');
  for (const group of aliases.values()) if (group.length > 1) {
    const n = point(0,0,0); for (const i of group) n.add(point(normal.getX(i), normal.getY(i), normal.getZ(i)));
    n.normalize();
    for (const i of group) normal.setXYZ(i, n.x, n.y, n.z);
  }
  return geometry;
}

function stitchSurface(body, rig) {
  const p = body.getAttribute('position'), j = body.getAttribute('skinIndex'), w = body.getAttribute('skinWeight');
  const index = body.index.array, cloth = body.groups[1], verts = [], slices = Array.from({ length: 42 }, () => []), triangles = [];
  for (let i = 0; i < p.count; i++) verts.push(positionOf(p, i));
  const bucket = y => Math.max(0, Math.min(slices.length - 1, Math.floor(y * 25)));
  for (let i = cloth.start; i < cloth.start + cloth.count; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2], tri = [a,b,c];
    triangles.push(tri);
    const min = Math.min(verts[a].y,verts[b].y,verts[c].y), max = Math.max(verts[a].y,verts[b].y,verts[c].y);
    for (let bin = bucket(min); bin <= bucket(max); bin++) slices[bin].push(tri);
  }
  const ray = new THREE.Ray(), hit = point(0,0,0), sample = point(0,0,0), bary = point(0,0,0), memo = new Map();
  const outside = .9;
  const height = rig === 'female' ? 0 : .038;
  return (x, y, side = 'front') => {
    const id = `${x.toFixed(5)}/${y.toFixed(5)}/${side}`;
    if (memo.has(id)) return memo.get(id);
    y += side === 'front' || side === 'back' ? height : 0;
    ray.set(point(x,y,side === 'back' ? -outside : outside), point(0,0,side === 'back' ? 1 : -1));
    let best = Infinity, triangle;
    for (const tri of slices[bucket(y)]) {
      if (!ray.intersectTriangle(verts[tri[0]], verts[tri[1]], verts[tri[2]], false, hit)) continue;
      const distance = hit.distanceToSquared(ray.origin);
      if (distance < best) { best = distance; sample.copy(hit); triangle = tri; }
    }
    // Filled details follow actual garment triangles, including weights at
    // the shoulder and hip transitions, not just the nearest rigid bone.
    if (triangle) THREE.Triangle.getBarycoord(sample, ...triangle.map(i => verts[i]), bary);
    else {
      const query = point(x,y,side === 'back' ? -.09 : .09);
      let nearest = triangles[0][0]; for (const tri of triangles) for (const i of tri) {
        const distance = query.distanceToSquared(verts[i]); if (distance < best) { best = distance; nearest = i; }
      }
      triangle = [nearest,nearest,nearest]; bary.set(1,0,0); sample.copy(verts[nearest]);
    }
    const entries = [];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 4; b++) {
      const bone = j.getComponent(triangle[a], b), weight = w.getComponent(triangle[a], b) * Math.max(0, bary.getComponent(a));
      entries.push([bone,weight]);
    }
    const [joints, influence] = weightBlend(entries);
    const result = { pos: sample.clone(), up: ray.direction.clone().negate(), joints, weights: influence };
    memo.set(id, result); return result;
  };
}

function detailMesh(body, rig, cut, skeleton) {
  const at = stitchSurface(body, rig);
  const height = rig === 'female' ? 0 : .038;
  const position = [], normal = [], joints = [], weights = [], indices = [], colors = [];
  const add = (sample, offset, key, shade) => {
    const index = position.length / 3;
    position.push(...sample.pos.clone().addScaledVector(sample.up, offset).toArray());
    normal.push(...sample.up.toArray()); joints.push(...sample.joints); weights.push(...sample.weights);
    colors.push(paletteNames.indexOf(key), shade);
    return index;
  };
  const quad = (a, b, c, d, side) => {
    if (side === 'front' || side === 'leg') indices.push(a,b,d,b,c,d);
    else indices.push(a,d,b,b,d,c);
  };
  function panel(cx, cy, width, height, color, lift, side = 'front', lean = 0, taper = .82) {
    const columns = 5, rows = 5, start = position.length / 3;
    for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
      const x = col / columns * 2 - 1, y = row / rows * 2 - 1;
      const edge = Math.abs(x) === 1 || Math.abs(y) === 1;
      const corner = Math.abs(x) === 1 && Math.abs(y) === 1;
      add(at(cx + x * width * .5 * (corner ? taper : 1) + lean * y, cy + y * height * .5, side), edge ? .0037 : lift, color, edge ? .73 : lerp(.93,1.04,row / rows));
      if (row < rows && col < columns) {
        const a = start + row * (columns + 1) + col;
        quad(a, a + 1, a + columns + 2, a + columns + 1, side);
      }
    }
  }
  function seam(knots, width, color, lift = .006, side = 'front', shade = 1) {
    const points = [];
    for (const [i, end] of knots.entries()) if (i) {
      const start = knots[i - 1], steps = Math.max(2, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) * 36));
      for (let n = i === 1 ? 0 : 1; n <= steps; n++) points.push([lerp(start[0],end[0],n / steps), lerp(start[1],end[1],n / steps)]);
    }
    let last;
    for (const [i, [x,y]] of points.entries()) {
      const a = points[Math.max(0,i - 1)], b = points[Math.min(points.length - 1,i + 1)];
      const scale = width * .5 / Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[1] - a[1]) * scale, dy = (a[0] - b[0]) * scale;
      const v = add(at(x + dx,y + dy,side),lift,color,shade);
      add(at(x - dx,y - dy,side),lift,color,shade);
      if (last !== undefined) quad(last,v,v + 1,last + 1,side);
      last = v;
    }
  }
  const h = cut.hem;
  for (const s of [-1,1]) {
    const placket = [[s * .019,h + .01], [s * .018,1.15], [s * cut.lapel * .58,1.395], [s * cut.lapel,1.49]];
    seam(placket,.024,'dark',.007);
    seam(placket.map(([x,y]) => [x + s * .009,y]),.009,'accent',.010,'front',.94);
    const pocketX = s * (rig === 'female' ? .087 : .101);
    if (cut.pockets) {
      const width = cut.pockets * (rig === 'female' ? .91 : 1);
      if (!cut.fullYoke) {
        panel(pocketX,1.32,width,.086,'panel',.010,'front',s * .004,cut.angular ? .90 : .76);
        panel(pocketX,1.352,width * 1.02,.023,cut.angular ? 'dark' : 'suit',.012,'front',0,.87);
      }
      seam([[pocketX - width * .33,1.348],[pocketX + width * .34,1.348]],.006,'accent',.015,'front',.82);
    }
    const pocket = [[s * .10,h + .075], [s * .12,h + .130], [s * (cut.diagonal ? .128 : .107),h + .198]];
    seam(pocket,.019,'dark',.007);
    seam(pocket.map(([x,y]) => [x + s * .003,y]),.006,'accent',.010,'front',.80);
    seam([[s*.018,h+.02],[s*.106,h+.018],[s*.144,h+.036]],.010,'panel',.007);
    seam([[s*.018,h-.028],[s*.095,h-.027],[s*.134,h-.013]],.028,'dark',.008);
    if (cut.snaps && s > 0) for (const y of [1.08,1.175,1.272,1.36]) panel(s * .034,y,.010,.011,'hardware',.011);

    const thigh = s * (rig === 'female' ? .134 : .128);
    panel(thigh,.716,.080,.155,'pants',.017,'leg',s*.004);
    panel(thigh,.772,.085,.041,'dark',.019,'leg',s*.002);
    seam([[thigh - .025,.770],[thigh + .026,.770]],.005,'hardware',.021,'leg',.5);
    seam([[thigh+s*.020,.651],[thigh+s*.024,.704],[thigh+s*.025,.737]],.004,'hardware',.017,'leg',.40);
    panel(s*.107,.487,.094,.071,'pants',.008,'leg',s*.006);
    seam([[s*.083,.522],[s*.111,.531],[s*.145,.516]],.008,'dark',.006,'leg',.89);
  }
  // Low soft stand collar: an open piece under the jaw, not headgear.
  const neck = at(0,1.51);
  const neckBones = neck.joints, neckWeights = neck.weights, collarStart = position.length / 3;
  const segments = 30;
  for (let row = 0; row <= 5; row++) for (let n = 0; n <= segments; n++) {
    const t = row / 5, angle = lerp(.77, 2 * Math.PI - .77,n / segments);
    const front = Math.cos(angle), back = (1 - front) / 2;
    const y = 1.437 + height + t * (cut.collar + .017 * back) + .010 * back;
    const radius = lerp(.097,.074,t);
    const x = Math.sin(angle) * radius, z = -.024 + front * lerp(.115,.094,t);
    const up = point(Math.sin(angle),.19,front).normalize();
    add({ pos: point(x,y,z), up, joints: neckBones, weights: neckWeights },.002,row === 5 ? 'accent' : row === 4 && cut.snaps ? 'panel' : 'suit',t > .8 ? 1 : .87);
    if (row < 5 && n < segments) {
      const a = collarStart + row * (segments + 1) + n;
      quad(a,a+1,a+segments+2,a+segments+1,'front');
    }
  }
  panel(0,h-.019,.043,.027,'hardware',.015);
  panel(0,h-.015,.024,.013,'dark',.016);
  // Rear seam follows the back when leaning and breaks up a plain silhouette.
  seam([[-.127,1.364],[-.060,1.382],[0,1.383],[.060,1.382],[.127,1.364]],.015,'panel',.006,'back');
  // Low, continuous leather boots with a shaped toe cap and rubber welt.
  // The whole sole follows the existing foot pose, never the gameplay bounds.
  const rings = [
    [-.003,.053,.138,-.011,'dark',.37],
    [.010,.059,.144,-.011,'dark',.47],
    [.024,.059,.143,-.012,'hardware',.37],
    [.033,.057,.142,-.013,'dark',.90],
    [.052,.055,.132,-.017,'dark',1.12],
    [.070,.052,.104,-.036,'dark',1.16],
    [.090,.047,.074,-.056,'dark',1.04],
    [.117,.045,.057,-.072,'dark',1.04],
    [.148,.042,.049,-.078,'dark',.89],
    [.157,.039,.044,-.078,'dark',.80],
  ];
  const segmentsBoot = 24, footWidth = rig === 'female' ? .119 : .124;
  for (const [side, sign] of [['l',1],['r',-1]]) {
    const foot = skeleton.bones.findIndex(bone => bone.name === `foot_${side}`);
    const bootJoints = [foot,0,0,0], bootWeights = [1,0,0,0], first = position.length / 3;
    for (let ring = 0; ring < rings.length; ring++) for (let n = 0; n <= segmentsBoot; n++) {
      const [y,rx,rz,z0,color,shade] = rings[ring], angle = n / segmentsBoot * 2 * Math.PI;
      const front = Math.cos(angle), x = Math.sin(angle), toe = y < .071 ? 1 + .065 * front : 1;
      const z = Math.sign(front) * Math.abs(front) ** .83;
      const up = point(x,ring > 3 && ring < 8 ? .58 : .10,z).normalize();
      const detail = front > .86 && ring > 4 && ring < 8 ? 1.09 : 1;
      add({ pos: point(sign * footWidth + x * rx * toe,y,z0 + z * rz), up, joints: bootJoints, weights: bootWeights },0,color,shade * detail);
      if (ring < rings.length - 1 && n < segmentsBoot) {
        const a = first + ring * (segmentsBoot + 1) + n;
        quad(a,a+1,a+segmentsBoot+2,a+segmentsBoot+1,'front');
      }
    }
    // Tiny lace rows, contoured to the instep.
    for (const [y,z] of [[.071,.061],[.081,.042],[.093,.018],[.104,.001]]) {
      const base = position.length / 3, up = point(0,.8,.6);
      for (const [x,dy] of [[-.018,0],[.018,.003],[.018,.007],[-.018,.004]]) {
        add({ pos: point(sign * footWidth+x,y+dy,z), up, joints: bootJoints, weights: bootWeights },.002,'hardware',.69);
      }
      quad(base,base+1,base+2,base+3,'front');
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(position,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(joints,4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  geometry.setAttribute('dye',new THREE.Float32BufferAttribute(colors,2));
  geometry.setIndex(indices);
  return geometry;
}

function garmentShaders(material, mode, palette, cut, rig) {
  // Distinct shader keys for body and stitched pieces; palette stays uniforms
  // so blues, reds and all shop colors share the same compiled programs.
  material.customProgramCacheKey = () => `field-garment/v1/${mode}`;
  material.onBeforeCompile = shader => {
    shader.uniforms.garmentPalette = { value: paletteNames.map(key => new THREE.Color(palette[key])) };
    if (mode === 'body') {
      shader.uniforms.garmentCut = { value: new THREE.Vector4(cut.hem,cut.lapel,cut.fullYoke ? 1 : 0,cut.doubleLine ? 1 : 0) };
      shader.uniforms.garmentHeight = { value: rig === 'female' ? 0 : .038 };
      shader.vertexShader = `attribute vec3 clothBlend; varying vec3 vClothBlend; varying vec3 vTailoring;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvClothBlend = clothBlend; vTailoring = position;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vec2 weave = vec2(position.x + position.z * 0.44, position.y - position.z * 0.27) * 9.0;
          #ifdef USE_MAP
            vMapUv = weave;
          #endif
          #ifdef USE_BUMPMAP
            vBumpMapUv = weave;
          #endif`);
      shader.fragmentShader = `uniform vec3 garmentPalette[6]; uniform vec4 garmentCut; uniform float garmentHeight;
        varying vec3 vClothBlend; varying vec3 vTailoring;\n${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
        float y = vTailoring.y - garmentHeight;
        float x = abs(vTailoring.x);
        float z = vTailoring.z;
        float lapel = mix(0.017, garmentCut.y, smoothstep(1.15, 1.49, y));
        float placket = (1.0 - smoothstep(lapel - 0.009, lapel + 0.002, x))
          * smoothstep(-0.01, 0.040, z) * smoothstep(garmentCut.x, garmentCut.x + 0.020, y);
        float shoulder = y - (1.414 - clamp(x - 0.114, 0.0, 0.22) * 0.30);
        float span = smoothstep(0.072, 0.094, x) * (1.0 - smoothstep(0.281, 0.315, x));
        float face = smoothstep(-0.092, -0.050, z);
        float piping = 1.0 - smoothstep(0.006, 0.011, abs(shoulder));
        float second = 1.0 - smoothstep(0.0035, 0.007, abs(shoulder + 0.028));
        float yoke = smoothstep(-0.005, 0.004, shoulder) * span;
        vec3 jacket = mix(diffuseColor.rgb, garmentPalette[1], yoke * mix(0.40, 1.0, garmentCut.z));
        jacket = mix(jacket, garmentPalette[4], face * span * max(piping, garmentCut.w * second) * mix(0.90,0.50,garmentCut.z));
        diffuseColor.rgb = mix(mix(jacket, garmentPalette[2], vClothBlend.y), garmentPalette[3], max(placket, vClothBlend.x));`);
    } else {
      shader.vertexShader = `attribute vec2 dye; uniform vec3 garmentPalette[6]; varying vec3 vStitchColor;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
        vStitchColor = garmentPalette[int(dye.x + 0.5)] * dye.y;`);
      shader.fragmentShader = `varying vec3 vStitchColor;\n${shader.fragmentShader}`.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vStitchColor;');
    }
  };
}

export function dressOperator(mesh, outfit, character, palette, team, models) {
  const rig = character.rig;
  const cut = cuts[palette.cut], fit = `${rig}/${palette.cut}/${Boolean(outfit.gloves)}`;
  const colors = team ? { ...palette, suit: team.suit, panel: team.armor, dark: team.dark, accent: team.visor, pants: team.dark, hardware: '#8e959a' }
    : { ...palette, hardware: '#a69a8f' };
  if (!dressed.has(fit)) {
    const body = buildBody(mesh, rig, outfit.gloves, cut);
    dressed.set(fit, body);
    tailoring.set(fit, detailMesh(body, rig, cut, mesh.skeleton));
  }
  const skin = mesh.material, map = operatorWeave(models);
  const fabric = new THREE.MeshStandardMaterial({ name: 'tailored-fabric', color: colors.suit, map, roughness: .93, bumpMap: map, bumpScale: .0006 });
  const leather = new THREE.MeshStandardMaterial({ name: 'boot-leather', color: colors.dark, vertexColors: true, roughness: .92 });
  garmentShaders(fabric, 'body', colors, cut, rig);
  const base = dressed.get(fit), shaped = operatorFace(base, character, mesh.name);
  mesh.geometry = models.sharedOperatorGeometry(`tailored-body/${fit}/${shaped === base ? 'base' : character.id}`, shaped);
  mesh.material = [skin,fabric,leather];
  const trim = new THREE.MeshStandardMaterial({ name: 'stitched-details', roughness: .91, side: THREE.DoubleSide });
  garmentShaders(trim, 'detail', colors);
  const details = new THREE.SkinnedMesh(models.sharedOperatorGeometry(`stitching/${fit}`, tailoring.get(fit)),trim);
  details.name = 'tailored-jacket-details'; details.position.copy(mesh.position); details.quaternion.copy(mesh.quaternion); details.scale.copy(mesh.scale);
  details.bindMode = mesh.bindMode;
  mesh.parent.add(details); details.bind(mesh.skeleton, mesh.bindMatrix);
  details.castShadow = details.receiveShadow = true;
  // A conservative sphere avoids re-evaluating the posed accessory bounds in
  // every frame while still culling the whole outfit far outside the view.
  details.boundingSphere = new THREE.Sphere(point(0,.89,0),1.27);
}
