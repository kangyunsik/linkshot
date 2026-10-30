import * as THREE from '/vendor/three.module.js';
import { GLTFLoader } from '/vendor/addons/loaders/GLTFLoader.js';
import { clone } from '/vendor/addons/utils/SkeletonUtils.js';
import { getSkin } from '/shared/catalog.js';
import { getOutfit, getCharacter, CHARACTERS } from '/shared/outfits.js';
import { NETWORK_PROTOCOL } from '/shared/world.js';
import { HumanParts } from './human-model.js';

const loader = new GLTFLoader();
const assets = new Map(await Promise.all(CHARACTERS.map(async (character) => [character.id, await Promise.all([loader.loadAsync(`/assets/models/${character.model}?v=${NETWORK_PROTOCOL}`), loader.loadAsync(`/assets/models/${character.hair}?v=${NETWORK_PROTOCOL}`), character.helmetHair ? loader.loadAsync(`/assets/models/${character.helmetHair}?v=${NETWORK_PROTOCOL}`) : null])])));
const v = (array) => new THREE.Vector3(...array);
const dressedGeometry = new Map();

function localMaterial(material, models) {
  const copy = material.clone();
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (copy[key]) {
    const id = `operator-${copy[key].uuid}`;
    if (!models.textures.has(id)) models.textures.set(id, copy[key].clone());
    copy[key] = models.textures.get(id);
  }
  copy.vertexColors = false;
  if (/superhero/i.test(copy.name)) {
    copy.color.set('#fff9f4'); copy.normalScale.setScalar(0.28); copy.roughness = 0.78;
    copy.emissive.set('#63463d'); copy.emissiveIntensity = 0.035;
  } else if (/eyes/i.test(copy.name)) { copy.normalScale.setScalar(0.18); copy.roughness = 0.22; }
  return copy;
}

function clothe(mesh, fabric, boots, coveredHands, characterId) {
  const geometry = mesh.geometry, skin = mesh.material;
  const key = `${characterId}-${coveredHands ? 'covered' : 'exposed'}`;
  // Reuse the prepared garment topology across avatars/corpses. Rebuilding its
  // adjacency and cloth allowance during every death caused avoidable hitches.
  if (dressedGeometry.has(key)) { geometry.dispose(); mesh.geometry = dressedGeometry.get(key).clone(); mesh.material = [skin, fabric, boots]; return; }
  const joints = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
  const category = [];
  for (let i = 0; i < positions.count; i++) {
    let best = 0; for (let j = 1; j < 4; j++) if (weights.getComponent(i, j) > weights.getComponent(i, best)) best = j;
    const bone = mesh.skeleton.bones[joints.getComponent(i, best)].name.toLowerCase();
    const hand = /hand|index|middle|pinky|ring|thumb/.test(bone);
    category[i] = /head|neck/.test(bone) || hand && !coveredHands ? 0 : /foot|ball/.test(bone) || hand ? 2 : 1;
    if (category[i] === 1) uv.setXY(i, (Math.abs(normals.getX(i)) > Math.abs(normals.getZ(i)) ? positions.getZ(i) : positions.getX(i)) * 7, positions.getY(i) * 7);
  }
  const indices = [[], [], []], source = geometry.index.array;
  const neighbors = Array.from({ length: positions.count }, () => new Set());
  for (let i = 0; i < source.length; i += 3) for (let j = 0; j < 3; j++) { const a = source[i + j]; neighbors[a].add(source[i + (j + 1) % 3]); neighbors[a].add(source[i + (j + 2) % 3]); }
  // A garment shell, not body paint: soften the superhero anatomy underneath
  // and add a relaxed cloth allowance while keeping skin/fingers untouched.
  for (let pass = 0; pass < 2; pass++) {
    const before = positions.array.slice();
    for (let i = 0; i < positions.count; i++) if (category[i] === 1 && neighbors[i].size && [...neighbors[i]].every((index) => category[index] === 1)) {
      const sum = new THREE.Vector3(); for (const index of neighbors[i]) sum.add(v([before[index * 3], before[index * 3 + 1], before[index * 3 + 2]])); sum.multiplyScalar(1 / neighbors[i].size);
      positions.setXYZ(i, before[i * 3] * 0.65 + sum.x * 0.35, before[i * 3 + 1] * 0.65 + sum.y * 0.35, before[i * 3 + 2] * 0.65 + sum.z * 0.35);
    }
  }
  for (let i = 0; i < positions.count; i++) if (category[i] === 1) { positions.setXYZ(i, positions.getX(i) + normals.getX(i) * 0.025, positions.getY(i) + normals.getY(i) * 0.025, positions.getZ(i) + normals.getZ(i) * 0.025); }
  for (let i = 0; i < source.length; i += 3) {
    const triangle = [source[i], source[i + 1], source[i + 2]], types = triangle.map((index) => category[index]);
    const type = types.filter((value) => value === 0).length >= 2 ? 0 : types.filter((value) => value === 2).length >= 2 ? 2 : 1;
    indices[type].push(...triangle);
  }
  geometry.setIndex(indices.flat()); geometry.clearGroups(); let offset = 0;
  for (let i = 0; i < 3; i++) { geometry.addGroup(offset, indices[i].length, i); offset += indices[i].length; }
  mesh.material = [skin, fabric, boots]; uv.needsUpdate = true; positions.needsUpdate = true; geometry.computeVertexNormals();
  dressedGeometry.set(key, geometry.clone());
}

function turnWorld(bone, rotation) {
  const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(rotation);
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
  bone.updateWorldMatrix(false, true);
}
function translateWorld(bone, delta) { const target = bone.getWorldPosition(new THREE.Vector3()).add(delta); bone.position.copy(bone.parent.worldToLocal(target)); bone.updateWorldMatrix(false, true); }
function setWorldRotation(bone, world) { bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world)); bone.updateWorldMatrix(false, true); }
function pointBone(bone, child, target) {
  const origin = bone.getWorldPosition(new THREE.Vector3());
  const from = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize(), to = target.clone().sub(origin).normalize();
  turnWorld(bone, new THREE.Quaternion().setFromUnitVectors(from, to));
}
function twoBone(upper, lower, end, target, pole) {
  const a = upper.getWorldPosition(new THREE.Vector3()), b = lower.getWorldPosition(new THREE.Vector3()), c = end.getWorldPosition(new THREE.Vector3());
  const first = a.distanceTo(b), second = b.distanceTo(c), direction = target.clone().sub(a), distance = Math.min(first + second - 0.0001, Math.max(0.001, direction.length()));
  direction.normalize(); const along = (first * first - second * second + distance * distance) / (2 * distance);
  const bend = pole.clone().sub(a); bend.addScaledVector(direction, -bend.dot(direction)).normalize();
  const elbow = a.clone().addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, first * first - along * along)));
  pointBone(upper, lower, elbow); pointBone(lower, end, target);
}

export function createOperator(player, models) {
  const character = getCharacter(player.characterId), female = character.id === 'female', [bodyAsset, standardHair, helmetHair] = assets.get(character.id);
  const outfit = getOutfit(player.outfitId), finish = getSkin(player.skinId), palette = outfit.id === 'field' ? { suit: finish.suit, armor: finish.color, dark: finish.dark, visor: finish.visor } : outfit;
  const hairAsset = helmetHair && ['runner', 'hazmat', 'orbital'].includes(outfit.id) ? helmetHair : standardHair;
  const group = new THREE.Group(), visual = clone(bodyAsset.scene); group.add(visual);
  visual.traverse((mesh) => { if (mesh.isMesh) { mesh.geometry = mesh.geometry.clone(); mesh.material = localMaterial(mesh.material, models); if (mesh.name === 'Eyebrows') { mesh.material.color.set('#b9a69a'); mesh.material.normalScale.setScalar(0.25); } mesh.castShadow = mesh.receiveShadow = true; } });
  const hair = hairAsset.scene.clone(true); hair.name = 'styled-hair'; hair.traverse((mesh) => { if (mesh.isMesh) { mesh.geometry = mesh.geometry.clone(); mesh.material = localMaterial(mesh.material, models); mesh.material.color.set(female ? '#4a3531' : '#574337'); mesh.material.normalScale.setScalar(0.55); mesh.material.roughness = 0.68; mesh.castShadow = true; } }); visual.add(hair);
  const box = new THREE.Box3().setFromObject(visual), scale = 1.8 / (box.max.y - box.min.y);
  visual.scale.set(scale * (female ? 0.98 : 0.94), scale, scale * 0.97); visual.position.y = -box.min.y * scale; visual.rotation.y = Math.PI; group.updateMatrixWorld(true);
  const bones = {}; visual.traverse((bone) => { if (bone.isBone) bones[bone.name] = bone; });
  const fabric = new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.suit).multiplyScalar(1.55), map: models.assetTexture('operator-fabric.png'), bumpMap: models.assetTexture('operator-fabric.png'), bumpScale: 0.002, roughness: 0.97 });
  const dark = new THREE.MeshStandardMaterial({ color: palette.dark, roughness: 0.85 });
  const jacketMap = models.assetTexture('operator-jacket.png'); jacketMap.repeat.set(1, 1); jacketMap.wrapS = jacketMap.wrapT = THREE.ClampToEdgeWrapping;
  const armor = new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.armor).multiplyScalar(1.45), map: jacketMap, bumpMap: models.assetTexture('operator-armor.png'), bumpScale: 0.0015, roughness: 0.92 });
  const accent = new THREE.MeshStandardMaterial({ color: palette.visor, emissive: palette.visor, emissiveIntensity: 0.2 });
  visual.traverse((mesh) => { if (mesh.isSkinnedMesh && mesh.name === character.bodyMesh) clothe(mesh, fabric, dark, outfit.id === 'hazmat' || outfit.id === 'orbital', character.id); });
  const parts = new HumanParts(), vest = new THREE.Group(); group.add(vest);
  const front = parts.panel(vest, [female ? 0.31 : 0.34, 0.37, 0.065], [0, 1.25, -0.16], armor, 'ballistic-vest');
  const panelPositions = front.geometry.getAttribute('position'), panelUV = front.geometry.getAttribute('uv');
  for (let i = 0; i < panelPositions.count; i++) panelUV.setXY(i, panelPositions.getX(i) + 0.5, panelPositions.getY(i) + 0.5); panelUV.needsUpdate = true;
  parts.panel(vest, [female ? 0.30 : 0.33, 0.35, 0.055], [0, 1.25, 0.145], armor, 'back-vest');
  for (const side of [-1, 1]) {
    parts.panel(vest, [0.105, 0.15, 0.055], [side * 0.115, 1.15, -0.205], fabric, 'magazine-pouch');
    parts.segment(vest, [side * 0.15, 1.45, -0.10], [side * 0.15, 1.16, -0.20], 0.045, dark, 'shoulder-strap', 0.025);
  }
  bones.spine_03.attach(vest);
  const uniform = new THREE.Group(); group.add(uniform);
  parts.mesh(uniform, new THREE.LatheGeometry([[0.18, -0.10], [0.205, -0.06], [0.195, 0.09], [0.17, 0.15]].map(([x, y]) => new THREE.Vector2(x, y)), 24), [1, 1, 0.72], [0, 0.94, 0.012], fabric, 'jacket-hem');
  parts.oval(uniform, [0.39, 0.055, 0.28], [0, 0.92, 0.01], dark, 'utility-belt'); bones.pelvis.attach(uniform);
  for (const side of ['l', 'r']) {
    const sign = side === 'l' ? -1 : 1, pocket = new THREE.Group(); group.add(pocket);
    parts.panel(pocket, [0.125, 0.17, 0.055], [sign * 0.15, 0.69, -0.10], fabric, 'cargo-pocket');
    parts.panel(pocket, [0.135, 0.035, 0.061], [sign * 0.15, 0.77, -0.10], dark, 'pocket-flap'); bones[`thigh_${side}`].attach(pocket);
  }
  const headGear = new THREE.Group(); group.add(headGear);
  if (outfit.id === 'runner') {
    parts.mesh(headGear, new THREE.SphereGeometry(1, 24, 16, 0, Math.PI), [0.143, 0.166, 0.145], [0, 1.66, 0.025], fabric, 'fabric-hood');
    parts.mesh(headGear, new THREE.TorusGeometry(1, 0.11, 8, 32), [0.139, 0.16, 0.15], [0, 1.66, -0.025], fabric, 'hood-edge');
    parts.mesh(headGear, new THREE.TorusGeometry(1, 0.018, 6, 32), [0.144, 0.165, 0.15], [0, 1.66, -0.03], accent, 'hood-piping');
  } else if (outfit.id === 'hazmat' || outfit.id === 'orbital') {
    parts.mesh(headGear, new THREE.SphereGeometry(1, 24, 16, 0, Math.PI), [0.154, 0.165, 0.151], [0, 1.65, 0.015], armor, 'helmet-shell');
    const glass = new THREE.MeshStandardMaterial({ color: '#b8e4ed', transparent: true, opacity: 0.09, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    parts.oval(headGear, [0.31, 0.33, 0.32], [0, 1.65, -0.01], glass, 'clear-face-shield');
    if (outfit.id === 'hazmat') for (const side of [-1, 1]) parts.oval(headGear, [0.055, 0.055, 0.06], [side * 0.09, 1.51, -0.10], dark, 'filter');
  } else for (const side of [-1, 1]) {
    parts.oval(headGear, [0.018, 0.034, 0.026], [side * 0.103, 1.64, 0.008], dark, 'in-ear-radio');
    if (side === 1) parts.segment(headGear, [0.105, 1.63, 0.008], [0.078, 1.57, -0.075], 0.006, dark, 'radio-mic');
  }
  bones.Head.attach(headGear); bones.Head.attach(hair);
  const pack = new THREE.Group(); group.add(pack);
  if (outfit.id === 'hazmat') for (const side of [-1, 1]) parts.segment(pack, [side * 0.08, 1.05, 0.21], [side * 0.08, 1.43, 0.21], 0.11, dark, 'oxygen-tank');
  if (outfit.id === 'orbital') { parts.panel(pack, [0.29, 0.38, 0.13], [0, 1.25, 0.20], armor, 'life-support'); parts.panel(vest, [0.16, 0.10, 0.025], [0, 1.34, -0.205], accent, 'control-panel'); }
  if (outfit.id === 'retrobot') for (let i = 0; i < 3; i++) parts.segment(pack, [-0.09, 1.25 + i * 0.06, -0.20], [0.09, 1.25 + i * 0.06, -0.20], 0.018, dark, 'retro-vent');
  bones.spine_03.attach(pack);
  for (const side of ['l', 'r']) {
    const foot = bones[`foot_${side}`], position = group.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
    const boot = new THREE.Group(); group.add(boot);
    parts.oval(boot, [0.17, 0.12, 0.29], [position.x, 0.075, position.z - 0.055], dark, 'combat-boot');
    parts.oval(boot, [0.145, 0.20, 0.17], [position.x, 0.13, position.z + 0.005], dark, 'boot-upper');
    parts.panel(boot, [0.165, 0.035, 0.29], [position.x, 0.025, position.z - 0.055], dark, 'boot-sole'); foot.attach(boot);
  }
  const weapon = models.create(player.weaponId || 'rifle', player.skinId || 'standard', false, outfit.id, character.id); weapon.position.set(0.10, 1.19, -0.16); group.add(weapon);
  const rest = Object.values(bones).map((bone) => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
  const feet = ['l', 'r'].map((side) => group.worldToLocal(bones[`foot_${side}`].getWorldPosition(new THREE.Vector3())));
  const footRotations = ['l', 'r'].map((side) => group.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(bones[`foot_${side}`].getWorldQuaternion(new THREE.Quaternion())));
  const headTop = 1.8 - group.worldToLocal(bones.Head.getWorldPosition(new THREE.Vector3())).y;
  group.userData.outfitId = outfit.id; group.userData.characterId = character.id; group.userData.skinId = finish.id; group.userData.rig = 'human-v3'; group.userData.engineMaterials = ['operator-fabric.png', 'operator-armor.png', 'operator-jacket.png'];
  const operator = { group, visual, bones, rest, feet, footRotations, headTop, scale, weapon, legs: [bones.thigh_l, bones.thigh_r], crouchParts: [], crouchAmount: 0 };
  poseOperator(operator, 0); return operator;
}

export function poseOperator(operator, crouch, stride = 0) {
  const { group, bones, scale, weapon } = operator;
  for (const rest of operator.rest) { rest.bone.position.copy(rest.position); rest.bone.quaternion.copy(rest.quaternion); }
  group.updateMatrixWorld(true);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
  translateWorld(bones.pelvis, up.clone().multiplyScalar(-crouch * 0.43));
  const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
  turnWorld(bones.spine_01, new THREE.Quaternion().setFromAxisAngle(axis, -0.85 * crouch));
  turnWorld(bones.Head, new THREE.Quaternion().setFromAxisAngle(axis, 0.65 * crouch));
  const top = group.worldToLocal(bones.Head.getWorldPosition(new THREE.Vector3())).y + operator.headTop;
  translateWorld(bones.pelvis, up.clone().multiplyScalar(-Math.max(0, top - (1.8 - crouch * 0.7)))); group.updateMatrixWorld(true);
  for (const [i, side] of ['l', 'r'].entries()) {
    const foot = operator.feet[i].clone(), swing = i ? -stride : stride;
    foot.z += swing * 0.45 * (1 - crouch * 0.6); foot.y += Math.max(0, swing) * 0.14;
    twoBone(bones[`thigh_${side}`], bones[`calf_${side}`], bones[`foot_${side}`], group.localToWorld(foot), group.localToWorld(v([i ? 0.20 : -0.20, 0.45, -0.65])));
    setWorldRotation(bones[`foot_${side}`], group.getWorldQuaternion(new THREE.Quaternion()).multiply(operator.footRotations[i]));
  }
  weapon.position.set(0.10, 1.19 - crouch * 0.52, -0.16);
  for (const [side, grip] of [['r', [0.055, -0.13, 0.13]], ['l', weapon.userData.modelBase === 'pistol' ? [-0.04, -0.13, 0.10] : [-0.06, -0.05, -0.12]]]) {
    const target = v(grip).applyEuler(weapon.rotation).add(weapon.position);
    twoBone(bones[`upperarm_${side}`], bones[`lowerarm_${side}`], bones[`hand_${side}`], group.localToWorld(target), group.localToWorld(v([side === 'l' ? -0.4 : 0.4, 0.98 - crouch * 0.5, 0.08])));
    turnWorld(bones[`hand_${side}`], new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2));
  }
  group.updateMatrixWorld(true);
}
