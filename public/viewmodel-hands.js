import * as THREE from '/vendor/three.module.js';
import { GLTFLoader } from '/vendor/addons/loaders/GLTFLoader.js';
import { clone } from '/vendor/addons/utils/SkeletonUtils.js';
import { weaponGrip } from './weapon-grips.js';

const loader = new GLTFLoader();
const sources = new Map(await Promise.all(['male', 'female'].map(async (id) => [id, await loader.loadAsync(`/assets/models/view-hands-${id}-v1.glb`)])));
const prepared = new Map(), axis = new THREE.Vector3(1, 0, 0);
const v = (array) => new THREE.Vector3(...array);

function anatomicalHand(character, side, profile, covered) {
  const key = `${character}/${side}/${profile}/${covered}`;
  if (prepared.has(key)) return prepared.get(key);
  const rig = clone(sources.get(character).scene), mesh = rig.getObjectByName(`ViewHand_${side.toUpperCase()}`);
  const bones = Object.fromEntries(mesh.skeleton.bones.map((bone) => [bone.name, bone])), wrist = bones[`hand_${side}`];
  for (const digit of ['index', 'middle', 'ring', 'pinky']) {
    const curl = profile === 'trigger' && digit === 'index' ? [.2, .48, .4] : profile === 'cradle' ? [.42, .85, .82] : [.82, 1.08, .7];
    for (let joint = 1; joint <= 3; joint++) bones[`${digit}_0${joint}_${side}`].quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, curl[joint - 1]));
  }
  bones[`thumb_02_${side}`].quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, .48));
  bones[`thumb_03_${side}`].quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, .35));
  rig.updateMatrixWorld(true);
  const toWrist = wrist.matrixWorld.clone().invert(), source = mesh.geometry, position = source.getAttribute('position'), normal = source.getAttribute('normal');
  const joints = source.getAttribute('skinIndex'), weights = source.getAttribute('skinWeight');
  const transforms = mesh.skeleton.bones.map((bone, i) => toWrist.clone().multiply(mesh.matrixWorld).multiply(mesh.bindMatrixInverse).multiply(bone.matrixWorld).multiply(mesh.skeleton.boneInverses[i]).multiply(mesh.bindMatrix));
  const normals = transforms.map((matrix) => new THREE.Matrix3().getNormalMatrix(matrix));
  const geometry = source.clone(), vertices = new Float32Array(position.count * 3), directions = new Float32Array(position.count * 3), categories = [];
  const input = new THREE.Vector3(), inputNormal = new THREE.Vector3(), result = new THREE.Vector3(), resultNormal = new THREE.Vector3(), temp = new THREE.Vector3();
  const scale = character === 'female' ? .97 : .86;
  for (let i = 0; i < position.count; i++) {
    input.fromBufferAttribute(position, i); inputNormal.fromBufferAttribute(normal, i); result.set(0, 0, 0); resultNormal.set(0, 0, 0); let dominant = 0;
    for (let j = 0; j < 4; j++) {
      if (weights.getComponent(i, j) > weights.getComponent(i, dominant)) dominant = j;
      const weight = weights.getComponent(i, j); if (!weight) continue;
      const bone = joints.getComponent(i, j);
      result.addScaledVector(temp.copy(input).applyMatrix4(transforms[bone]), weight);
      resultNormal.addScaledVector(temp.copy(inputNormal).applyMatrix3(normals[bone]), weight);
    }
    result.multiplyScalar(scale).toArray(vertices, i * 3); resultNormal.normalize().toArray(directions, i * 3);
    categories[i] = !covered && /(?:index|middle|ring|pinky|thumb)_0[234]/.test(mesh.skeleton.bones[joints.getComponent(i, dominant)].name) ? 1 : 0;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(directions, 3));
  geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight');
  const indices = [[], []], index = source.index.array;
  for (let i = 0; i < index.length; i += 3) {
    const triangle = [index[i], index[i + 1], index[i + 2]], type = triangle.filter((i) => categories[i] === 1).length >= 2 ? 1 : 0; indices[type].push(...triangle);
  }
  geometry.setIndex(indices.flat()); geometry.clearGroups(); geometry.addGroup(0, indices[0].length, 0); if (indices[1].length) geometry.addGroup(indices[0].length, indices[1].length, 1);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const palmLength = bones[`middle_01_${side}`].getWorldPosition(new THREE.Vector3()).applyMatrix4(toWrist).y * scale;
  const resultData = { geometry, palmLength, scale, sourceMaterial: mesh.material, bones: mesh.skeleton.bones.length, key };
  prepared.set(key, resultData); return resultData;
}

function localTexture(models, file, repeat = 1) {
  const key = `view-fabric/${file}/${repeat}`;
  if (!models.textures.has(key)) { const texture = models.assetTexture(file).clone(); texture.repeat.set(repeat, repeat); models.textures.set(key, texture); }
  return models.textures.get(key);
}

function skinMaterial(models, source, character) {
  const skin = source.clone(); skin.name = 'view-hand-skin'; skin.depthTest = skin.depthWrite = true; skin.fog = false; skin.vertexColors = false;
  skin.color.set('#fff8f0'); skin.metalness = 0; skin.roughness = .8; skin.normalScale.setScalar(.25);
  for (const property of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (skin[property]) {
    const key = `view-skin/${character}/${skin[property].uuid}`;
    if (!models.textures.has(key)) models.textures.set(key, skin[property].clone()); skin[property] = models.textures.get(key);
  }
  return skin;
}

function sleeveGeometry(points, wristWidth, side, wristRotation) {
  // A forearm is a rigid bone, not a Catmull–Rom hose. The elbow/upper arm stay
  // outside the first-person frustum; no artificial S-bend near the cuff.
  const curve = new THREE.LineCurve3(v(points[0]), v(points.at(-1)));
  const positions = [], uvs = [], indices = [], radii = [], rings = 15, segments = 16;
  const wristX = new THREE.Vector3(1, 0, 0).applyQuaternion(wristRotation);
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings, center = curve.getPoint(t), direction = curve.getTangent(t).normalize();
    const horizontal = wristX.clone();
    horizontal.addScaledVector(direction, -horizontal.dot(direction)).normalize();
    const vertical = direction.clone().cross(horizontal).normalize();
    const radius = wristWidth + (.084 - wristWidth) * (1 - t) ** .55;
    radii.push(radius);
    for (let section = 0; section <= segments; section++) {
      const angle = section / segments * Math.PI * 2, depth = THREE.MathUtils.lerp(.86, 1.35, t ** 3);
      const point = center.clone().addScaledVector(horizontal, Math.cos(angle) * radius).addScaledVector(vertical, Math.sin(angle) * radius * depth);
      positions.push(...point.toArray()); uvs.push(section / segments, t * 2);
      if (ring < rings && section < segments) { const a = ring * (segments + 1) + section, b = a + segments + 1; indices.push(a, a + 1, b, b, a + 1, b + 1); }
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.userData.sleevePath = points.map((point) => [...point]); geometry.userData.sleeveLength = curve.getLength();
  geometry.userData.sleeveRadii = radii; geometry.userData.straightSupport = true; geometry.userData.rigidForearm = true; return geometry;
}

export function createViewmodelHands(models, { group, shape, weaponId, outfit, skin, character }) {
  const covered = ['hazmat', 'orbital'].includes(outfit.id), root = new THREE.Group(); root.name = 'first-person-human-arms'; group.add(root);
  const fabricMap = localTexture(models, 'operator-fabric.png', 2.5), gloveMap = localTexture(models, 'operator-armor.png', 9);
  const fabric = new THREE.MeshStandardMaterial({ name: 'view-sleeve-fabric', color: outfit.id === 'field' ? skin.suit : outfit.suit, map: fabricMap, bumpMap: fabricMap, bumpScale: .0009, roughness: .96, metalness: 0, fog: false });
  const gloveColor = new THREE.Color(outfit.id === 'field' ? skin.dark : outfit.dark).lerp(new THREE.Color('#9ba69f'), .22);
  const glove = new THREE.MeshStandardMaterial({ name: 'view-tactical-glove', color: gloveColor, map: gloveMap, bumpMap: gloveMap, bumpScale: .0007, roughness: .86, metalness: 0, fog: false });
  const trim = new THREE.MeshStandardMaterial({ name: 'view-cuff', color: outfit.id === 'field' ? skin.dark : outfit.dark, roughness: .95, metalness: 0, fog: false });
  const compactSupport = shape === 'rifle' || shape === 'sniper';
  let supportArm;
  for (const side of ['r', 'l']) {
    const right = side === 'r', profile = shape === 'knife' ? 'fist' : right ? 'trigger' : shape === 'pistol' ? 'wrap' : 'cradle';
    const prepared = anatomicalHand(character.id, side, profile, covered), name = right ? 'right-hand' : 'left-hand';
    const assembly = new THREE.Group(); assembly.name = `${right ? 'right' : 'left'}-arm`; root.add(assembly); if (!right) supportArm = assembly;
    const hand = new THREE.Group(); hand.name = name; hand.userData.fingers = 5; hand.userData.anatomical = true; hand.userData.side = side; hand.userData.pose = profile; hand.userData.rigBones = prepared.bones;
    const grip = weaponGrip(shape, weaponId, right, prepared.palmLength), { wrist, foreend } = grip;
    hand.quaternion.copy(grip.rotation);
    const socket = new THREE.Object3D(); socket.name = `grip-${side}`; socket.position.set(...wrist); socket.quaternion.copy(grip.rotation); assembly.add(socket);
    socket.userData.attachment = grip.parent;
    hand.position.set(...wrist); assembly.add(hand);
    const geometry = models.sharedOperatorGeometry(`view-hand/${prepared.key}`, prepared.geometry);
    const mesh = new THREE.Mesh(geometry, [glove, skinMaterial(models, prepared.sourceMaterial, character.id)]); mesh.name = 'palm'; hand.add(mesh);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 20, 1, true), trim); cuff.name = `${name}-cuff`; cuff.position.y = -.008; cuff.scale.set(.029, .025, .041); hand.add(cuff);
    const end = v([0, -.017, 0]).applyQuaternion(hand.quaternion).add(hand.position);
    const forearm = new THREE.Vector3(0, 1, 0).applyQuaternion(hand.quaternion);
    const approach = end.clone().addScaledVector(forearm, -.075);
    const length = right || shape === 'pistol' ? .55 : shape === 'lmg' ? .74 : .70;
    const shoulder = end.clone().addScaledVector(forearm, -length).toArray(), elbow = end.clone().addScaledVector(forearm, -length / 2).toArray();
    const sleeve = new THREE.Mesh(sleeveGeometry([shoulder, elbow, approach.toArray(), end.toArray()], character.id === 'female' ? .029 : .031, right ? 1 : -1, hand.quaternion), fabric); sleeve.name = right ? 'right-sleeve' : 'left-sleeve'; assembly.add(sleeve);
    hand.userData.wrist = [...wrist]; hand.userData.foreend = foreend ?? null; hand.userData.compactSupport = !right && compactSupport;
  }
  root.userData.anatomy = 'quaternius-view-hands-v1'; root.userData.covered = covered; root.userData.characterId = character.id;
  root.userData.gripSystem = 'weapon-local-neutral-wrist-v2';
  group.userData.supportArm = supportArm; group.userData.handRig = root; return root;
}
