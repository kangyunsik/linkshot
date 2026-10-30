import * as THREE from '/vendor/three.module.js';
import { getWeapon, getSkin } from '/shared/catalog.js';
import { getOutfit } from '/shared/outfits.js';

export function disposeModel(group) {
  const geometries = new Set(), materials = new Set();
  group.traverse((child) => {
    if (child.geometry) geometries.add(child.geometry);
    if (child.material) for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
}

export class WeaponModels {
  constructor() { this.textures = new Map(); }

  skinTexture(skin) {
    return this.assetTexture(skin.pattern);
  }

  assetTexture(file) {
    if (!file) return null;
    if (!this.textures.has(file)) {
      const texture = new THREE.TextureLoader().load(`/assets/${file}`);
      texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1.8, 1.4); texture.anisotropy = 4; this.textures.set(file, texture);
    }
    return this.textures.get(file);
  }

  create(weaponId, skinId, firstPerson = false, outfitId = 'field') {
    const weapon = getWeapon(weaponId), skin = getSkin(skinId), group = new THREE.Group();
    const material = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.46, metalness: 0.65, ...(firstPerson ? { depthTest: false, depthWrite: false, fog: false } : {}), ...options });
    const coat = material(skin.pattern ? new THREE.Color(skin.color).lerp(new THREE.Color('#ffffff'), 0.35) : skin.color, { map: this.skinTexture(skin) });
    const plate = material(skin.color), black = material(skin.dark), steel = material('#6f7b7f', { metalness: 0.9 });
    const accent = material(skin.accent), rubber = material(skin.dark, { roughness: 0.95, metalness: 0 });
    const luminous = material(skin.accent, { emissive: skin.accent, emissiveIntensity: 0.7 });
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const box = (size, position, mat = coat, parent = group) => {
      const mesh = new THREE.Mesh(boxGeometry, mat); mesh.scale.set(...size); mesh.position.set(...position); parent.add(mesh); return mesh;
    };
    const tube = (radius, length, position, mat = black) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), mat);
      mesh.rotation.x = Math.PI / 2; mesh.position.set(...position); group.add(mesh); return mesh;
    };
    const rail = (length, z, y = 0.083) => {
      box([0.115, 0.017, length], [0, y, z], black);
      for (let i = 0; i < length / 0.045; i++) box([0.12, 0.012, 0.014], [0, y + 0.015, z + length / 2 - i * 0.045], steel);
    };
    const holo = (y = 0.14, z = 0.015) => {
      box([0.07, 0.015, 0.10], [0, y - 0.04, z], black);
      for (const side of [-1, 1]) box([0.012, 0.08, 0.025], [side * 0.044, y, z], plate);
      box([0.1, 0.012, 0.025], [0, y + 0.04, z], plate);
      group.userData.reticle = box([0.002, 0.002, 0.008], [0, y, z + 0.006], luminous);
    };
    let muzzleZ, aimHeight = 0.14;

    if (weapon.id === 'rifle') {
      box([0.12, 0.135, 0.43], [0, 0, -0.04]);
      box([0.105, 0.11, 0.24], [0, -0.014, 0.23], rubber);
      box([0.13, 0.17, 0.045], [0, -0.027, 0.36], black);
      box([0.10, 0.1, 0.31], [0, 0.005, -0.38], plate); rail(0.54, -0.17); holo();
      for (const side of [-1, 1]) for (let i = 0; i < 5; i++) box([0.006, 0.022, 0.026], [side * 0.052, 0.012, -0.28 - i * 0.045], black);
      tube(0.021, 0.24, [0, 0.018, -0.64], steel); tube(0.032, 0.07, [0, 0.018, -0.78]); muzzleZ = -0.82;
      const mag = box([0.079, 0.23, 0.11], [0, -0.16, -0.1], accent); mag.rotation.x = -0.16;
      for (let i = 0; i < 3; i++) box([0.082, 0.013, 0.115], [0, -0.1 - i * 0.055, -0.1], black);
      box([0.008, 0.025, 0.10], [0.063, 0.015, -0.02], accent);
    } else if (weapon.id === 'smg') {
      box([0.115, 0.14, 0.32], [0, 0, -0.02]); box([0.11, 0.095, 0.16], [0, 0.02, -0.26], plate);
      for (const side of [-1, 1]) box([0.018, 0.018, 0.22], [side * 0.042, 0.01, 0.23], steel);
      box([0.11, 0.15, 0.035], [0, -0.03, 0.35], rubber); rail(0.33, -0.06); holo(0.14, 0.03);
      const mag = box([0.06, 0.27, 0.085], [0, -0.19, -0.025], accent); mag.rotation.x = -0.1;
      box([0.07, 0.02, 0.09], [0, -0.32, -0.04], black);
      tube(0.024, 0.18, [0, 0.02, -0.43], steel); tube(0.037, 0.055, [0, 0.02, -0.54]); muzzleZ = -0.58;
      for (let i = 0; i < 4; i++) box([0.006, 0.03, 0.019], [0.058, 0.02, -0.17 - i * 0.035], black);
      box([0.008, 0.045, 0.07], [0.06, -0.01, 0.07], luminous);
    } else if (weapon.id === 'shotgun') {
      box([0.13, 0.15, 0.36], [0, 0.005, 0]);
      box([0.11, 0.13, 0.26], [0, -0.01, 0.29], plate); box([0.13, 0.17, 0.04], [0, -0.015, 0.43], rubber);
      tube(0.04, 0.78, [0, 0.03, -0.56], steel); tube(0.032, 0.68, [0, -0.06, -0.5], accent);
      const pump = new THREE.Group(); pump.position.set(0, -0.025, -0.43); group.add(pump);
      box([0.14, 0.13, 0.24], [0, 0, 0], black, pump);
      for (let i = 0; i < 6; i++) box([0.15, 0.14, 0.013], [0, 0, 0.1 - i * 0.04], plate, pump);
      rail(0.28, 0.025); box([0.012, 0.055, 0.025], [0, 0.09, -0.9], luminous); aimHeight = 0.11; muzzleZ = -0.97;
      for (let i = 0; i < 4; i++) tube(0.016, 0.085, [0.078, 0.015, 0.1 - i * 0.06], accent);
      group.userData.pump = pump;
    } else if (weapon.id === 'sniper') {
      box([0.135, 0.15, 0.46], [0, 0, -0.04]); box([0.11, 0.12, 0.31], [0, -0.02, 0.32], plate);
      box([0.14, 0.19, 0.05], [0, -0.03, 0.49], rubber);
      box([0.1, 0.085, 0.42], [0, -0.01, -0.48], plate); rail(0.52, -0.15);
      tube(0.025, 0.62, [0, 0.02, -0.96], steel); tube(0.045, 0.11, [0, 0.02, -1.24]); muzzleZ = -1.3;
      for (const z of [-0.12, 0.08]) box([0.11, 0.07, 0.04], [0, 0.13, z], accent);
      tube(0.053, 0.38, [0, 0.195, -0.045]); tube(0.073, 0.10, [0, 0.195, -0.27], plate); tube(0.063, 0.09, [0, 0.195, 0.17], plate);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.053, 20), material('#7bd8dc', { metalness: 0.9, roughness: 0.08, emissive: '#24536a', emissiveIntensity: 0.6 })); lens.position.set(0, 0.195, 0.219); group.add(lens);
      const mag = box([0.08, 0.16, 0.14], [0, -0.135, -0.1], accent); mag.rotation.x = -0.07;
      tube(0.012, 0.1, [0.10, 0.025, 0.07], steel); box([0.045, 0.04, 0.035], [0.1, 0.02, 0.13], black);
      for (const side of [-1, 1]) { const leg = box([0.018, 0.22, 0.025], [side * 0.07, -0.13, -0.67], black); leg.rotation.z = side * 0.35; }
      aimHeight = 0.195;
    } else if (weapon.id === 'pistol') {
      const slide = new THREE.Group(); group.add(slide);
      box([0.09, 0.08, 0.35], [0, 0.035, -0.07], coat, slide);
      box([0.075, 0.055, 0.21], [0, -0.025, -0.02], plate);
      tube(0.018, 0.16, [0, 0.03, -0.27], steel); muzzleZ = -0.36;
      box([0.08, 0.026, 0.08], [0, -0.19, 0.13], accent);
      for (const side of [-1, 1]) box([0.012, 0.025, 0.02], [side * 0.026, 0.085, 0.06], black, slide);
      group.userData.reticle = box([0.006, 0.008, 0.012], [0, 0.085, -0.235], luminous, slide);
      for (let i = 0; i < 5; i++) box([0.003, 0.045, 0.009], [0.046, 0.035, 0.06 - i * 0.018], steel, slide);
      group.userData.slide = slide; aimHeight = 0.085;
    } else if (weapon.id === 'lmg') {
      box([0.17, 0.18, 0.50], [0, 0, -0.07]); box([0.13, 0.14, 0.29], [0, -0.01, 0.34], plate);
      box([0.15, 0.18, 0.045], [0, -0.02, 0.49], rubber);
      box([0.14, 0.13, 0.40], [0, 0, -0.51], plate); rail(0.70, -0.24); holo(0.16, 0.025);
      tube(0.032, 0.40, [0, 0.02, -0.84], steel); tube(0.045, 0.08, [0, 0.02, -1.04]); muzzleZ = -1.09;
      box([0.25, 0.24, 0.22], [-0.12, -0.18, -0.11], accent);
      box([0.27, 0.026, 0.24], [-0.12, -0.055, -0.11], black);
      for (let i = 0; i < 6; i++) tube(0.012, 0.10, [-0.16 + i * 0.027, -0.018, -0.1], steel);
      for (const side of [-1, 1]) { const leg = box([0.022, 0.25, 0.03], [side * 0.09, -0.15, -0.72], black); leg.rotation.z = side * 0.5; }
      aimHeight = 0.16;
    } else if (weapon.id === 'dmr') {
      box([0.13, 0.15, 0.45], [0, 0, -0.045]); box([0.11, 0.13, 0.29], [0, -0.015, 0.32], plate);
      box([0.13, 0.18, 0.045], [0, -0.025, 0.47], rubber); box([0.115, 0.035, 0.20], [0, 0.075, 0.31], accent);
      box([0.105, 0.10, 0.40], [0, 0, -0.46], plate); rail(0.58, -0.19); holo(0.16, 0.025);
      tube(0.023, 0.37, [0, 0.02, -0.83], steel); tube(0.034, 0.065, [0, 0.02, -1.02]); muzzleZ = -1.06;
      const mag = box([0.08, 0.18, 0.13], [0, -0.15, -0.08], accent); mag.rotation.x = -0.1;
      const optic = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.008, 8, 20), black); optic.position.set(0, 0.16, -0.045); group.add(optic);
      aimHeight = 0.16;
    }
    const grip = box([0.075, 0.17, 0.085], [0, -0.13, 0.13], rubber); grip.rotation.x = -0.25;
    box([0.008, 0.026, 0.08], [-0.07, 0.005, 0.02], accent);
    if (firstPerson) {
      const outfit = getOutfit(outfitId);
      const sleeve = material(outfit.id === 'field' ? skin.suit : outfit.suit, { roughness: 0.95, metalness: 0 });
      const rightArm = box([0.12, 0.12, 0.35], [0.08, -0.23, 0.30], sleeve); rightArm.rotation.x = -0.3; rightArm.rotation.z = 0.14;
      box([0.10, 0.12, 0.13], [0.055, -0.14, 0.14], rubber);
      const leftArm = box([0.1, 0.1, 0.32], [-0.14, -0.2, weapon.id === 'pistol' ? 0.14 : -0.17], sleeve); leftArm.rotation.y = -0.55; leftArm.rotation.x = -0.3;
      box([0.12, 0.09, 0.12], [-0.03, weapon.id === 'pistol' ? -0.14 : -0.09, weapon.id === 'pistol' ? 0.12 : -0.34], rubber);
    }
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, muzzleZ); group.add(muzzle);
    const flash = new THREE.Mesh(new THREE.ConeGeometry(weapon.id === 'shotgun' ? 0.11 : 0.07, 0.23, 5), new THREE.MeshBasicMaterial({ color: '#ffda98', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: !firstPerson }));
    flash.rotation.x = -Math.PI / 2; flash.position.set(0, 0.02, muzzleZ - 0.10); flash.visible = false; group.add(flash);
    Object.assign(group.userData, { weaponId: weapon.id, skinId: skin.id, muzzle, flash, aimHeight, aimPoint: new THREE.Vector3(0, aimHeight, 0.015) });
    group.traverse((child) => { child.castShadow = !firstPerson; child.receiveShadow = !firstPerson; if (firstPerson) { child.renderOrder = 10; child.frustumCulled = false; } });
    return group;
  }

  dispose() { this.textures.forEach((texture) => texture.dispose()); this.textures.clear(); }
}

export class ArmoryPreview {
  constructor(canvas) {
    this.canvas = canvas; this.models = new WeaponModels(); this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#14202a');
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.01, 10); this.camera.position.set(1.55, 0.48, 1.25); this.camera.lookAt(0, -0.02, -0.25);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.5;
    this.scene.add(new THREE.HemisphereLight('#d2eeff', '#283947', 3));
    const light = new THREE.DirectionalLight('#ffe6cf', 5); light.position.set(2, 3, 1); this.scene.add(light);
    const rim = new THREE.DirectionalLight('#85d9df', 3); rim.position.set(-2, 1, -2); this.scene.add(rim);
    this.resize = () => { const rect = canvas.getBoundingClientRect(); this.renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false); this.camera.aspect = rect.width / Math.max(1, rect.height); this.camera.updateProjectionMatrix(); };
    this.observer = new ResizeObserver(this.resize); this.observer.observe(canvas); this.resize();
    const animate = (time) => { if (this.stopped) return; this.frame = requestAnimationFrame(animate); if (this.model) this.model.rotation.y = -0.15 + Math.sin(time / 3000) * 0.22; this.renderer.render(this.scene, this.camera); }; this.frame = requestAnimationFrame(animate);
  }
  set(weaponId, skinId) {
    if (this.model) { this.scene.remove(this.model); disposeModel(this.model); }
    this.model = this.models.create(weaponId, skinId); this.scene.add(this.model);
    this.camera.position.set(getWeapon(weaponId).id === 'sniper' ? 1.8 : 1.45, 0.48, 1.25); this.camera.lookAt(0, -0.01, -0.25);
  }
  dispose() {
    this.stopped = true; cancelAnimationFrame(this.frame); this.observer.disconnect();
    if (this.model) disposeModel(this.model); this.models.dispose(); this.renderer.dispose();
  }
}
