// Solid annexes use the same box in collision and in the arena. These small
// roof trims and shutters are visual dressings, not alternative routes.
const palettes = {
  industrial: { wall: '#4f5755', trim: '#2a383d', panel: '#3a464b', signal: '#d99160' },
  rail: { wall: '#506169', trim: '#293b47', panel: '#3e4b58', signal: '#e3ad72' },
  harbor: { wall: '#637175', trim: '#394b52', panel: '#485961', signal: '#e3a371' },
  city: { wall: '#55576b', trim: '#313848', panel: '#3b4051', signal: '#afa8dd' },
  snow: { wall: '#aabcc2', trim: '#6d8794', panel: '#6b8295', signal: '#7cafba' },
  desert: { wall: '#a37d61', trim: '#775843', panel: '#8c6a55', signal: '#e0b286' },
};
const inward = { west: ['x', 1], east: ['x', -1], north: ['z', 1], south: ['z', -1] };

export function setbackMaterials(world, makeMaterial) {
  const colors = palettes[world.theme] || palettes.industrial;
  return Object.fromEntries(Object.entries(colors).map(([key, color]) => [
    key, makeMaterial(`annex-${key}`, color, key === 'signal' ? { emissive: color, emissiveIntensity: .24 } : { roughness: .94 }),
  ]));
}

export function drawSetback(place, group, box, materials, terrainStyle) {
  const { w, h, d, arenaFace } = box;
  const add = (size, at, material, shadow = true) => place(group, size, at, materials[material], shadow);
  group.name = box.id;
  add([w, h, d], [0, h / 2, 0], 'wall');
  add([w + .045, .14, d + .045], [0, h - .10, 0], 'trim');

  const faces = arenaFace ? [inward[arenaFace]] : Object.values(inward);
  for (const [axis, direction] of faces) {
    const span = axis === 'z' ? w : d, depth = axis === 'z' ? d : w;
    const band = (along, y, width, height, material, offset = .012) => {
      width = Math.min(width, span - .06);
      const normal = direction * (depth / 2 + offset);
      add(axis === 'z' ? [width, height, .025] : [.025, height, width],
        axis === 'z' ? [along, y, normal] : [normal, y, along], material, false);
    };
    if (terrainStyle === 'desert') {
      for (const [y, thickness] of [[.38, .12], [1.2, .17], [2.8, .22], [4.3, .17], [6.2, .29]]) band(0, y, span, thickness, y > 3 ? 'panel' : 'trim');
      continue;
    }
    band(0, .24, span, .16, 'trim');
    band(0, Math.min(h - .8, 2.91), span, .11, 'trim');
    const blocks = Math.max(1, Math.floor(span / 2.65)), panel = span / blocks;
    for (let i = 0; i < blocks; i++) {
      const center = -span / 2 + (i + .5) * panel;
      if (i) band(center - panel / 2, h * .49, .055, h - .75, 'trim');
      if (terrainStyle === 'rail' || terrainStyle === 'industrial') {
        band(center, 2.28, Math.min(1.26, panel - .28), .45, 'panel');
        band(center, 2.28, Math.min(.62, panel - .44), .05, 'signal', .028);
      } else {
        for (let floor = 3.7; floor < h - .6; floor += 2.5) {
          band(center, floor, Math.min(1.42, panel - .25), terrainStyle === 'city' ? .83 : .45, 'panel');
          if ((i + Math.floor(floor)) % 3 === 1) band(center, floor + .12, Math.min(.70, panel - .4), .055, 'signal', .028);
        }
      }
    }
  }
}
