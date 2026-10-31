import * as THREE from '/vendor/three.module.js';
import { getWeapon, getSkin, weaponModel } from '/shared/catalog.js';
import { getOutfit, getCharacter } from '/shared/outfits.js';
import { createViewmodelHands } from './viewmodel-hands.js';
import { createFirearmBody } from './firearm-design.js';
import { NETWORK_PROTOCOL } from '/shared/world.js';

export function disposeModel(group) {
  const geometries = new Set(), materials = new Set();
  group.traverse((child) => {
    if (child.geometry && !child.geometry.userData.operatorShared) geometries.add(child.geometry);
    if (child.material) for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
}

export class WeaponModels {
  constructor() { this.textures = new Map(); this.operatorGeometries = new Map(); }

  sharedOperatorGeometry(key, source) {
    if (!this.operatorGeometries.has(key)) { const geometry = source.clone(); geometry.userData.operatorShared = true; this.operatorGeometries.set(key, geometry); }
    return this.operatorGeometries.get(key);
  }

  skinTexture(skin) { return this.assetTexture(skin.pattern); }

  assetTexture(file) {
    if (!file) return null;
    if (!this.textures.has(file)) {
      const texture = new THREE.TextureLoader().load(`/assets/${file}?v=${NETWORK_PROTOCOL}`);
      texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1.8, 1.4); texture.anisotropy = 4; this.textures.set(file, texture);
    }
    return this.textures.get(file);
  }

  finishTexture(kind) {
    const key = `firearm-finish/${kind}`;
    if (!this.textures.has(key)) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; const ctx = canvas.getContext('2d');
      ctx.fillStyle = kind === 'wood' ? '#bba68b' : '#c3c3c3'; ctx.fillRect(0, 0, 256, 256);
      let seed = 761; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < 1600; i++) { const shade = Math.floor(80 + random() * 140); ctx.fillStyle = `rgba(${shade},${shade},${shade},.15)`; ctx.fillRect(random() * 256, random() * 256, kind === 'metal' ? 1 : 2, kind === 'metal' ? 8 + random() * 30 : 2); }
      if (kind === 'wood') for (let i = 0; i < 30; i++) { ctx.strokeStyle = '#57402e55'; ctx.lineWidth = 1 + i % 3; ctx.beginPath(); for (let x = 0; x <= 256; x += 8) ctx.lineTo(x, i * 9 + Math.sin(x / 44 + i) * 5); ctx.stroke(); }
      const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(kind === 'wood' ? 3 : 10, kind === 'wood' ? 2 : 10); texture.anisotropy = 4;
      texture.colorSpace = kind === 'wood' ? THREE.SRGBColorSpace : THREE.NoColorSpace; this.textures.set(key, texture);
    }
    return this.textures.get(key);
  }

  create(weaponId, skinId, firstPerson = false, outfitId = 'field', characterId = 'male') {
    const weapon = getWeapon(weaponId), skin = getSkin(skinId), group = new THREE.Group(), shape = weaponModel(weapon); group.name = `weapon-${weapon.id}`;
    const material = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .63, metalness: .35, ...(firstPerson ? { fog: false } : {}), ...options });
    const metal = this.finishTexture('metal'), polymer = this.finishTexture('polymer');
    const dark = new THREE.Color(skin.dark).lerp(new THREE.Color('#7e898d'), .12);
    const materials = {
      coat: material(skin.color, { map: this.skinTexture(skin), bumpMap: metal, bumpScale: .00016, roughnessMap: metal }),
      plate: material(new THREE.Color(skin.color).lerp(new THREE.Color('#ffffff'), .06), { metalness: .58, roughness: .53, roughnessMap: metal, bumpMap: metal, bumpScale: .00012 }),
      black: material(dark, { metalness: .55, roughness: .58, bumpMap: metal, bumpScale: .0001 }),
      steel: material('#899298', { metalness: .88, roughness: .38, roughnessMap: metal }),
      rubber: material(skin.dark, { metalness: 0, roughness: .94, bumpMap: polymer, bumpScale: .0003 }),
      accent: material(skin.accent, { metalness: .2, roughness: .7 }),
      brass: material('#b69b60', { metalness: .75, roughness: .4 }),
      wood: material(skin.id === 'standard' ? '#9b7049' : skin.color, { map: skin.pattern ? this.skinTexture(skin) : this.finishTexture('wood'), roughness: .8, metalness: .02 }),
      glass: material('#86c5cf', { transparent: true, opacity: .25, depthWrite: false, metalness: .25, roughness: .14 }),
      magazineGlass: material('#b4a57b', { transparent: true, opacity: .67, depthWrite: false, metalness: .05, roughness: .42 }),
      luminous: material(skin.accent, { emissive: skin.accent, emissiveIntensity: .7 }),
    };
    const { body, muzzleZ, aimHeight } = createFirearmBody(this, group, weapon, shape, materials);
    const used = new Set(); body.traverse((object) => { if (object.material) used.add(object.material); });
    for (const material of Object.values(materials)) if (!used.has(material)) material.dispose();
    if (firstPerson) createViewmodelHands(this, { group, shape, weaponId: weapon.id, outfit: getOutfit(outfitId), skin, character: getCharacter(characterId) });
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, .02, muzzleZ); group.add(muzzle);
    const flash = new THREE.Mesh(new THREE.ConeGeometry(shape === 'shotgun' ? .11 : .07, .23, 5), new THREE.MeshBasicMaterial({ color: '#ffda98', transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.rotation.x = -Math.PI / 2; flash.position.set(0, .02, muzzleZ - .10); flash.visible = false; group.add(flash);
    Object.assign(group.userData, { weaponId: weapon.id, modelBase: shape, skinId: skin.id, characterId: getCharacter(characterId).id, firearmBody: body, muzzle, flash, aimHeight, aimPoint: new THREE.Vector3(0, aimHeight, .015) });
    group.traverse((child) => { child.castShadow = !firstPerson; child.receiveShadow = !firstPerson; if (firstPerson) { child.renderOrder = 10; child.frustumCulled = false; } });
    return group;
  }

  dispose() { this.operatorGeometries.forEach((geometry) => geometry.dispose()); this.operatorGeometries.clear(); this.textures.forEach((texture) => texture.dispose()); this.textures.clear(); }
}

export class ArmoryPreview {
  constructor(canvas) {
    this.canvas = canvas; this.models = new WeaponModels(); this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#14202a');
    this.camera = new THREE.PerspectiveCamera(36, 1, .01, 10); this.camera.position.set(1.55, .48, 1.25); this.camera.lookAt(0, -.02, -.25);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.5;
    this.scene.add(new THREE.HemisphereLight('#d2eeff', '#283947', 3));
    const light = new THREE.DirectionalLight('#ffe6cf', 5); light.position.set(2, 3, 1); this.scene.add(light);
    const rim = new THREE.DirectionalLight('#85d9df', 3); rim.position.set(-2, 1, -2); this.scene.add(rim);
    this.resize = () => { const rect = canvas.getBoundingClientRect(); this.renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false); this.camera.aspect = rect.width / Math.max(1, rect.height); this.camera.updateProjectionMatrix(); };
    this.observer = new ResizeObserver(this.resize); this.observer.observe(canvas); this.resize();
    const animate = (time) => { if (this.stopped) return; this.frame = requestAnimationFrame(animate); if (this.model) this.model.rotation.y = -.15 + Math.sin(time / 3000) * .22; this.renderer.render(this.scene, this.camera); }; this.frame = requestAnimationFrame(animate);
  }
  set(weaponId, skinId) {
    if (this.model) { this.scene.remove(this.model); disposeModel(this.model); }
    this.model = this.models.create(weaponId, skinId); this.scene.add(this.model);
    this.camera.position.set(getWeapon(weaponId).type === 'SNIPER' ? 1.9 : getWeapon(weaponId).type === 'LMG' ? 1.65 : 1.45, .48, 1.25); this.camera.lookAt(0, -.01, -.25);
  }
  dispose() {
    this.stopped = true; cancelAnimationFrame(this.frame); this.observer.disconnect();
    if (this.model) disposeModel(this.model); this.models.dispose(); this.renderer.dispose();
  }
}
