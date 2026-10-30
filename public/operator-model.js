import * as THREE from '/vendor/three.module.js';
import { getSkin } from '/shared/catalog.js';
import { getOutfit } from '/shared/outfits.js';
import { WeaponModels, disposeModel } from './weapon-model.js';
import { HumanParts } from './human-model.js';

export function createOperator(player, models) {
  const group = new THREE.Group(), outfit = getOutfit(player.outfitId), finish = getSkin(player.skinId);
  const palette = outfit.id === 'field' ? { suit: finish.suit, armor: finish.color, dark: finish.dark, visor: finish.visor } : outfit;
  const texture = models.assetTexture(outfit.id === 'field' ? finish.pattern : outfit.pattern);
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.86, metalness: 0, ...extra });
  const suit = mat(palette.suit), armor = mat(palette.armor, { map: texture, metalness: 0.15, roughness: 0.65 }), dark = mat(palette.dark);
  const accent = mat(palette.visor, { emissive: palette.visor, emissiveIntensity: 0.25 });
  const skin = mat('#bf9278'), lips = mat('#8d5c50'), hair = mat('#292523'), white = mat('#dfddd4'), iris = mat('#46534c'), pupil = mat('#141b20');
  const parts = new HumanParts(), crouchParts = [], legs = [];
  const pose = (mesh, lowerBy, scaleY = 1) => { crouchParts.push({ mesh, y: mesh.position.y, height: mesh.scale.y, lowerBy, scaleY }); return mesh; };
  const torso = new THREE.Group(); torso.name = 'torso'; torso.position.y = 1.15; group.add(torso); pose(torso, 0.59, 0.82);
  // Tailored chest, narrower waist and separate pelvis rather than stacked boxes.
  const profile = [[0, -0.27], [0.15, -0.26], [0.165, -0.19], [0.17, -0.08], [0.21, 0.08], [0.23, 0.19], [0.18, 0.25], [0.07, 0.28], [0, 0.28]];
  parts.mesh(torso, new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 20), [1, 1, 0.63], [0, 0, 0], suit, 'uniform-chest');
  parts.panel(torso, [0.33, 0.30, 0.055], [0, 0.07, -0.13], armor, 'fitted-vest');
  parts.panel(torso, [0.31, 0.29, 0.045], [0, 0.06, 0.13], armor, 'back-plate');
  parts.oval(torso, [0.34, 0.08, 0.24], [0, -0.22, 0], dark, 'belt');
  for (const side of [-1, 1]) {
    parts.segment(torso, [side * 0.14, 0.23, -0.1], [side * 0.13, -0.1, -0.16], 0.045, dark, 'vest-strap', 0.025);
    parts.panel(torso, [0.105, 0.12, 0.04], [side * 0.08, -0.06, -0.17], suit, 'vest-pocket');
  }
  const pelvis = parts.oval(group, [0.35, 0.23, 0.24], [0, 0.87, 0.015], suit, 'pelvis'); pose(pelvis, 0.4);
  const head = new THREE.Group(); head.name = 'human-head'; head.position.y = 1.62; group.add(head); pose(head, 0.7);
  parts.oval(head, [0.12, 0.13, 0.12], [0, -0.15, 0.015], skin, 'neck');
  const faceProfile = [[0, -0.153], [0.055, -0.144], [0.085, -0.116], [0.112, -0.065], [0.124, -0.015], [0.125, 0.045], [0.111, 0.112], [0.075, 0.145], [0, 0.156]];
  parts.mesh(head, new THREE.LatheGeometry(faceProfile.map(([x, y]) => new THREE.Vector2(x, y)), 24), [1, 1, 0.95], [0, 0, 0], skin, 'face');
  parts.oval(head, [0.028, 0.044, 0.043], [0, -0.013, -0.122], skin, 'nose');
  parts.oval(head, [0.052, 0.006, 0.01], [0, -0.073, -0.106], lips, 'mouth');
  for (const side of [-1, 1]) {
    parts.oval(head, [0.035, 0.07, 0.047], [side * 0.126, -0.012, 0.005], skin, 'ear');
    parts.oval(head, [0.043, 0.015, 0.012], [side * 0.048, 0.024, -0.111], white, 'eye');
    parts.oval(head, [0.015, 0.015, 0.008], [side * 0.048, 0.024, -0.119], iris, 'iris');
    parts.oval(head, [0.007, 0.01, 0.004], [side * 0.048, 0.024, -0.124], pupil, 'pupil');
    const brow = parts.oval(head, [0.046, 0.008, 0.011], [side * 0.049, 0.045, -0.113], hair, 'eyebrow'); brow.rotation.z = side * 0.08;
  }
  const hairProfile = [[0.122, 0.08], [0.116, 0.112], [0.08, 0.145], [0, 0.16]];
  parts.mesh(head, new THREE.LatheGeometry(hairProfile.map(([x, y]) => new THREE.Vector2(x, y)), 24), [1, 1, 0.99], [0, 0, 0], hair, 'hair');
  const arms = new THREE.Group(); arms.name = 'arms'; group.add(arms); pose(arms, 0.58);
  const coveredHands = outfit.id === 'hazmat' || outfit.id === 'orbital';
  for (const side of [-1, 1]) {
    const shoulder = [side * 0.225, 1.35, 0], elbow = [side * 0.275, 1.08, -0.06];
    const wrist = side > 0 ? [0.245, 0.98, -0.09] : [-0.025, 1.015, -0.48];
    parts.oval(arms, [0.145, 0.16, 0.17], shoulder, suit, 'shoulder');
    parts.segment(arms, shoulder, elbow, 0.135, suit, 'upper-arm');
    parts.oval(arms, [0.12, 0.12, 0.12], elbow, suit, 'elbow');
    parts.segment(arms, elbow, wrist, 0.112, suit, 'forearm');
    const hand = parts.hand(arms, wrist, dark, coveredHands ? dark : skin, side > 0 ? 'right-hand' : 'left-hand');
    hand.rotation.set(-0.25, side > 0 ? 0 : -1, side > 0 ? 0.25 : -0.9);
    const leg = new THREE.Group(); leg.name = side > 0 ? 'right-leg' : 'left-leg'; leg.position.set(side * 0.105, 0.86, 0); group.add(leg);
    parts.segment(leg, [0, 0, 0], [0, -0.4, 0], 0.18, suit, 'thigh', 0.195);
    parts.panel(leg, [0.105, 0.13, 0.025], [side * 0.046, -0.15, -0.073], suit, 'cargo-pocket');
    const knee = new THREE.Group(); knee.name = 'knee'; knee.position.y = -0.4; leg.add(knee);
    parts.oval(knee, [0.14, 0.14, 0.15], [0, 0, 0], suit, 'knee-joint');
    parts.segment(knee, [0, -0.01, 0], [0, -0.35, 0], 0.14, suit, 'shin', 0.155);
    parts.oval(knee, [0.135, 0.14, 0.055], [0, 0, -0.078], armor, 'knee-pad');
    const ankle = new THREE.Group(); ankle.position.y = -0.35; knee.add(ankle);
    parts.oval(ankle, [0.16, 0.16, 0.29], [0, -0.03, -0.045], dark, 'boot');
    parts.panel(ankle, [0.155, 0.035, 0.27], [0, -0.09, -0.045], dark, 'boot-sole');
    leg.userData.knee = knee; leg.userData.ankle = ankle; legs.push(leg);
  }
  if (outfit.id === 'runner') {
    parts.mesh(head, new THREE.SphereGeometry(1, 20, 14, 0, Math.PI), [0.155, 0.175, 0.15], [0, 0, 0.025], dark, 'open-hood');
    parts.mesh(head, new THREE.TorusGeometry(1, 0.085, 8, 28), [0.143, 0.165, 0.15], [0, 0, -0.018], suit, 'hood-rim');
    for (const side of [-1, 1]) parts.segment(torso, [side * 0.15, 0.19, -0.145], [side * 0.15, 0, -0.175], 0.012, accent, 'scout-trim');
  } else if (outfit.id === 'hazmat' || outfit.id === 'orbital') {
    parts.mesh(head, new THREE.SphereGeometry(1, 20, 14, 0, Math.PI), [0.169, 0.175, 0.161], [0, -0.005, 0.01], armor, 'helmet-back');
    const glass = mat('#b4dfe1', { transparent: true, opacity: 0.13, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    parts.oval(head, [0.338, 0.35, 0.34], [0, -0.005, -0.006], glass, 'clear-face-shield');
    parts.mesh(head, new THREE.TorusGeometry(1, 0.055, 8, 28), [0.162, 0.17, 0.16], [0, -0.005, -0.027], dark, 'shield-rim');
    if (outfit.id === 'hazmat') {
      for (const side of [-1, 1]) {
        parts.oval(head, [0.065, 0.055, 0.055], [side * 0.09, -0.155, -0.11], dark, 'breathing-filter');
        parts.segment(torso, [side * 0.09, -0.22, 0.2], [side * 0.09, 0.21, 0.2], 0.115, dark, 'air-tank');
      }
      parts.oval(torso, [0.075, 0.075, 0.025], [0, 0.13, -0.174], accent, 'hazard-badge');
    } else {
      parts.oval(torso, [0.3, 0.4, 0.14], [0, 0, 0.2], dark, 'life-support');
      parts.oval(torso, [0.21, 0.13, 0.035], [0, 0.11, -0.175], dark, 'chest-control');
      for (let i = 0; i < 3; i++) parts.oval(torso, [0.022, 0.022, 0.018], [-0.055 + i * 0.055, 0.12, -0.195], accent, 'status-light');
    }
  } else {
    parts.mesh(head, new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, 1.1), [0.147, 0.156, 0.143], [0, 0.015, 0.012], armor, 'open-face-helmet');
    for (const side of [-1, 1]) {
      parts.oval(head, [0.052, 0.09, 0.10], [side * 0.136, -0.012, 0.015], dark, 'headset');
      parts.segment(head, [side * 0.128, -0.048, -0.012], [side * 0.09, -0.095, -0.095], 0.018, dark, 'chin-strap');
    }
    if (outfit.id === 'retrobot') {
      for (let i = 0; i < 3; i++) parts.oval(torso, [0.23, 0.024, 0.024], [0, 0.01 + i * 0.065, -0.172], dark, 'retro-vent');
      parts.oval(torso, [0.028, 0.028, 0.02], [0.12, 0.17, -0.17], accent, 'pilot-signal');
    }
  }
  const weapon = models.create(player.weaponId || 'rifle', player.skinId || 'standard', false, outfit.id); weapon.position.set(0.19, 1.05, -0.22); group.add(weapon);
  group.userData.outfitId = outfit.id; group.userData.rig = 'human-v1';
  return { group, legs, weapon, crouchParts, crouchAmount: 0 };
}

export function poseOperator(operator, crouch, stride = 0) {
  for (const part of operator.crouchParts) { part.mesh.position.y = part.y - part.lowerBy * crouch; part.mesh.scale.y = part.height * THREE.MathUtils.lerp(1, part.scaleY, crouch); }
  for (let i = 0; i < operator.legs.length; i++) {
    const leg = operator.legs[i], swing = i ? -stride : stride;
    leg.position.y = THREE.MathUtils.lerp(0.86, 0.5, crouch); leg.rotation.x = crouch * 1.2 + swing;
    leg.userData.knee.rotation.x = -crouch * 2 - Math.max(0, swing) * 0.55;
    leg.userData.ankle.rotation.x = crouch * 0.8;
  }
  operator.weapon.position.y = 1.05 - crouch * 0.49;
}

export class OperatorPreview {
  constructor(canvas) {
    this.canvas = canvas; this.models = new WeaponModels(); this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#13212b');
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.02, 20); this.camera.position.set(2.2, 1.35, -3.2); this.camera.lookAt(0, 0.95, 0);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.1;
    this.scene.add(new THREE.HemisphereLight('#d4e9ff', '#384540', 2.6));
    const key = new THREE.DirectionalLight('#ffe3c5', 3); key.position.set(3, 4, -3); this.scene.add(key);
    const rim = new THREE.DirectionalLight('#8cdadf', 3); rim.position.set(-2, 2, -2); this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: '#28404b', roughness: 0.8 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.005; this.scene.add(floor); this.floor = floor;
    this.resize = () => { const rect = canvas.getBoundingClientRect(); this.renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false); this.camera.aspect = rect.width / Math.max(1, rect.height); this.camera.updateProjectionMatrix(); };
    this.observer = new ResizeObserver(this.resize); this.observer.observe(canvas); this.resize();
    const animate = (time) => { if (this.stopped) return; this.frame = requestAnimationFrame(animate); if (this.operator) this.operator.group.rotation.y = -0.2 + Math.sin(time / 4000) * 0.6; this.renderer.render(this.scene, this.camera); }; this.frame = requestAnimationFrame(animate);
  }
  set(outfitId, skinId = 'standard', weaponId = 'rifle') {
    if (this.operator) { this.scene.remove(this.operator.group); disposeModel(this.operator.group); }
    this.operator = createOperator({ outfitId, skinId, weaponId }, this.models); this.scene.add(this.operator.group);
  }
  dispose() { this.stopped = true; cancelAnimationFrame(this.frame); this.observer.disconnect(); if (this.operator) disposeModel(this.operator.group); this.floor.geometry.dispose(); this.floor.material.dispose(); this.models.dispose(); this.renderer.dispose(); }
}
