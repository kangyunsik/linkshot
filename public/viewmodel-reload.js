import * as THREE from '/vendor/three.module.js';
import { beat, easeBetween, reloadKind, visualInsert } from './reload-time.js';

const { lerp } = THREE.MathUtils;
const brass = { color: '#d3a663', roughness: .49, metalness: .44, fog: false };
const prototypes = new Map();

// Small stylized props, sized for the game's existing illustrative models.
function roundProp(models, shell, colors) {
  const key = shell ? 'shell' : 'cartridge';
  if (!prototypes.has(key)) {
    const profiles = shell
      ? [[[0,-.038],[.012,-.038],[.014,-.035],[.014,-.019],[.012,-.016]], [[.013,-.020],[.012,.031],[.010,.036],[.007,.038],[0,.038]]]
      : [[[0,-.031],[.007,-.031],[.008,-.028],[.008,.009],[.005,.018]], [[.005,.016],[.004,.027],[.001,.039],[0,.040]]];
    prototypes.set(key, profiles.map(section => new THREE.LatheGeometry(section.map(([x,y]) => new THREE.Vector2(x,y)), 12).rotateX(-Math.PI / 2)));
  }
  const prop = new THREE.Group(); prop.name = shell ? 'reload-shell' : 'visible-feed-round';
  prototypes.get(key).forEach((source, i) => prop.add(new THREE.Mesh(models.sharedOperatorGeometry(`reload-prop/${key}/${i}`, source), colors[i])));
  prop.visible = false; return prop;
}

export function createViewmodelReload(models, model, weapon) {
  const kind = reloadKind(weapon);
  if (!kind) return;
  const { magazine, breakAction, pump, slide, bolt, feedCover, belt, magazineStack, supportArm } = model.userData;
  const hand = supportArm.getObjectByName('left-hand'), palm = hand.getObjectByName('palm');
  const extras = new THREE.Group(); extras.name = 'reload-props'; extras.visible = false;
  model.add(extras);
  const rig = { kind, model, extras, magazine, magazineStack, breakAction, pump, slide, bolt, feedCover, belt, arm: supportArm, hand, palm,
    handPosition: supportArm.position.clone(), handRotation: supportArm.quaternion.clone(), pulse: new THREE.Quaternion(),
    scratch: new THREE.Vector3(), anchor: new THREE.Vector3(), pivot: new THREE.Vector3(),
    rest: [magazine, pump, slide, bolt, feedCover, belt, breakAction].filter(Boolean).map(part => [part,part.position.clone(),part.quaternion.clone()]),
  };
  const rounds = [new THREE.MeshStandardMaterial(brass), new THREE.MeshStandardMaterial({ color: kind === 'shell' || kind === 'break' ? '#b84236' : '#af6947',
    roughness: .61, metalness: kind === 'shell' || kind === 'break' ? .03 : .44, fog: false })];
  if (kind === 'shell' || kind === 'break') {
    rig.rounds = Array.from({ length: kind === 'break' ? 2 : 1 }, () => roundProp(models,true,rounds));
    // Keep reload-only props in one isolated tree. Break-action poses use the
    // same moving parent to project the shell path into this tree.
    extras.add(...rig.rounds);
  } else if (magazine) {
    rig.fresh = magazine.clone(true); rig.fresh.name = 'reload-fresh-magazine'; extras.add(rig.fresh);
    rig.magazineRotation = magazine.rotation.z;
    const bounds = new THREE.Box3().setFromObject(magazine);
    rig.well = new THREE.Vector3((bounds.min.x + bounds.max.x) * .5, bounds.max.y, (bounds.min.z + bounds.max.z) * .5);
    rig.grabY = lerp(bounds.min.y,bounds.max.y,.39);
    // The translucent top feed and linked belt already contain their own
    // visible cartridges; don't draw duplicate rounds on those magazines.
    if (kind === 'magazine') {
      const round = roundProp(models,false,rounds);
      round.position.set(rig.well.x,rig.well.y + .009,rig.well.z - .004);
      round.scale.setScalar(weapon.type === 'SIDEARM' ? .72 : .88);
      round.visible = true; rig.fresh.add(round);
    } else rounds.forEach(material => material.dispose());
  }
  model.userData.reload = rig;
}

const axisZ = new THREE.Vector3(0,0,1);
function steer(rig, parent, x,y,z, weight, wristTurn = -.30) {
  if (weight <= 0) return;
  const { arm, hand, scratch, anchor, pivot } = rig;
  scratch.set(x,y,z);
  parent.localToWorld(scratch); arm.parent.worldToLocal(scratch);
  anchor.copy(hand.position).applyQuaternion(rig.handRotation).add(rig.handPosition).lerp(scratch,weight);
  arm.quaternion.copy(rig.handRotation).multiply(rig.pulse.setFromAxisAngle(axisZ,wristTurn * weight));
  arm.position.copy(anchor).sub(pivot.copy(hand.position).applyQuaternion(arm.quaternion));
}

function playMagazine(r, weapon, t, ammo) {
  const { magazine, fresh, model, kind, well } = r, top = kind === 'top', pistol = weapon.type === 'SIDEARM';
  const reach = easeBetween(t,.075,.21), out = easeBetween(t,.21,.43);
  const load = easeBetween(t,.43,.68), seat = easeBetween(t,.52,.708);
  const carried = t < .43 ? magazine : fresh;
  const pocket = top ? .19 : pistol ? -.255 : -.289, turn = top ? .38 : -.30;
  magazine.visible = t < .43 || t >= .708;
  if (r.magazineStack) r.magazineStack.visible = ammo > 0 || t >= .708;
  magazine.position.set(t < .43 ? -.299 * out : 0, t < .43 ? pocket * out : 0, t < .43 ? .021 * out : 0);
  magazine.rotation.set(0, (t < .43 ? .15 * out : 0), r.magazineRotation + (t < .43 ? turn * out : 0));
  fresh.visible = t >= .43 && t < .708;
  fresh.position.set(lerp(-.299,0,load), pocket * (1 - seat), .021 * (1 - load));
  fresh.rotation.set(0,.15 * (1 - load),r.magazineRotation + turn * (1 - load));
  const hold = reach * (1 - easeBetween(t,.77,.953));
  if (t < .72) steer(r, carried, well.x - .07, top ? well.y - .04 : r.grabY - .012, well.z + .032, hold);
  else if (r.slide && ammo === 0) {
    const slide = beat(t,.74,.815,.845,.90); r.slide.position.z = slide * .089;
    steer(r, r.slide, -.081,.025,.104, beat(t,.705,.775,.86,.99), -.53);
  } else if (r.bolt && (weapon.action === 'BOLT' || ammo === 0)) {
    const travel = beat(t,.77,.83,.866,.945);
    r.bolt.position.z = .10 + (weapon.action === 'BOLT' ? .106 : .075) * travel;
    r.bolt.rotation.z = (weapon.action === 'BOLT' ? .67 : .14) * beat(t,.738,.78,.94,.981);
    steer(r, r.bolt, .086,.048,.048, beat(t,.72,.79,.90,.992), .32);
  } else {
    steer(r, model, well.x - .066, r.grabY - .018, well.z + .03, hold);
  }
}

function playShell(r, weapon, t, ammo) {
  const shell = r.rounds[0], count = Math.max(1,Math.min(weapon.magazine,weapon.magazine - ammo));
  const insertion = visualInsert(t,.17,.805,count), reach = beat(t,.055,.20,.78,.933);
  shell.visible = !!insertion && insertion.fraction < .77;
  const pump = beat(t,.822,.907,.923,.982);
  r.pump.position.z = -.43 + .10 * pump;
  if (insertion) {
    const stage = beat(insertion.fraction,.04,.72,.76,1), arc = Math.sin(stage * Math.PI);
    shell.position.set(lerp(-.236,-.004,stage), lerp(-.158,-.063,stage) - .026 * arc, lerp(.047,-.123,stage));
    shell.rotation.set(.08 * (1 - stage),-.88 * (1 - stage),.16 * (1 - stage));
    steer(r, shell, -.045,-.048,.043,reach);
  } else if (t < .81) {
    steer(r,r.model,-.263,-.177,.096,reach);
  } else {
    r.arm.position.z += .10 * pump;
  }
}

const chambers = [.020,-.033];
function playBreak(r, weapon, t, ammo) {
  const { breakAction, model } = r;
  const open = beat(t,.07,.25,.78,.92);
  breakAction.rotation.x = -.86 * open;
  const count = Math.max(1,Math.min(2,weapon.magazine - ammo));
  const insertion = visualInsert(t,.34,.746,count);
  const reach = beat(t,.175,.33,.72,.889);
  for (const [i,shell] of r.rounds.entries()) {
    const round = i < count, ejection = easeBetween(t,.196 + i * .019,.328 + i * .019);
    const loaded = !round || insertion && insertion.index > i || t >= .746;
    const inserting = round && insertion?.index === i, stage = inserting ? easeBetween(insertion.fraction,.08,.93) : 0;
    const wait = inserting ? 1 - stage : 0;
    const x = inserting ? lerp(-.149,0,stage) : loaded ? 0 : (i ? .14 : -.13) * ejection;
    const y = chambers[i] + (inserting ? -.052 * wait : loaded ? 0 : Math.sin(ejection * Math.PI) * .064);
    const z = inserting ? lerp(.236,-.081,stage) : loaded ? -.081 : lerp(-.081,.23,ejection);
    r.scratch.set(x,y,z); breakAction.localToWorld(r.scratch); shell.position.copy(model.worldToLocal(r.scratch));
    shell.rotation.set(breakAction.rotation.x - .19 * wait, inserting ? -.59 * wait : loaded ? 0 : 1.8 * ejection, 0);
    shell.visible = open > .18 && (loaded || inserting || round && ejection < .997);
    if (inserting) steer(r, shell, -.058,-.034,.028,reach);
  }
  if (!insertion) steer(r, breakAction,-.19,-.088,.139,reach);
}

function playBelt(r, t) {
  const open = beat(t,.09,.21,.83,.948), out = easeBetween(t,.24,.44), seat = easeBetween(t,.50,.71);
  const cover = r.feedCover, belt = r.belt, box = r.magazine;
  cover.rotation.x = -1.18 * open;
  box.visible = t < .45 || t >= .715; box.position.set(t < .45 ? -.15 * out : 0,t < .45 ? -.18 * out : 0,0);
  r.fresh.visible = t >= .432 && t < .715;
  r.fresh.position.set(-.20 * (1 - seat),-.17 * (1 - seat),0);
  r.fresh.rotation.z = -.22 * (1 - seat);
  belt.visible = t < .34 || t > .537;
  const slide = easeBetween(t,.55,.78);
  const lifted = open * (1 - easeBetween(t,.79,.89));
  belt.position.set(t > .537 ? -.115 * (1 - slide) : -.10 * out,lifted * (t > .537 ? .10 + .05 * (1 - slide) : .08),-.025 * lifted);
  belt.rotation.z = .16 * lifted * (1 - slide);
  if (t < .24 || t > .81) steer(r,cover,-.11,.008,.192,beat(t,.045,.15,.81,.973),-.16);
  else if (t > .60) steer(r,belt,-.104,.084,-.062,beat(t,.55,.64,.77,.85));
  else steer(r,t < .444 ? box : r.fresh,-.211,-.153,-.086,beat(t,.17,.30,.64,.80));
}

export function applyViewmodelReload(model, weapon, t, ammo) {
  const r = model?.userData.reload;
  if (!r || t == null && !r.active) return;
  for (const [part, position, rotation] of r.rest) { part.visible = true; part.position.copy(position); part.quaternion.copy(rotation); }
  if (r.magazineStack) r.magazineStack.visible = true;
  r.arm.position.copy(r.handPosition); r.arm.quaternion.copy(r.handRotation);
  const grip = t == null ? 'rest' : (r.kind === 'shell' || r.kind === 'break' || r.kind === 'belt' && t > .56) ? 'pinch' : 'wrap';
  const closeFingers = t != null && t > .16 && t < .84;
  r.palm.geometry = r.palm.userData.reloadGrip[closeFingers ? grip : 'rest'];
  r.extras.visible = t != null; r.active = t != null;
  if (t == null) return;
  ammo = Number.isFinite(ammo) ? ammo : 0;
  if (r.kind === 'shell') playShell(r,weapon,t,ammo);
  else if (r.kind === 'break') playBreak(r,weapon,t,ammo);
  else if (r.kind === 'belt') playBelt(r,t);
  else playMagazine(r,weapon,t,ammo);
}
