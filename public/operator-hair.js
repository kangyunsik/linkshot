import * as THREE from '/vendor/three.module.js';
import { mergeGeometries } from '/vendor/addons/utils/BufferGeometryUtils.js';

// Hair is modeled in the shared rigs' rest space (+Z forward). Each style
// combines a fitted scalp, curved tapered locks and, for Rhea, a tied tail.
// Bake the pieces into one shaded mesh per identity, not one draw per lock.
const female = { center: [0, 1.657, -.015], radius: [.086, .124, .112] };
const male = { center: [0, 1.704, -.009], radius: [.090, .116, .111] };
const styles = {
  nari: {
    head: female, front: 1.13, back: 2.53, side: 2.30, sweep: .25,
    locks: [
      [[[-.037,1.766,.044], [-.004,1.774,.074], [.041,1.746,.092], [.073,1.686,.086], [.084,1.618,.063], [.069,1.586,.041]], .022,.010,1.09],
      [[[-.043,1.763,.030], [.007,1.773,.051], [.066,1.741,.070], [.087,1.663,.056], [.084,1.605,.040], [.064,1.575,.025]], .022,.009,.90],
      [[[-.038,1.774,.008], [.036,1.771,.028], [.077,1.732,.036], [.091,1.653,.033], [.076,1.592,.023], [.062,1.575,.006]], .022,.009,.98],
      [[[-.016,1.778,-.017], [.060,1.749,-.015], [.090,1.687,-.012], [.086,1.617,-.013], [.067,1.577,-.026]], .021,.008,.96],
      [[[-.039,1.767,.048], [-.066,1.737,.065], [-.077,1.694,.050], [-.082,1.628,.024], [-.068,1.592,.003]], .020,.008,1.07],
      [[[-.051,1.759,.025], [-.076,1.716,.035], [-.086,1.663,.022], [-.078,1.608,-.008], [-.060,1.590,-.023]], .022,.009,.90],
      [[[-.064,1.723,-.005], [-.091,1.669,-.014], [-.076,1.611,-.040], [-.069,1.583,-.061]], .020,.006,.84],
      [[[-.022,1.770,-.072], [.034,1.729,-.106], [.052,1.649,-.113], [.048,1.596,-.103], [.035,1.570,-.073]], .028,.008,.82],
    ],
  },
  rhea: {
    head: female, front: 1.01, back: 2.16, side: 1.52, sweep: -.065,
    locks: [
      [[[-.003,1.734,.081], [-.036,1.748,.077], [-.062,1.747,.031], [-.066,1.745,-.036], [-.024,1.737,-.119]], .022,.010,1.07],
      [[[-.006,1.734,.086], [.022,1.753,.069], [.057,1.752,.027], [.066,1.737,-.040], [.020,1.737,-.118]], .022,.010,1.11],
      [[[-.019,1.756,.034], [-.029,1.776,-.016], [-.040,1.765,-.076], [-.015,1.740,-.125]], .018,.007,.90],
      [[[.000,1.751,.038], [.024,1.772,-.005], [.044,1.755,-.067], [.022,1.738,-.127]], .020,.007,1.01],
      [[[.039,1.748,.063], [.065,1.704,.074], [.075,1.673,.076], [.067,1.641,.085], [.072,1.620,.074], [.064,1.586,.070]], .008,.004,1.04],
      [[[-.046,1.741,.067], [-.069,1.703,.080], [-.071,1.669,.084], [-.058,1.646,.094], [-.071,1.615,.066]], .008,.005,.89],
      [[[.006,1.741,-.098], [.020,1.738,-.132], [.037,1.693,-.162], [.053,1.617,-.155], [.075,1.546,-.120], [.061,1.489,-.106], [.081,1.460,-.095]], .035,.026,.91],
      [[[.009,1.742,-.113], [.047,1.714,-.150], [.062,1.660,-.162], [.067,1.600,-.151], [.093,1.539,-.119], [.068,1.482,-.095]], .018,.013,1.13],
      [[[.001,1.738,-.113], [.013,1.697,-.153], [.027,1.650,-.169], [.033,1.600,-.154], [.060,1.551,-.132], [.071,1.498,-.116]], .019,.009,.81],
      // A narrow dark binder at the gathered root.
      [[[.007,1.740,-.114], [.018,1.735,-.135], [.027,1.719,-.142]], .025,.023,.58],
    ],
  },
  jin: {
    head: male, front: 1.095, back: 2.04, side: 1.63, sweep: -.13,
    locks: [
      [[[.048,1.758,.077], [.020,1.797,.077], [-.025,1.816,.056], [-.063,1.799,.024], [-.083,1.773,-.008], [-.079,1.750,-.043]], .023,.010,1.10],
      [[[.039,1.762,.077], [.004,1.786,.080], [-.052,1.791,.084], [-.076,1.769,.069], [-.090,1.731,.047]], .022,.007,1.02],
      [[[.033,1.782,.038], [.001,1.819,.018], [-.043,1.816,-.012], [-.070,1.789,-.042], [-.077,1.762,-.067]], .021,.009,1.05],
      [[[.026,1.802,.009], [-.002,1.823,-.022], [-.032,1.812,-.058], [-.066,1.783,-.079], [-.070,1.755,-.086]], .024,.007,.89],
      [[[.046,1.771,.033], [.064,1.772,.058], [.077,1.751,.061], [.086,1.719,.044], [.076,1.704,.056]], .018,.007,.98],
      [[[.046,1.786,.015], [.071,1.765,-.002], [.087,1.727,.012], [.078,1.696,.027]], .017,.007,.87],
      [[[.044,1.789,-.018], [.064,1.779,-.039], [.080,1.746,-.071], [.064,1.722,-.093]], .018,.007,.95],
    ],
  },
};
const prepared = new Map();
const { lerp, smoothstep } = THREE.MathUtils;

function surface(rows, columns, point, reverse = false) {
  const vertices = [], colors = [], indices = [];
  for (let i = 0; i <= rows; i++) for (let j = 0; j < columns; j++) {
    const [x, y, z, shade] = point(i / rows, j / columns * Math.PI * 2);
    vertices.push(x, y, z); colors.push(shade, shade, shade);
    if (i === rows) continue;
    const a = i * columns + j, b = i * columns + (j + 1) % columns;
    if (reverse) indices.push(a, a + columns, b, b, a + columns, b + columns);
    else indices.push(a, b, a + columns, b, b + columns, a + columns);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

const envelopes = new WeakMap();
function headEnvelope(geometry, origin) {
  // Conform the root of the hairstyle to the actual licensed head, including
  // temples and forehead. An ellipsoid alone intersects those features.
  if (!envelopes.has(geometry)) {
    const triangles = [], position = geometry.getAttribute('position'), index = geometry.index.array;
    const vertices = Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i));
    for (let i = 0; i < index.length; i += 3) {
      const a = vertices[index[i]], b = vertices[index[i + 1]], c = vertices[index[i + 2]];
      if (Math.max(a.y, b.y, c.y) >= origin.y - .15 && Math.max(Math.abs(a.x), Math.abs(b.x), Math.abs(c.x)) < .18) triangles.push([a, b, c]);
    }
    envelopes.set(geometry, triangles);
  }
  const triangles = envelopes.get(geometry), ray = new THREE.Ray(origin), hit = new THREE.Vector3();
  return direction => {
    ray.direction.copy(direction).normalize();
    let distance = 0;
    for (const [a, b, c] of triangles) if (ray.intersectTriangle(a, b, c, false, hit)) distance = Math.max(distance, hit.distanceTo(origin));
    return distance;
  };
}

function scalp({ head, front, back, side, sweep }, body) {
  const [cx, cy, cz] = head.center, [rx, ry, rz] = head.radius;
  const origin = new THREE.Vector3(cx, cy, cz), envelope = headEnvelope(body, origin);
  const offset = new THREE.Vector3();
  return surface(24, 72, (t, azimuth) => {
    const face = Math.cos(azimuth), across = Math.sin(azimuth);
    const edge = lerp(side, face > 0 ? front : back, Math.abs(face) ** (face > 0 ? 3 : 1.3)) + sweep * across * Math.max(0, face)
      + .03 * Math.sin(azimuth * 5) + .018 * Math.cos(azimuth * 11);
    const angle = .007 + t * (edge - .007), ring = Math.sin(angle);
    const grain = azimuth * 14 + t * 3.6 + .48 * Math.cos(azimuth * 7);
    const ridge = 1 + .013 * Math.cos(grain);
    const taper = lerp(1, .88, smoothstep(angle, 1.82, 2.62));
    const width = rx * (1 + .06 * Math.abs(across));
    offset.set(across * width * ring * ridge * taper, ry * Math.cos(angle), face * rz * ring * ridge);
    const length = offset.length(), distance = Math.max(length, envelope(offset) + .006);
    offset.multiplyScalar(distance / length);
    return [cx + offset.x, cy + offset.y, cz + offset.z, .69 + .17 * Math.sin(angle) + .12 * Math.cos(grain) ** 2];
  }, true);
}

function lock([points, width, depth, shade]) {
  const path = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  const rows = 21, frames = path.computeFrenetFrames(rows, false), start = path.getTangentAt(0);
  const radial = new THREE.Vector3(0, 0, 1).addScaledVector(start, -start.z).normalize();
  const twist = Math.atan2(radial.dot(frames.binormals[0]), radial.dot(frames.normals[0]));
  const centers = Array.from({ length: rows + 1 }, (_, i) => path.getPointAt(i / rows));
  return surface(rows, 18, (t, angle) => {
    const i = Math.round(t * rows), center = centers[i].clone();
    const thickness = Math.max(.006, Math.sin(Math.PI * t) ** .71 * (1.25 - .45 * t));
    const c = Math.cos(twist), s = Math.sin(twist), grain = Math.cos(angle * 5 + t * 1.7 + shade * 5);
    const a = Math.cos(angle) * depth * thickness * (1 + .065 * grain);
    const b = Math.sin(angle) * width * thickness;
    center.addScaledVector(frames.normals[i], a * c - b * s).addScaledVector(frames.binormals[i], a * s + b * c);
    const streak = .82 + .16 * Math.cos(angle) ** 2 + .07 * grain;
    return [...center.toArray(), shade * streak * (.98 + .08 * Math.sin(Math.PI * t))];
  });
}

export function createDraftHair(character, body, models) {
  const style = styles[character.id];
  if (!style) return null;
  if (!prepared.has(character.id)) {
    const pieces = [scalp(style, body), ...style.locks.map(lock)];
    const geometry = mergeGeometries(pieces);
    pieces.forEach(piece => piece.dispose());
    prepared.set(character.id, geometry);
  }
  const geometry = models.sharedOperatorGeometry(`draft-hair/${character.id}`, prepared.get(character.id));
  const material = new THREE.MeshStandardMaterial({ color: character.hairColor, vertexColors: true, roughness: .78, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}
