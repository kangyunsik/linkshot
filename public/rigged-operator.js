import * as THREE from '/vendor/three.module.js';
import { GLTFLoader } from '/vendor/addons/loaders/GLTFLoader.js';
import { clone } from '/vendor/addons/utils/SkeletonUtils.js';
import { getSkin } from '/shared/catalog.js';
import { getOutfit, getCharacter, OPERATOR_RIGS, operatorPalette } from '/shared/outfits.js';
import { NETWORK_PROTOCOL } from '/shared/world.js';
import { TEAM_UNIFORMS } from '/shared/teams.js';
import { createDraftHair } from './operator-hair.js';
import { dressOperator, WEAVE } from './operator-clothing.js';
import { operatorFace } from './operator-face.js';

const loader = new GLTFLoader();
const assets = new Map(await Promise.all(Object.entries(OPERATOR_RIGS).map(async ([id, rig]) => {
  const [body, hair] = await Promise.all([rig.model, rig.hair].map(file => loader.loadAsync(`/assets/models/${file}?v=${NETWORK_PROTOCOL}`)));
  // Use the existing rig envelope for all its identities. New hairstyles
  // must not move the eyes, hand sockets, feet or vertical pose reference.
  const box = new THREE.Box3().setFromObject(body.scene).union(new THREE.Box3().setFromObject(hair.scene));
  return [id, { body, hair, bottom: box.min.y, scale: 1.8 / (box.max.y - box.min.y) }];
})));
function localMaterial(material, models, character) {
  const copy = material.clone();
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (copy[key]) {
    const id = `operator-${copy[key].uuid}`;
    if (!models.textures.has(id)) models.textures.set(id, copy[key].clone());
    copy[key] = models.textures.get(id);
  }
  copy.vertexColors = false;
  if (/superhero/i.test(copy.name)) {
    copy.color.set(character.skinTint); copy.normalScale.setScalar(.24); copy.roughness = .79;
    copy.emissive.set('#63463d'); copy.emissiveIntensity = .022;
  } else if (/eyes/i.test(copy.name)) { copy.normalScale.setScalar(.12); copy.roughness = .40; }
  return copy;
}

function poseScratch() {
  const scratch = {};
  for (const key of ['position', 'scale', 'up', 'axis', 'translation', 'foot', 'pole', 'target', 'a', 'b', 'c', 'direction', 'bend', 'elbow', 'origin', 'from', 'to']) scratch[key] = new THREE.Vector3();
  for (const key of ['groupRotation', 'world', 'parent', 'rotation', 'floorRotation']) scratch[key] = new THREE.Quaternion();
  scratch.inverse = new THREE.Matrix4(); scratch.groupInverse = new THREE.Matrix4();
  return scratch;
}

// The pose solver keeps matrices current as each bone changes. Reading those
// matrices directly avoids repeatedly updating the entire ancestor chain for
// getWorldPosition/getWorldQuaternion, and scratch storage eliminates IK garbage.
function turnWorld(bone, rotation, scratch) {
  bone.matrixWorld.decompose(scratch.position, scratch.world, scratch.scale); scratch.world.premultiply(rotation);
  bone.parent.matrixWorld.decompose(scratch.position, scratch.parent, scratch.scale);
  bone.quaternion.copy(scratch.parent.invert().multiply(scratch.world));
  bone.updateWorldMatrix(false, true);
}
function translateWorld(bone, delta, scratch) {
  scratch.translation.setFromMatrixPosition(bone.matrixWorld).add(delta);
  bone.position.copy(scratch.translation.applyMatrix4(scratch.inverse.copy(bone.parent.matrixWorld).invert()));
  bone.updateWorldMatrix(false, true);
}
function setWorldRotation(bone, world, scratch) {
  bone.parent.matrixWorld.decompose(scratch.position, scratch.parent, scratch.scale);
  bone.quaternion.copy(scratch.parent.invert().multiply(world)); bone.updateWorldMatrix(false, true);
}
function pointBone(bone, child, target, scratch) {
  const origin = scratch.origin.setFromMatrixPosition(bone.matrixWorld);
  const from = scratch.from.setFromMatrixPosition(child.matrixWorld).sub(origin).normalize(), to = scratch.to.copy(target).sub(origin).normalize();
  turnWorld(bone, scratch.rotation.setFromUnitVectors(from, to), scratch);
}
function twoBone(upper, lower, end, target, pole, scratch) {
  const a = scratch.a.setFromMatrixPosition(upper.matrixWorld), b = scratch.b.setFromMatrixPosition(lower.matrixWorld), c = scratch.c.setFromMatrixPosition(end.matrixWorld);
  const first = a.distanceTo(b), second = b.distanceTo(c), direction = scratch.direction.copy(target).sub(a), distance = Math.min(first + second - 0.0001, Math.max(0.001, direction.length()));
  direction.normalize(); const along = (first * first - second * second + distance * distance) / (2 * distance);
  const bend = scratch.bend.copy(pole).sub(a); bend.addScaledVector(direction, -bend.dot(direction)).normalize();
  const elbow = scratch.elbow.copy(a).addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, first * first - along * along)));
  pointBone(upper, lower, elbow, scratch); pointBone(lower, end, target, scratch);
}

export function createOperator(player, models, { wardrobe = false, armed = !wardrobe } = {}) {
  const character = getCharacter(player.characterId), female = character.rig === 'female', { bodyMesh } = OPERATOR_RIGS[character.rig];
  const { body, hair: standardHair, scale, bottom } = assets.get(character.rig);
  const outfit = getOutfit(player.outfitId), finish = getSkin(player.skinId);
  const team = Object.hasOwn(TEAM_UNIFORMS, player.teamId) ? TEAM_UNIFORMS[player.teamId] : null;
  const palette = operatorPalette(outfit, character);
  const group = new THREE.Group(), visual = clone(body.scene); group.add(visual);
  visual.traverse((mesh) => {
    if (!mesh.isMesh) return;
    if (mesh.name !== bodyMesh) {
      const face = operatorFace(mesh.geometry, character, mesh.name);
      mesh.geometry = models.sharedOperatorGeometry(`body-${face.uuid}`, face);
    }
    mesh.material = localMaterial(mesh.material, models, character);
    if (mesh.name === 'Eyebrows') {
      mesh.material.color.set(character.hairColor).lerp(new THREE.Color('#ba9280'), .24);
      mesh.material.normalScale.setScalar(.25);
    }
    mesh.castShadow = mesh.receiveShadow = true;
  });
  const draftHair = createDraftHair(character, visual.getObjectByName(bodyMesh).geometry, models), hair = draftHair || standardHair.scene.clone(true);
  if (!draftHair) hair.traverse((mesh) => {
    if (!mesh.isMesh) return;
    mesh.geometry = models.sharedOperatorGeometry(`hair-${mesh.geometry.uuid}`, mesh.geometry);
    mesh.material = localMaterial(mesh.material, models, character);
    mesh.material.color.set(character.hairColor); mesh.material.normalScale.setScalar(.55);
    mesh.material.roughness = .68; mesh.castShadow = true;
  });
  hair.name = 'styled-hair'; visual.add(hair);
  visual.scale.set(scale * (female ? .98 : .94), scale, scale * .97); visual.position.y = -bottom * scale; visual.rotation.y = Math.PI; group.updateMatrixWorld(true);
  const bones = {}; visual.traverse((bone) => { if (bone.isBone) bones[bone.name] = bone; });
  dressOperator(visual.getObjectByName(bodyMesh), outfit, character, palette, team, models);
  bones.Head.attach(hair);
  const weapon = armed ? models.create(player.weaponId || 'rifle', player.weaponSkinId || player.skinId || 'standard', false, outfit.id, character.id, player.suppressor === true) : null;
  if (weapon) group.add(weapon);
  const rest = Object.values(bones).map((bone) => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
  const feet = ['l', 'r'].map((side) => group.worldToLocal(bones[`foot_${side}`].getWorldPosition(new THREE.Vector3())));
  const footRotations = ['l', 'r'].map((side) => group.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(bones[`foot_${side}`].getWorldQuaternion(new THREE.Quaternion())));
  const headTop = 1.8 - group.worldToLocal(bones.Head.getWorldPosition(new THREE.Vector3())).y;
  group.userData.outfitId = outfit.id; group.userData.characterId = character.id; group.userData.skinId = finish.id; group.userData.rig = 'human-v3'; group.userData.engineMaterials = [WEAVE];
  group.userData.teamId = team ? player.teamId : null;
  const operator = { group, visual, bones, rest, feet, footRotations, headTop, scale, weapon, legs: [bones.thigh_l, bones.thigh_r], crouchParts: [], crouchAmount: 0, poseScratch: poseScratch() };
  poseOperator(operator, 0); return operator;
}

function resetPose(operator) {
  const { group, poseScratch: scratch } = operator;
  for (const rest of operator.rest) { rest.bone.position.copy(rest.position); rest.bone.quaternion.copy(rest.quaternion); }
  group.updateWorldMatrix(true, false);
  group.updateMatrixWorld(true);
  group.matrixWorld.decompose(scratch.position, scratch.groupRotation, scratch.scale); scratch.groupInverse.copy(group.matrixWorld).invert();
}

export function poseOperator(operator, crouch, stride = 0) {
  const { group, bones, weapon, poseScratch: scratch } = operator;
  resetPose(operator);
  const up = scratch.up.set(0, 1, 0).applyQuaternion(scratch.groupRotation), axis = scratch.axis.set(1, 0, 0).applyQuaternion(scratch.groupRotation);
  translateWorld(bones.pelvis, scratch.target.copy(up).multiplyScalar(-crouch * 0.43), scratch);
  turnWorld(bones.spine_01, scratch.rotation.setFromAxisAngle(axis, -0.85 * crouch), scratch);
  turnWorld(bones.Head, scratch.rotation.setFromAxisAngle(axis, 0.65 * crouch), scratch);
  if (!weapon) {
    turnWorld(bones.spine_02, scratch.rotation.setFromAxisAngle(up, -.09), scratch);
    turnWorld(bones.Head, scratch.rotation.setFromAxisAngle(up, .13), scratch);
  }
  const top = scratch.position.setFromMatrixPosition(bones.Head.matrixWorld).applyMatrix4(scratch.groupInverse).y + operator.headTop;
  translateWorld(bones.pelvis, scratch.target.copy(up).multiplyScalar(-Math.max(0, top - (1.8 - crouch * 0.7))), scratch);
  for (let i = 0; i < 2; i++) {
    const side = i ? 'r' : 'l', foot = scratch.foot.copy(operator.feet[i]), swing = i ? -stride : stride;
    foot.z += swing * 0.45 * (1 - crouch * 0.6); foot.y += Math.max(0, swing) * 0.14;
    if (!weapon) { foot.x += i ? .022 : -.017; foot.z += i ? -.029 : .034; }
    twoBone(bones[`thigh_${side}`], bones[`calf_${side}`], bones[`foot_${side}`], foot.applyMatrix4(group.matrixWorld), scratch.pole.set(i ? 0.20 : -0.20, 0.45, -0.65).applyMatrix4(group.matrixWorld), scratch);
    setWorldRotation(bones[`foot_${side}`], scratch.rotation.copy(scratch.groupRotation).multiply(operator.footRotations[i]), scratch);
  }
  weapon?.position.set(0.10, 1.19 - crouch * 0.52, -0.16);
  for (let i = 0; i < 2; i++) {
    const side = i ? 'l' : 'r', target = scratch.target;
    if (!weapon) target.set(i ? -.267 : .25, i ? .822 : .802, i ? -.047 : -.017);
    else if (!i) target.set(0.055, -0.13, 0.13);
    else if (weapon.userData.modelBase === 'knife') target.set(-.2, -.12, -.08);
    else if (weapon.userData.modelBase === 'pistol') target.set(-0.04, -0.13, 0.10);
    else target.set(-0.06, -0.05, -0.12);
    if (weapon) target.applyEuler(weapon.rotation).add(weapon.position);
    target.applyMatrix4(group.matrixWorld);
    twoBone(bones[`upperarm_${side}`], bones[`lowerarm_${side}`], bones[`hand_${side}`], target, scratch.pole.set(i ? -0.4 : 0.4, 0.98 - crouch * 0.5, 0.08).applyMatrix4(group.matrixWorld), scratch);
    if (weapon) turnWorld(bones[`hand_${side}`], scratch.rotation.setFromAxisAngle(axis, Math.PI / 2), scratch);
    else for (const digit of ['index','middle','ring','pinky']) for (let joint = 1; joint <= 3; joint++) {
      bones[`${digit}_0${joint}_${side}`].rotateX(joint === 2 ? .26 : .16);
    }
  }
  weapon?.updateMatrixWorld(true);
}

export function captureOperatorFall(operator, sourceAvatar, crouch) {
  const { group, bones, poseScratch: scratch } = operator;
  group.position.set(0, 0, 0);
  if (sourceAvatar?.bones) {
    for (const { bone } of operator.rest) {
      const source = sourceAvatar.bones[bone.name];
      if (source) { bone.position.copy(source.position); bone.quaternion.copy(source.quaternion); }
    }
  } else poseOperator(operator, crouch);
  group.updateWorldMatrix(true, true);
  operator.fallPose ||= operator.rest.map(() => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }));
  for (const [i, { bone }] of operator.rest.entries()) {
    const initial = operator.fallPose[i]; initial.position.copy(bone.position); initial.quaternion.copy(bone.quaternion);
  }
  operator.fallHip ||= new THREE.Vector3();
  return operator.fallHip.copy(group.worldToLocal(scratch.position.setFromMatrixPosition(bones.pelvis.matrixWorld)));
}

const fingers = ['index', 'middle', 'ring', 'pinky'];
const vertical = new THREE.Vector3(0, 1, 0);
export function poseFallingOperator(operator, frame, side, constrained, floor, yaw) {
  const { group, bones, fallHip: hip, poseScratch: scratch } = operator;
  resetPose(operator);
  const { flinch, knee, reach, loose, settle, blend } = frame;
  // Pin the pelvis to the animated root. Limbs move around it independently,
  // from the previous combat frame through recoil, collapse, and rest.
  const up = scratch.up.set(0, 1, 0).applyQuaternion(scratch.groupRotation);
  const axis = scratch.axis.set(1, 0, 0).applyQuaternion(scratch.groupRotation);
  const world = group.matrixWorld;
  const pelvis = scratch.position.setFromMatrixPosition(bones.pelvis.matrixWorld);
  translateWorld(bones.pelvis, scratch.target.copy(hip).applyMatrix4(world).sub(pelvis), scratch);
  turnWorld(bones.spine_01, scratch.rotation.setFromAxisAngle(axis, .25 * flinch - .23 * knee + .052 * settle), scratch);
  turnWorld(bones.spine_03, scratch.rotation.setFromAxisAngle(up, side * (.20 * flinch + .10 * settle)), scratch);
  turnWorld(bones.Head, scratch.rotation.setFromAxisAngle(axis, .22 * flinch + .095 * settle), scratch);
  turnWorld(bones.Head, scratch.rotation.setFromAxisAngle(up, -side * .19 * settle), scratch);

  for (const [i, limb] of ['l', 'r'].entries()) {
    const sign = i ? 1 : -1, lead = sign === side, lift = lead ? .16 : .06;
    const foot = scratch.foot.copy(operator.feet[i]);
    foot.x = hip.x + sign * (.12 + .05 * settle);
    foot.y = hip.y - .84 + .23 * knee + lift * settle + (constrained ? .35 * settle : 0);
    foot.z = hip.z + .025 + (lead ? -.18 : -.07) * knee + (lead ? .056 : .067) * settle;
    foot.applyMatrix4(world);
    // Keep the soles planted for the first knee buckle, then let the feet
    // peel off as the character loses balance. Airborne falls skip this hold.
    const hold = floor == null ? 0 : frame.footHold * (lead ? .84 : 1);
    if (hold) foot.y = THREE.MathUtils.lerp(foot.y, floor + operator.feet[i].y, hold);
    twoBone(bones[`thigh_${limb}`], bones[`calf_${limb}`], bones[`foot_${limb}`], foot,
      scratch.pole.set(hip.x + sign * .19, hip.y - .38, hip.z - .56).applyMatrix4(world), scratch);
    const orientation = scratch.rotation.copy(scratch.groupRotation).multiply(operator.footRotations[i]);
    if (hold) orientation.slerp(scratch.floorRotation.setFromAxisAngle(vertical, yaw).multiply(operator.footRotations[i]), hold);
    setWorldRotation(bones[`foot_${limb}`], orientation, scratch);
    turnWorld(bones[`foot_${limb}`], scratch.rotation.setFromAxisAngle(up, -sign * (.15 * settle + .11 * knee)), scratch);

    const hand = bones[`hand_${limb}`], elbow = bones[`lowerarm_${limb}`], middle = bones[`middle_01_${limb}`];
    const wrist = scratch.target.set(hip.x + sign * (.26 + .25 * reach - (lead ? .005 : .10) * settle),
      hip.y + .28 + (lead ? .15 : -.035) * reach - (lead ? .27 : .18) * settle,
      hip.z - .27 + .24 * reach + (lead ? .115 : .095) * settle);
    if (constrained) { wrist.x -= sign * .11 * settle; wrist.y -= .20 * settle; wrist.z -= .08 * settle; }
    twoBone(bones[`upperarm_${limb}`], elbow, hand, wrist.applyMatrix4(world),
      scratch.pole.set(hip.x + sign * .50, hip.y + .14, hip.z + .12).applyMatrix4(world), scratch);
    // Give the empty wrist its own loose follow-through. It no longer uses
    // the equipped weapon as an IK target or forces the aiming rotation.
    const next = scratch.target.setFromMatrixPosition(hand.matrixWorld);
    const direction = scratch.elbow.setFromMatrixPosition(elbow.matrixWorld);
    direction.negate().add(next).normalize();
    next.addScaledVector(direction, .13).addScaledVector(up, -.025 * settle);
    next.y -= .047 * settle;
    pointBone(hand, middle, next, scratch);
    turnWorld(hand, scratch.rotation.setFromAxisAngle(direction, sign * (.52 * reach - .16 * settle)), scratch);
    for (const [finger, digit] of fingers.entries()) {
      bones[`${digit}_01_${limb}`].rotateZ((finger - 1.45) * sign * .07 * loose * (1 - .66 * settle));
      for (let joint = 1; joint <= 3; joint++) {
        bones[`${digit}_0${joint}_${limb}`].rotateX(.06 * loose + (joint === 2 ? .27 : .14) * settle);
      }
    }
    bones[`thumb_02_${limb}`].rotateX(-.13 * loose + .22 * settle);
  }
  if (blend < 1) for (const [i, { bone }] of operator.rest.entries()) {
    const initial = operator.fallPose[i];
    bone.position.lerp(initial.position, 1 - blend);
    bone.quaternion.slerp(initial.quaternion, 1 - blend);
  }
  group.updateMatrixWorld(true);
}
