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
  for (const key of ['groupRotation', 'world', 'parent', 'rotation']) scratch[key] = new THREE.Quaternion();
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

export function createOperator(player, models, { wardrobe = false } = {}) {
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
  const weapon = wardrobe ? null : models.create(player.weaponId || 'rifle', player.weaponSkinId || player.skinId || 'standard', false, outfit.id, character.id, player.suppressor === true);
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

export function poseOperator(operator, crouch, stride = 0) {
  const { group, bones, weapon, poseScratch: scratch } = operator;
  for (const rest of operator.rest) { rest.bone.position.copy(rest.position); rest.bone.quaternion.copy(rest.quaternion); }
  group.updateWorldMatrix(true, false);
  group.updateMatrixWorld(true);
  group.matrixWorld.decompose(scratch.position, scratch.groupRotation, scratch.scale); scratch.groupInverse.copy(group.matrixWorld).invert();
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
