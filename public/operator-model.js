import * as THREE from '/vendor/three.module.js';
import { getSkin } from '/shared/catalog.js';
import { getOutfit } from '/shared/outfits.js';
import { WeaponModels, disposeModel } from './weapon-model.js';

export function createOperator(player, models) {
  const group = new THREE.Group(), outfit = getOutfit(player.outfitId), finish = getSkin(player.skinId);
  const palette = outfit.id === 'field' ? { suit: finish.suit, armor: finish.color, dark: finish.dark, visor: finish.visor } : outfit;
  const texture = models.assetTexture(outfit.id === 'field' ? finish.pattern : outfit.pattern);
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.3, ...extra });
  const suit = mat(palette.suit), armor = mat(palette.armor, { map: texture }), dark = mat(palette.dark), visor = mat(palette.visor, { emissive: palette.visor, emissiveIntensity: 0.65 });
  const geometry = new THREE.BoxGeometry(1, 1, 1), crouchParts = [], legs = [];
  const box = (size, position, material = armor, parent = group) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.scale.set(...size); mesh.position.set(...position); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const pose = (mesh, lowerBy, scaleY = 1) => { crouchParts.push({ mesh, y: mesh.position.y, height: mesh.scale.y, lowerBy, scaleY }); return mesh; };
  pose(box([0.48, 0.57, 0.29], [0, 1.07, 0], suit), 0.43, 0.7);
  pose(box([0.45, 0.36, 0.08], [0, 1.16, -0.18]), 0.46, 0.72);
  pose(box([0.33, 0.1, 0.1], [0, 1.0, -0.19], dark), 0.4);
  pose(box([0.43, 0.14, 0.29], [0, 0.74, 0], dark), 0.22);
  pose(box([0.34, 0.32, 0.32], [0, 1.59, 0]), 0.7);
  pose(box([0.30, 0.085, 0.035], [0, 1.62, -0.17], visor), 0.7);
  pose(box([0.38, 0.07, 0.35], [0, 1.75, -0.01], dark), 0.7);
  for (const side of [-1, 1]) {
    const arm = pose(box([0.15, 0.48, 0.16], [side * 0.30, 1.06, -0.09], suit), 0.44); arm.rotation.x = -0.42;
    pose(box([0.17, 0.18, 0.18], [side * 0.30, 1.27, 0]), 0.5);
    pose(box([0.16, 0.13, 0.17], [side * 0.3, 0.84, -0.18], dark), 0.3);
    const leg = new THREE.Group(); leg.position.set(side * 0.13, 0.72, 0); group.add(leg);
    box([0.18, 0.34, 0.21], [0, -0.17, 0], suit, leg);
    const knee = new THREE.Group(); knee.position.y = -0.34; leg.add(knee);
    box([0.16, 0.29, 0.18], [0, -0.145, 0], suit, knee); box([0.19, 0.12, 0.06], [0, -0.02, -0.12], armor, knee);
    box([0.2, 0.14, 0.28], [0, -0.31, -0.04], dark, knee); leg.userData.knee = knee; legs.push(leg);
  }
  if (outfit.id === 'runner') {
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.215, 12, 10), dark); hood.position.set(0, 1.58, 0.01); group.add(hood); pose(hood, 0.7);
    pose(box([0.29, 0.09, 0.04], [0, 1.62, -0.205], visor), 0.7);
    for (const side of [-1, 1]) pose(box([0.035, 0.35, 0.035], [side * 0.2, 1.14, -0.24], visor), 0.46, 0.72);
  } else if (outfit.id === 'hazmat' || outfit.id === 'orbital') {
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), armor); helmet.position.set(0, 1.58, 0); group.add(helmet); pose(helmet, 0.7);
    pose(box([0.29, 0.12, 0.04], [0, 1.62, -0.215], visor), 0.7);
    if (outfit.id === 'hazmat') {
      for (const side of [-1, 1]) {
        pose(box([0.08, 0.08, 0.06], [side * 0.10, 1.49, -0.20], dark), 0.7);
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.44, 10), dark); tank.position.set(side * 0.11, 1.1, 0.20); group.add(tank); pose(tank, 0.43, 0.7);
      }
      pose(box([0.10, 0.10, 0.025], [0, 1.18, -0.235], visor), 0.46, 0.72);
    } else {
      pose(box([0.32, 0.42, 0.14], [0, 1.13, 0.20], dark), 0.43, 0.7);
      pose(box([0.25, 0.18, 0.035], [0, 1.2, -0.235], dark), 0.46, 0.72);
      for (let i = 0; i < 3; i++) pose(box([0.035, 0.035, 0.04], [-0.07 + i * 0.07, 1.22, -0.26], visor), 0.46, 0.72);
    }
  } else if (outfit.id === 'retrobot') {
    pose(box([0.30, 0.16, 0.035], [0, 1.60, -0.185], dark), 0.7);
    for (const side of [-1, 1]) pose(box([0.055, 0.04, 0.04], [side * 0.07, 1.62, -0.21], visor), 0.7);
    for (let i = 0; i < 3; i++) pose(box([0.3, 0.035, 0.04], [0, 1.06 + i * 0.075, -0.235], dark), 0.46, 0.72);
    pose(box([0.06, 0.06, 0.04], [0, 1.35, -0.21], visor), 0.5);
  }
  const weapon = models.create(player.weaponId || 'rifle', player.skinId || 'standard', false, outfit.id); weapon.position.set(0.19, 1.05, -0.22); group.add(weapon);
  group.userData.outfitId = outfit.id;
  return { group, legs, weapon, crouchParts, crouchAmount: 0 };
}

export class OperatorPreview {
  constructor(canvas) {
    this.canvas = canvas; this.models = new WeaponModels(); this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#13212b');
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.02, 20); this.camera.position.set(2.2, 1.35, -3.2); this.camera.lookAt(0, 0.95, 0);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.4;
    this.scene.add(new THREE.HemisphereLight('#d4e9ff', '#384540', 3));
    const key = new THREE.DirectionalLight('#ffe3c5', 4); key.position.set(3, 4, 2); this.scene.add(key);
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
