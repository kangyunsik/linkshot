import * as THREE from '/vendor/three.module.js';
import { FirearmGeometry } from './firearm-geometry.js';

const templates = new Map();
const muzzleEnds = { rifle: -.82, smg: -.58, shotgun: -.97, sniper: -1.3, pistol: -.36, lmg: -1.09, dmr: -1.06 };

function makeTemplate(weapon, shape) {
  const g = new FirearmGeometry(), id = weapon.id;
  const famas = id === 'famas', ak = id === 'ak47', awp = id === 'awp', m82 = id === 'm82', p90 = id === 'p90', mp5 = id === 'mp5', ump = id === 'ump45';
  const aimHeight = famas ? .132 : shape === 'sniper' ? .195 : shape === 'shotgun' ? .11 : shape === 'pistol' ? id === 'deagle' ? .12 : .085 : shape === 'lmg' || shape === 'dmr' ? .16 : .14;
  const muzzleZ = m82 ? -1.52 : id === 'deagle' ? -.40 : muzzleEnds[shape];
  const rail = (length, z, y = .073) => {
    g.block('low-rail', [.057, .011, length], [0, y, z]);
    for (let i = 0; i < length / .04; i++) g.block('rail-tooth', [.061, .005, .014], [0, y + .008, z + length / 2 - i * .04], 'steel', 'frame', .0007);
  };
  const irons = (height, rear = .13, front = -.42) => {
    for (const side of [-1, 1]) g.block('rear-sight-ear', [famas ? .006 : .008, famas ? .014 : .024, .015], [side * .021, height + (famas ? -.004 : .001), rear], 'black');
    g.block('rear-sight-notch', [.05, .006, .016], [0, height - .016, rear]);
    g.block('front-sight-post', [.007, .025, .012], [0, height - .0125, front], 'steel');
    g.ring('front-sight-hood', .021, .003, [0, height - .012, front - .004]);
  };
  const optic = (height = aimHeight, z = .015) => {
    g.frame('open-reflex-sight', .077, .063, .018, [0, height, z]);
    g.block('optic-foot', [.048, .012, .075], [0, height - .042, z]);
  };
  const barrel = (from, radius = .021) => {
    const capLength = m82 ? .14 : shape === 'pistol' ? .027 : .055, capRadius = m82 ? .047 : shape === 'shotgun' ? .039 : radius * 1.42;
    const end = muzzleZ + capLength;
    g.tube('stepped-barrel', radius, from - end, [0, .02, (from + end) / 2], 'steel', 'frame', { front: radius * .94 });
    g.tube('hollow-muzzle', capRadius, capLength, [0, .02, muzzleZ + capLength / 2], 'black', 'frame', { front: capRadius * .96, bore: radius * .62 });
    g.tube('barrel-collar', radius * 1.18, .022, [0, .02, from - .025], 'black');
    if (m82) for (const side of [-1, 1]) for (let i = 0; i < 3; i++) g.block('muzzle-brake-port', [.002, .026, .017], [side * .046, .02, muzzleZ + .035 + i * .032], 'steel');
  };
  const receiver = (width = .11, rear = .16, front = -.24) => g.profile('contoured-receiver', [[front, -.05], [rear - .03, -.05], [rear, -.018], [rear, .037], [rear - .04, .061], [front + .04, .061], [front, .036]], width, 'coat', 'frame', { round: .007, holes: [[[-.055, .002], [.035, .002], [.035, .029], [-.055, .029]]] });
  const handguard = (front, rear, width = .092, slot = 'plate') => {
    const holes = [];
    for (let z = front + .06; z < rear - .035; z += .065) holes.push([[z - .019, .002], [z + .019, .002], [z + .019, .022], [z - .019, .022]]);
    g.profile('vented-handguard', [[front, -.032], [front + .035, -.047], [rear, -.047], [rear, .046], [front + .025, .046], [front, .025]], width, slot, 'frame', { bevel: .003, round: .007, holes });
  };
  const stock = (wood = false, rear = .35) => {
    const holes = wood ? [] : [[[.185, -.015], [rear - .05, -.015], [rear - .05, -.059], [.23, -.059]]];
    g.profile('sculpted-shoulder-stock', [[.10, .014], [.155, .042], [rear - .018, .037], [rear, .013], [rear, -.084], [rear - .055, -.092], [.17, -.041], [.10, -.041]], .087, wood ? 'wood' : 'rubber', 'frame', { bevel: .005, round: .013, holes });
    g.block('rubber-butt-pad', [.095, .13, .018], [0, -.022, rear + .009], 'rubber');
  };
  const magazine = (kind = 'rifle', z = -.10) => {
    g.groups.set('magazine', [0, 0, 0]);
    const profile = kind === 'ak' ? [[-.05, -.046], [.035, -.046], [.033, -.12], [.068, -.22], [.13, -.31], [.106, -.333], [.034, -.31], [-.012, -.22], [-.044, -.12]]
      : kind === 'pistol' ? [[-.032, -.16], [.028, -.16], [.024, -.39], [-.038, -.39]]
      : [[-.043, -.047], [.035, -.047], [.042, -.16], [.073, -.273], [.057, -.291], [-.02, -.282], [-.046, -.17]];
    g.profile('continuous-magazine', profile.map(([x, y]) => [x + z, y]), kind === 'pistol' ? .064 : .067, 'black', 'magazine', { bevel: .004, round: .006 });
    const bottom = kind === 'pistol' ? -.391 : kind === 'ak' ? -.328 : -.287, bottomZ = z + (kind === 'ak' ? .074 : kind === 'pistol' ? -.006 : .025);
    g.block('magazine-floorplate', [.076, .013, kind === 'pistol' ? .073 : .092], [0, bottom, bottomZ], 'rubber', 'magazine');
    if (kind !== 'pistol') for (const side of [-1, 1]) for (let i = 0; i < 2; i++) g.profile('magazine-pressed-rib', [[z - .025 + i * .03, -.075], [z - .017 + i * .03, -.075], [bottomZ + i * .015, bottom + .03], [bottomZ - .008 + i * .015, bottom + .03]], .002, 'steel', 'magazine', { bevel: .0004, position: [side * .034, 0, 0] });
  };
  const scope = () => {
    for (const z of [-.12, .105]) g.block('optic-clamp', [.064, .04, .033], [0, .107, z]);
    g.tube('scope-main-tube', .039, .31, [0, .195, -.04], 'black', 'frame', { bore: .031, through: true });
    g.tube('scope-objective', .063, .10, [0, .195, -.245], 'black', 'frame', { front: .061, bore: .050, through: true });
    g.tube('scope-eyepiece', .048, .075, [0, .195, .15], 'rubber', 'frame', { bore: .038, through: true });
    g.ring('eyepiece-rim', .043, .004, [0, .195, .19], 'steel');
    g.add('optic-glass', new THREE.CircleGeometry(.037, 20), 'glass', [0, .195, .183]);
    g.add('scope-turret', new THREE.CylinderGeometry(.021, .021, .035, 12), 'black', [0, .239, -.035]);
  };
  const bipod = (z) => {
    for (const side of [-1, 1]) {
      const geometry = new THREE.CylinderGeometry(.008, .010, .19, 8); geometry.rotateZ(side * .31);
      g.add('folding-bipod', geometry, 'black', [side * .064, -.12, z]);
      g.block('bipod-foot', [.035, .018, .028], [side * .094, -.211, z], 'rubber');
    }
  };

  if (shape === 'rifle') {
    if (famas) {
      g.profile('famas-bullpup-shell', [[-.53, -.023], [-.48, -.058], [.27, -.068], [.36, -.038], [.36, .035], [.29, .065], [-.43, .058], [-.53, .028]], .105, 'coat', 'frame', { bevel: .006, round: .012 });
      g.profile('famas-low-carry-handle', [[-.25, .069], [-.23, .112], [-.19, .128], [.135, .128], [.16, .11], [.17, .069]], .028, 'black', 'frame', { bevel: .002, holes: [[[-.17, .079], [-.155, .106], [.11, .106], [.13, .079]]] });
      g.block('famas-butt-pad', [.109, .116, .018], [0, -.018, .371], 'rubber');
      magazine('rifle', .22); irons(aimHeight, .13, -.39);
      for (const side of [-1, 1]) for (let i = 0; i < 4; i++) g.block('famas-cooling-slot', [.002, .013, .036], [side * .055, .012, -.44 + i * .055], 'black');
    } else {
      receiver(ak ? .104 : .112); handguard(-.54, -.25, ak ? .098 : .094, ak ? 'wood' : 'plate');
      stock(ak); magazine(ak ? 'ak' : 'rifle');
      if (ak) { g.tube('ak-gas-tube', .014, .30, [0, .072, -.37], 'black'); irons(aimHeight, .11, -.52); }
      else { rail(.45, -.17); optic(); g.tube('upper-receiver', .038, .26, [0, .023, -.03], 'plate'); }
      if (id === 'm4a1') { g.tube('buffer-tube', .027, .14, [0, .004, .19], 'black'); g.block('stock-adjustment-lever', [.042, .022, .105], [0, -.072, .255], 'plate'); }
    }
    barrel(-.52);
  } else if (shape === 'smg') {
    if (p90) {
      g.profile('p90-integrated-thumbhole-shell', [[-.35, -.018], [-.30, -.066], [.12, -.065], [.21, -.17], [.33, -.16], [.35, -.11], [.35, .038], [.22, .065], [-.27, .059]], .119, 'coat', 'frame', { bevel: .007, round: .022, holes: [[[.14, -.075], [.26, -.075], [.283, -.124], [.225, -.136]]] });
      g.section('p90-horizontal-magazine', [{ z: -.255, w: .099, h: .024, y: .092 }, { z: .15, w: .099, h: .024, y: .092 }], 'magazineGlass');
      for (let i = 0; i < 8; i++) g.add('p90-visible-round', new THREE.CylinderGeometry(.005, .006, .065, 8), 'brass', [0, .093, -.21 + i * .04], 'frame', [0, 0, Math.PI / 2]);
    } else {
      if (mp5) {
        g.tube('mp5-round-receiver', .047, .39, [0, .009, -.065], 'coat');
        g.profile('mp5-lower-trigger-housing', [[-.16, -.01], [.12, -.01], [.14, -.045], [.06, -.07], [-.14, -.059]], .071, 'rubber', 'frame', { round: .009 });
        for (const side of [-1, 1]) g.tube('mp5-stock-guide', .008, .22, [side * .035, -.009, .225], 'steel');
        g.block('mp5-slim-butt-pad', [.085, .115, .017], [0, -.028, .34], 'rubber'); irons(aimHeight, .10, -.40);
      } else receiver(ump ? .113 : .099, .14, -.20);
      handguard(-.36, -.20, .09, ump ? 'rubber' : 'plate'); magazine('rifle', -.023);
      if (ump) {
        g.profile('ump-folding-stock', [[.12, .017], [.30, .018], [.32, -.047], [.25, -.063], [.12, -.026]], .045, 'black', 'frame', { round: .005, holes: [[[.17, -.003], [.27, -.003], [.27, -.025], [.17, -.015]]] });
        g.block('ump-butt-pad', [.075, .11, .016], [0, -.025, .33], 'rubber');
      } else if (!mp5) stock(false, .32);
    }
    if (!mp5) { rail(.27, -.055); optic(); } barrel(-.33, .019);
  } else if (shape === 'shotgun') {
    receiver(.116, .15, -.19); stock(id === 'shotgun', .40);
    g.tube('shotgun-shell-tube', .027, .65, [0, -.058, -.48], 'black');
    g.groups.set('pump', [0, -.025, -.43]);
    g.tube('rounded-pump-grip', .056, .24, [0, 0, 0], 'rubber', 'pump');
    for (let i = 0; i < 7; i++) g.tube('pump-rib', .058, .007, [0, 0, -.105 + i * .033], 'black', 'pump');
    for (let i = 0; i < 4; i++) g.tube('spare-shell', .012, .085, [.065, -.012, .065 - i * .035], 'brass');
    if (id === 'spas12') {
      g.profile('spas-folded-stock', [[-.12, .093], [.34, .093], [.40, .066], [.40, .12], [.32, .129], [-.12, .117]], .032, 'black', 'frame', { bevel: .003, holes: [[[.02, .100], [.27, .100], [.27, .112], [.02, .112]]] });
      handguard(-.71, -.31, .076, 'black');
    }
    irons(aimHeight, .105, -.78); barrel(-.18, .032);
  } else if (shape === 'sniper') {
    const stockSlot = awp ? 'rubber' : 'coat';
    g.profile('sniper-contoured-chassis', [[-.69, -.023], [-.61, -.058], [.09, -.057], [.25, -.10], [.43, -.091], [.46, -.056], [.46, .033], [.38, .063], [.17, .067], [.08, .037], [-.59, .044], [-.69, .018]], awp ? .119 : .106, stockSlot, 'frame', { bevel: .006, round: awp ? .018 : .009, holes: [[[.18, -.026], [.33, -.026], [.34, -.062], [.25, -.069]]] });
    receiver(m82 ? .135 : .109, .15, m82 ? -.34 : -.25); magazine('rifle', -.10); rail(.43, -.10, .075); scope();
    g.block('adjustable-cheek-rest', [.083, .033, .17], [0, .068, .29], 'rubber');
    g.block('sniper-butt-pad', [.115, .142, .022], [0, -.02, .474], 'rubber');
    g.tube('bolt-housing', .021, .21, [0, .028, .015], 'steel');
    g.add('bolt-handle', new THREE.CylinderGeometry(.007, .007, .075, 8), 'steel', [.077, .011, .10], 'frame', [0, 0, -.8]);
    g.add('bolt-knob', new THREE.SphereGeometry(.014, 10, 8), 'black', [.103, -.014, .10]);
    if (m82) for (const side of [-1, 1]) for (let i = 0; i < 5; i++) g.block('m82-receiver-vent', [.002, .018, .042], [side * .071, .019, -.28 + i * .062], 'black');
    bipod(-.60); barrel(-.67, m82 ? .029 : .023);
  } else if (shape === 'pistol') {
    const deagle = id === 'deagle', glock = id === 'glock18c', width = deagle ? .102 : .081;
    g.groups.set('slide', [0, 0, 0]);
    g.profile('contoured-pistol-slide', [[deagle ? -.31 : -.27, .008], [.085, .008], [.11, .029], [.105, deagle ? .098 : .072], [-.18, deagle ? .098 : .072], [deagle ? -.31 : -.27, deagle ? .073 : .049]], width, deagle ? 'steel' : 'coat', 'slide', { bevel: .004, round: .006 });
    g.profile('polymer-pistol-frame', [[-.20, -.006], [.15, -.008], [.16, -.039], [.11, -.069], [-.15, -.063], [-.20, -.039]], .075, 'rubber', 'frame', { bevel: .004, round: .009 });
    for (const side of [-1, 1]) for (let i = 0; i < 5; i++) g.block('slide-serration', [.0018, .027, .004], [side * (width / 2 + .001), .045, .034 + i * .010], 'black', 'slide', .0003);
    for (const side of [-1, 1]) g.block('rear-pistol-sight', [.009, .013, .018], [side * .024, aimHeight + .004, .07], 'black', 'slide');
    g.block('front-pistol-sight', [.008, .012, .015], [0, aimHeight - .006, -.22], 'black', 'slide');
    g.block('pistol-sight-dot', [.004, .004, .002], [0, aimHeight, -.21], 'luminous', 'slide');
    if (glock) { magazine('pistol', .115); for (const z of [-.17, -.20]) g.block('glock-slide-port', [.043, .002, .017], [0, .074, z], 'black', 'slide'); }
    else g.block('pistol-magazine-floorplate', [.083, .019, .073], [0, -.215, .135], 'black');
    barrel(-.24, deagle ? .023 : .017);
  } else if (shape === 'lmg') {
    receiver(id === 'm249' ? .147 : .135, .17, -.28); stock(false, .42); handguard(-.66, -.30, .105, 'plate'); rail(.63, -.22, .086); optic();
    g.groups.set('magazine', [0, 0, 0]);
    g.profile('soft-sided-ammo-box', [[-.23, -.045], [.005, -.045], [.025, -.08], [.012, -.268], [-.025, -.29], [-.21, -.275], [-.24, -.225]], id === 'm249' ? .25 : .205, 'rubber', 'magazine', { bevel: .009, position: [-.095, 0, 0] });
    g.block('feed-tray-cover', [.19, .025, .28], [0, .075, -.07], 'plate');
    for (let i = 0; i < 6; i++) g.tube('linked-cartridge', .008, .077, [-.15 + i * .027, .01, -.11], 'brass');
    bipod(-.70); barrel(-.65, .027);
  } else if (shape === 'dmr') {
    receiver(.112, .17, -.25);
    if (id === 'm14') g.profile('m14-one-piece-wood-stock', [[-.66, -.022], [-.57, -.057], [-.02, -.057], [.10, -.12], [.125, -.20], [.185, -.205], [.225, -.145], [.30, -.10], [.43, -.085], [.45, -.05], [.43, .034], [.29, .05], [.16, .023], [-.58, .03]], .103, 'wood', 'frame', { bevel: .005, round: .013 });
    else { handguard(-.65, -.26, .093, 'plate'); stock(false, .43); }
    magazine('rifle', -.08); rail(.40, -.10, .077);
    g.frame('compact-marksman-optic', .079, .072, .04, [0, aimHeight, -.015]);
    g.block('marksman-optic-foot', [.05, .032, .052], [0, .105, -.015]); barrel(-.64, .022);
  }

  // Shared grip/trigger landmarks retain the already approved hand placement.
  if (id !== 'm14') g.profile('ergonomic-pistol-grip', [[.082, -.057], [.159, -.062], [.186, -.207], [.163, -.224], [.10, -.211], [.077, -.09]], .069, 'rubber', 'frame', { bevel: .006, round: .008 });
  g.profile('open-trigger-guard', [[.005, -.062], [.095, -.062], [.109, -.12], [.085, -.139], [.014, -.134], [.001, -.11]], .055, 'black', 'frame', { bevel: .002, holes: [[[.018, -.075], [.079, -.075], [.09, -.116], [.075, -.124], [.022, -.119]]] });
  g.block('trigger', [.01, .032, .01], [0, -.088, .049], 'steel');
  for (const side of [-1, 1]) {
    g.add('receiver-fastener', new THREE.CylinderGeometry(.0035, .0035, .002, 6), 'steel', [side * (shape === 'pistol' ? .039 : .058), -.008, .035], 'frame', [0, 0, Math.PI / 2]);
    g.block('selector-mark', [.002, .008, .022], [side * (shape === 'pistol' ? .039 : .058), -.025, .095], 'accent');
  }
  return { ...g.finish(), aimHeight, muzzleZ, shape, id };
}

export function createFirearmBody(models, group, weapon, shape, materials) {
  if (!templates.has(weapon.id)) templates.set(weapon.id, makeTemplate(weapon, shape));
  const template = templates.get(weapon.id), body = new THREE.Group(); body.name = 'firearm-body'; group.add(body);
  const parents = new Map();
  for (const [name, position] of template.groups) { const parent = new THREE.Group(); parent.name = `firearm-${name}`; parent.position.set(...position); body.add(parent); parents.set(name, parent); }
  for (const part of template.parts) {
    const geometry = models.sharedOperatorGeometry(`firearm-v2/${weapon.id}/${part.parent}/${part.slot}`, part.geometry);
    const mesh = new THREE.Mesh(geometry, materials[part.slot]); mesh.name = `${part.parent}-${part.slot}`; parents.get(part.parent).add(mesh);
  }
  const reticle = new THREE.Mesh(new THREE.CircleGeometry(.00115, 8), materials.luminous); reticle.name = 'sight-reference'; reticle.position.set(0, template.aimHeight, .025); body.add(reticle);
  Object.assign(group.userData, { magazine: parents.get('magazine'), magazineExtras: [], pump: parents.get('pump'), slide: parents.get('slide'), reticle, design: 'sculpted-firearms-v2' });
  body.userData.features = template.features;
  return { body, muzzleZ: template.muzzleZ, aimHeight: template.aimHeight };
}
