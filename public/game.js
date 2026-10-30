import * as THREE from '/vendor/three.module.js';
import { RULES, getMap, hasLineOfSight, playerPose, damageBearing } from '/shared/world.js';
import { WEAPONS, getWeapon, getSkin, shotSpread } from '/shared/catalog.js';
import { EMPTY_INPUT, movePlayer, clamp, angleDelta } from '/shared/movement.js';
import { drawTacticalMap } from './map.js';
import { WeaponModels, disposeModel } from './weapon-model.js';
import { createOperator, poseOperator } from './operator-model.js';
import { getOutfit } from '/shared/outfits.js';
import { reconcileMovement } from './prediction.js';
import { drawBuildings } from './building-view.js';
import { CombatEffects } from './combat-effects.js';
import { AimRecoil } from './aim-recoil.js';

const $ = (id) => document.getElementById(id);
const lerp = THREE.MathUtils.lerp;
const clockText = (seconds) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

export function renderScoreboard(element, players, selfId) {
  const table = document.createElement('table'); table.className = 'score-table';
  const head = table.createTHead().insertRow();
  for (const title of ['#', 'OPERATOR', 'KILLS', 'DEATHS', 'K/D']) { const cell = document.createElement('th'); cell.textContent = title; head.append(cell); }
  const body = table.createTBody();
  [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).forEach((player, index) => {
    const row = body.insertRow(); if (player.id === selfId) row.className = 'self';
    row.insertCell().textContent = index + 1;
    const name = row.insertCell(); name.textContent = player.name;
    if (player.isBot || player.id === selfId) {
      const badge = document.createElement('span'); badge.className = player.isBot ? 'bot-badge' : 'you-badge'; badge.textContent = player.isBot ? 'BOT' : 'YOU'; name.append(badge);
    }
    row.insertCell().textContent = player.kills;
    row.insertCell().textContent = player.deaths;
    row.insertCell().textContent = (player.kills / Math.max(1, player.deaths)).toFixed(1);
  });
  element.replaceChildren(table);
}

function canvasTexture(width, height, paint) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function signTexture(title, subtitle, orange = false) {
  return canvasTexture(1024, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1b2c33'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = orange ? '#eb8053' : '#aac9c9'; ctx.fillRect(0, 0, 9, h);
    ctx.font = 'bold 104px Arial'; ctx.fillText(title, 50, 145);
    ctx.fillStyle = '#799399'; ctx.font = '22px monospace'; ctx.fillText(subtitle, 55, 205);
    ctx.strokeStyle = '#476068'; ctx.strokeRect(20, 20, w - 40, h - 40);
    ctx.fillStyle = '#de7b51'; for (let i = 0; i < 5; i++) ctx.fillRect(w - 80 - i * 12, h - 56, 5, 16);
  });
}

export class FPSGame {
  constructor({ canvas, minimap, settings, audio, send, onMenu, onFatal, mapId, weaponId = 'rifle', skinId = 'standard', outfitId = 'field' }) {
    this.canvas = canvas; this.minimap = minimap; this.settings = settings; this.audio = audio;
    this.send = send; this.onMenu = onMenu; this.onFatal = onFatal;
    this.abort = new AbortController(); this.keys = new Set(); this.remote = new Map(); this.effects = [];
    this.players = []; this.selfId = null; this.local = null; this.predicted = null; this.room = null;
    this.aimRecoil = new AimRecoil();
    this.yaw = 0; this.pitch = 0; this.fireHeld = false; this.ads = false; this.disposed = false;
    this.lastFire = 0; this.lastSend = 0; this.lastMap = 0; this.lastScoreboard = 0; this.stepDistance = 0;
    this.reloadPressedUntil = 0; this.jumpPressedUntil = 0; this.recoil = 0; this.muzzleUntil = 0; this.serverOffset = 0; this.hadReload = false;
    this.world = getMap(mapId); this.skinId = getSkin(skinId).id; this.requestedWeaponId = getWeapon(weaponId).id;
    this.outfitId = getOutfit(outfitId).id;
    this.models = new WeaponModels(); this.fireLatched = false; this.switchAnimation = 0; this.localNextFire = 0;
    this.damageDirections = [];
    this.firePressedUntil = 0;
    this.hud = Object.fromEntries(['hud-health', 'hud-ammo', 'hud-timer', 'hud-kd', 'health-fill', 'respawn-overlay', 'respawn-count', 'crosshair', 'reload-indicator', 'reload-hint', 'protection-hint', 'damage-vignette', 'hitmarker', 'kill-confirmation', 'hud-fps'].map((id) => [id, $(id)]));
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor('#192e3b'); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(this.world.sky); this.scene.fog = new THREE.FogExp2(this.world.sky, 0.48 / Math.max(this.world.width, this.world.depth));
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.04, Math.max(this.world.width, this.world.depth) * 3); this.camera.rotation.order = 'YXZ'; this.scene.add(this.camera);
    this.boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.materials = {};
    this.makeWorld(); this.makeWeapon(); this.applySettings(); this.resize(); this.bindInput();
    this.combat = new CombatEffects(this.scene, this.models, this.world);
    this.previousFrame = performance.now(); this.fpsTime = this.previousFrame; this.fpsFrames = 0;
    this.animate = this.animate.bind(this); this.frameId = requestAnimationFrame(this.animate);
  }

  get pitch() { return this.aimRecoil.pitch; }
  set pitch(value) { this.aimRecoil.reset(value); }
  get locked() { return document.pointerLockElement === this.canvas; }
  get serverNow() { return Date.now() + this.serverOffset; }

  material(name, color, options = {}) {
    return this.materials[name] ||= new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.3, ...options });
  }

  box(parent, size, position, material, shadows = true) {
    const mesh = new THREE.Mesh(this.boxGeometry, material);
    mesh.scale.set(...size); mesh.position.set(...position); mesh.castShadow = shadows; mesh.receiveShadow = shadows;
    parent.add(mesh); return mesh;
  }

  makeWorld() {
    const world = this.world, halfW = world.width / 2, halfD = world.depth / 2;
    const hemi = new THREE.HemisphereLight('#bbdfe8', '#3e332e', 2.2); this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(world.light, 3.5); this.sun.position.set(-world.width * 0.33, Math.max(world.width, world.depth) * 0.65, world.depth * 0.3); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.camera.left = -halfW - 8; this.sun.shadow.camera.right = halfW + 8;
    this.sun.shadow.camera.top = halfD + 8; this.sun.shadow.camera.bottom = -halfD - 8; this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = Math.max(world.width, world.depth) * 2.5;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.035; this.scene.add(this.sun);
    const blueLight = new THREE.DirectionalLight('#a5d5ed', 0.7); blueLight.position.set(12, 14, -18); this.scene.add(blueLight);
    const loader = new THREE.TextureLoader();
    this.panelTexture = loader.load('/assets/foundry-panel.png'); this.panelTexture.colorSpace = THREE.SRGBColorSpace;
    this.panelTexture.wrapS = this.panelTexture.wrapT = THREE.RepeatWrapping; this.panelTexture.repeat.set(2, 1);
    this.panelTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const concrete = canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#566064'; ctx.fillRect(0, 0, w, h);
      let seed = 7021; const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 14000; i++) { const v = Math.floor(64 + random() * 75); ctx.fillStyle = `rgba(${v},${v},${v},.13)`; ctx.fillRect(random() * w, random() * h, 2, 2); }
      ctx.strokeStyle = '#202c3244'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);
      ctx.fillStyle = '#87939511'; for (let i = 0; i < 10; i++) ctx.fillRect(0, i * 50, w, 1);
    });
    concrete.wrapS = concrete.wrapT = THREE.RepeatWrapping; concrete.repeat.set(world.width / 4, world.depth / 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(world.width + 24, world.depth + 24), this.material('floor', world.ground, { map: concrete, metalness: 0.1 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    const dark = this.material('dark', world.theme === 'snow' ? '#728c99' : '#263c46'), edge = this.material('edge', world.theme === 'snow' ? '#6e8794' : '#213038'), orange = this.material('orange', world.accent);
    const slate = this.material('slate', world.theme === 'snow' ? '#bdced3' : world.theme === 'desert' ? '#ae9278' : '#4c646e'), wall = this.material('wall', world.wall);
    const stripe = this.material('stripe', '#df9860', { roughness: 0.85, metalness: 0.05 });
    const glow = this.material('glow', '#7ad6d4', { emissive: '#70ced0', emissiveIntensity: 1.4 });
    const orangeGlow = this.material('orange-glow', '#ff9e5c', { emissive: '#ff6a2e', emissiveIntensity: 2 });
    for (const data of world.obstacles) {
      if (data.buildingId) continue;
      const group = new THREE.Group(); group.position.set(data.x, data.y, data.z); this.scene.add(group);
      const baseMaterial = data.kind === 'wall' ? wall : data.color === 'orange' ? orange : slate;
      this.box(group, [data.w, data.h, data.d], [0, data.h / 2, 0], data.kind === 'reactor' ? this.material('reactor', '#6e8282', { map: this.panelTexture }) : baseMaterial);
      if (data.kind === 'container') {
        for (let x = -data.w / 2 + 0.3; x < data.w / 2; x += 0.62) for (const side of [-1, 1]) this.box(group, [0.065, data.h - 0.25, 0.07], [x, data.h / 2, side * (data.d / 2 + 0.025)], baseMaterial);
        for (const y of [0.1, data.h - 0.1]) this.box(group, [data.w + 0.06, 0.14, data.d + 0.05], [0, y, 0], edge);
        for (const x of [-data.w / 2, data.w / 2]) this.box(group, [0.14, data.h, data.d + 0.06], [x, data.h / 2, 0], edge);
        this.box(group, [0.65, 0.16, 0.025], [data.w / 2 - 1, 1.7, data.d / 2 + 0.045], stripe, false);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(1.8, data.w - 0.4), 0.45), new THREE.MeshBasicMaterial({ map: signTexture(data.color === 'orange' ? '07 / CARGO' : world.title, 'RESTRICTED ACCESS', true) }));
        sign.position.set(-data.w / 2 + 1.5, 1.85, data.d / 2 + 0.05); group.add(sign);
      } else if (data.kind === 'crate') {
        for (const x of [-1, 1]) for (const z of [-1, 1]) this.box(group, [0.12, data.h, 0.12], [x * (data.w / 2 - 0.02), data.h / 2, z * (data.d / 2 - 0.02)], edge);
        this.box(group, [data.w + 0.05, 0.13, data.d + 0.05], [0, data.h - 0.08, 0], dark);
        this.box(group, [data.w - 0.3, 0.13, 0.035], [0, 0.28, data.d / 2 + 0.03], stripe, false);
        for (const x of [-0.3, 0.3]) this.box(group, [0.14, data.h - 0.4, 0.04], [x * data.w, data.h / 2, data.d / 2 + 0.03], edge);
      } else if (data.kind === 'step' || data.kind === 'platform') {
        this.box(group, [data.w + 0.03, 0.06, 0.09], [0, data.h + 0.015, -data.d / 2 + 0.05], stripe, false);
        if (data.kind === 'platform') {
          for (const x of [-1, 1]) this.box(group, [0.09, 0.035, data.d], [x * (data.w / 2 - 0.1), data.h + 0.015, 0], glow, false);
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.35), new THREE.MeshBasicMaterial({ map: signTexture('HIGH GROUND', 'WALK UP / SPACE TO JUMP', true) })); sign.position.set(0, 0.8, data.d / 2 + 0.025); group.add(sign);
        }
      } else if (data.kind === 'wall') {
        this.box(group, [data.w + 0.08, 0.18, data.d + 0.08], [0, data.h - 0.1, 0], edge);
        this.box(group, [data.w + 0.025, 0.08, data.d + 0.025], [0, 1, 0], slate, false);
        if (data.w > data.d) for (let x = -halfW + 3; x < halfW; x += 6.5) this.box(group, [0.24, data.h + 0.5, data.d + 0.15], [x, data.h / 2, 0], edge);
        else for (let z = -halfD + 3; z < halfD; z += 6.5) this.box(group, [data.w + 0.15, data.h + 0.5, 0.24], [0, data.h / 2, z], edge);
      } else if (data.kind === 'building') {
        this.box(group, [data.w + 0.15, 0.18, data.d + 0.15], [0, data.h - 0.08, 0], dark);
        for (const side of [-1, 1]) {
          for (let x = -data.w / 2 + 1.3; x < data.w / 2 - 0.5; x += 2.5) {
            this.box(group, [1.1, 0.85, 0.04], [x, data.h - 1.5, side * (data.d / 2 + 0.03)], dark, false);
            this.box(group, [0.7, 0.06, 0.05], [x, data.h - 1.3, side * (data.d / 2 + 0.055)], glow, false);
          }
          this.box(group, [1.4, 2.1, 0.05], [0, 1.05, side * (data.d / 2 + 0.035)], edge);
          this.box(group, [data.w, 0.10, 0.06], [0, 0.45, side * (data.d / 2 + 0.035)], orange, false);
        }
      } else if (data.kind === 'reactor') {
        this.box(group, [5.15, 0.22, 5.15], [0, 0.15, 0], dark);
        this.box(group, [5.15, 0.17, 5.15], [0, data.h - 0.1, 0], dark);
        for (const side of [-1, 1]) {
          this.box(group, [0.16, 2.6, 5.1], [side * 2.4, 2, 0], edge);
          this.box(group, [3.5, 0.08, 0.03], [0, 2.8, side * 2.51], glow, false);
          for (let j = -1; j <= 1; j++) this.box(group, [0.12, 1.8, 0.04], [j * 0.9, 1.5, side * 2.52], edge);
        }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.07, 8, 40), glow); ring.rotation.x = Math.PI / 2; ring.position.y = data.h + 0.08; group.add(ring);
        this.reactorRing = ring;
      }
    }

    drawBuildings(this.scene, world, this.material.bind(this));
    // Painted floor guides and hazard markings are decorative, never hidden collision.
    const paint = new THREE.MeshBasicMaterial({ color: '#e4ab74', transparent: true, opacity: 0.45, depthWrite: false });
    const floorStripe = (x, z, w, d, material = paint) => { const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material); mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, 0.008, z); this.scene.add(mesh); };
    for (const x of [-halfW + 2.5, halfW - 2.5]) for (let z = -halfD + 4; z <= halfD - 4; z += 3) floorStripe(x, z, 0.07, 1.4);
    for (const z of [-halfD + 2.5, halfD - 2.5]) for (let x = -halfW + 4; x <= halfW - 4; x += 3) floorStripe(x, z, 1.4, 0.07);
    for (const side of [-1, 1]) { floorStripe(side * 3.7, 0, 0.12, 8); floorStripe(0, side * 3.7, 7.5, 0.12); }
    for (let i = -3; i <= 3; i++) for (const side of [-1, 1]) { const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 1.0), paint); mark.rotation.x = -Math.PI / 2; mark.rotation.z = -0.5; mark.position.set(i * 0.75, 0.012, side * 4.5); this.scene.add(mark); }
    this.lamps = [];
    if (world.theme === 'rail') for (const x of [-7, 7]) {
      for (const side of [-1, 1]) this.box(this.scene, [0.075, 0.045, world.depth - 8], [x + side * 0.85, 0.026, 0], slate, false);
      for (let z = -halfD + 5; z < halfD - 4; z += 1.6) floorStripe(x, z, 2.4, 0.16);
    }
    if (world.theme === 'city' || world.theme === 'desert') for (let x = -halfW + 6; x < halfW - 5; x += 5) floorStripe(x, 0, 2, 0.09);
    for (const z of [-halfD + 0.1, halfD - 0.1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(12, world.width * 0.35), 3), new THREE.MeshBasicMaterial({ map: signTexture(world.name, 'LOCAL OPERATIONS   —   NO UNAUTHORIZED ENTRY', true) }));
      sign.position.set(-world.width * 0.12, 4.5, z); if (z > 0) sign.rotation.y = Math.PI; this.scene.add(sign);
      const art = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3), this.material('art-panel', '#a7b6bd', { map: this.panelTexture }));
      art.position.set(world.width * 0.32, 4.5, z); if (z > 0) art.rotation.y = Math.PI; this.scene.add(art);
      for (const x of [-world.width * 0.38, world.width * 0.14, world.width * 0.43]) {
        this.box(this.scene, [0.7, 0.12, 0.2], [x, 5.8, z], orangeGlow, false);
        const lamp = new THREE.PointLight('#ffb67a', 3, 8, 2); lamp.position.set(x, 5.5, z > 0 ? z - 0.6 : z + 0.6); this.scene.add(lamp); this.lamps.push(lamp);
      }
    }
    // Distant silhouettes give the small playable arena a larger industrial setting.
    const skyline = this.material('skyline', '#293e48', { roughness: 1 });
    for (let i = 0; i < 16; i++) {
      const x = -halfW - 12 + i * (world.width + 24) / 15, h = 9 + ((i * 7) % 15);
      if (world.theme === 'snow' || world.theme === 'desert') {
        const mountain = new THREE.Mesh(new THREE.ConeGeometry(7 + i % 6, h + 5, 5), this.material('mountains', world.theme === 'snow' ? '#b4ced9' : '#916b51'));
        mountain.position.set(x, (h + 5) / 2, -halfD - 14 - (i % 3) * 3); this.scene.add(mountain);
      } else this.box(this.scene, [3 + i % 4, h, 5], [x, h / 2, -halfD - 8 - (i % 3) * 4], skyline, false);
    }
    for (const x of [-halfW - 5, halfW + 5]) {
      this.box(this.scene, [0.6, 13, 0.6], [x, 6.5, halfD * 0.6], orange);
      this.box(this.scene, [0.6, 13, 0.6], [x, 6.5, -halfD * 0.7], orange);
      this.box(this.scene, [0.65, 0.65, world.depth * 0.7], [x, 13, 0], orange);
    }
    const dustGeometry = new THREE.BufferGeometry(); const dustPositions = [];
    for (let i = 0; i < 110; i++) dustPositions.push(Math.sin(i * 7.6) * halfW, 0.5 + (i % 20) * 0.4, Math.cos(i * 3.2) * halfD);
    dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dustPositions, 3));
    this.dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: '#c6d4ca', size: 0.035, transparent: true, opacity: 0.3, depthWrite: false })); this.scene.add(this.dust);
  }

  makeWeapon() {
    this.weapon = new THREE.Group(); this.camera.add(this.weapon); this.weaponModels = new Map();
    $('weapon-slots').replaceChildren();
    $('weapon-slots').style.setProperty('--weapon-count', WEAPONS.length);
    for (const weapon of WEAPONS) {
      const model = this.models.create(weapon.id, this.skinId, true, this.outfitId); model.visible = false;
      this.weapon.add(model); this.weaponModels.set(weapon.id, model);
      const slot = document.createElement('div'); slot.className = 'weapon-slot'; slot.dataset.weapon = weapon.id;
      const key = document.createElement('kbd'); key.textContent = weapon.slot;
      const name = document.createElement('b'); name.textContent = weapon.name;
      const count = document.createElement('small'); count.textContent = weapon.magazine;
      slot.append(key, name, count); $('weapon-slots').append(slot);
    }
    this.muzzleLight = new THREE.PointLight('#ffad60', 0, 5); this.camera.add(this.muzzleLight); this.muzzleLight.position.set(0.2, -0.15, -0.75);
    this.weapon.position.set(0.25, -0.23, -0.43); this.activateWeapon(this.requestedWeaponId);
  }

  activateWeapon(id) {
    if (this.activeWeaponId === id) return;
    this.activeWeaponId = getWeapon(id).id;
    for (const [weaponId, model] of this.weaponModels) model.visible = weaponId === this.activeWeaponId;
    this.activeModel = this.weaponModels.get(this.activeWeaponId); this.muzzleFlash = this.activeModel.userData.flash;
    this.recoil = 0; this.switchAnimation = 1; this.muzzleUntil = 0; this.hadReload = false; this.localBurstLeft = 0; this.predictedShots = [];
    this.aimRecoil.reset(this.aimRecoil.aimPitch);
  }

  playLocalShot(weapon, now, predicted = true) {
    this.audio.shot(1, 0, weapon.id); this.recoil = weapon.recoil; this.muzzleUntil = now + 40; this.lastFire = now;
    this.localFirePending = false;
    if (predicted) { this.predictedShots.push({ id: weapon.id, at: now }); while (this.predictedShots.length > 32) this.predictedShots.shift(); }
    if (weapon.type === 'SNIPER') { this.ads = false; $('scope-overlay').hidden = true; $('ads-reticle').hidden = true; }
    if (this.local?.hp > 0) {
      this.aimRecoil.kick(weapon.recoil * (weapon.type === 'ASSAULT' ? 0.008 : 0.0045), now); this.camera.rotation.x = this.pitch; this.send(this.input());
    }
    this.muzzleFlash.rotation.y = Math.random() * Math.PI;
  }

  selectWeapon(id) {
    if (!this.local || this.local.hp > 0 || this.room?.phase !== 'active') return;
    this.send({ type: 'loadout', weaponId: getWeapon(id).id, open: false });
    this.closeLoadout(false);
    this.lock();
  }

  openLoadout() {
    if (!this.local || this.local.hp > 0 || this.room?.phase !== 'active') return;
    this.loadoutOpen = true; this.clearInput(); this.send({ type: 'loadout', open: true });
    if (this.locked) document.exitPointerLock();
    $('pause-overlay').hidden = true; $('respawn-loadout').hidden = false;
  }

  closeLoadout(notify = true) {
    this.loadoutOpen = false; $('respawn-loadout').hidden = true;
    if (notify && this.local?.hp <= 0) { this.send({ type: 'loadout', open: false }); this.lock(); }
  }

  makeAvatar(player) {
    const operator = createOperator(player, this.models), { group } = operator;
    const labelTexture = canvasTexture(512, 64, (ctx) => {
      ctx.font = '500 24px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#bfcfd3'; ctx.fillText(`${player.name}${player.isBot ? '  / BOT' : ''}`, 256, 40);
    });
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, opacity: 0.8, depthWrite: false })); label.position.y = 2.15; label.scale.set(2.6, 0.325, 1); group.add(label);
    group.position.set(player.x, player.y, player.z); group.rotation.y = player.yaw; this.scene.add(group);
    const shield = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.02, 8, 32), new THREE.MeshBasicMaterial({ color: '#82d9ff', transparent: true, opacity: 0.75, depthWrite: false })); shield.rotation.x = -Math.PI / 2; shield.position.y = 0.035; shield.name = 'spawn-shield'; group.add(shield);
    return { ...operator, label, shield, target: player, lastX: player.x, lastZ: player.z, flashUntil: 0 };
  }

  bindInput() {
    const options = { signal: this.abort.signal };
    window.addEventListener('resize', () => this.resize(), options);
    document.addEventListener('mousemove', (event) => {
      if (!this.locked) return;
      const sensitivity = this.settings.sensitivity * 0.0020 * (this.ads ? getWeapon(this.activeWeaponId).type === 'SNIPER' ? Math.max(0.25, getWeapon(this.activeWeaponId).zoom) : 0.67 : 1);
      this.yaw -= event.movementX * sensitivity;
      this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
      this.aimRecoil.move(-event.movementY * sensitivity);
    }, options);
    document.addEventListener('mousedown', (event) => {
      if (!this.locked) return;
      if (event.button === 0) { this.fireHeld = true; this.localFirePending = true; this.firePressedUntil = performance.now() + 150; this.send(this.input()); }
      if (event.button === 2) this.ads = true;
    }, options);
    document.addEventListener('mouseup', (event) => { if (event.button === 0) { this.fireHeld = false; this.fireLatched = false; if (this.locked) this.send(this.input()); } if (event.button === 2) this.ads = false; }, options);
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault(), options);
    this.canvas.addEventListener('wheel', (event) => {
      if (!this.locked || !event.deltaY) return;
      event.preventDefault();
      // No live switching, including wheel input.
    }, { ...options, passive: false });
    document.addEventListener('keydown', (event) => {
      if (event.target.matches('input, select, textarea') || document.querySelector('dialog[open]')) return;
      if (event.code === 'KeyE' && !event.repeat && this.local?.hp <= 0) { event.preventDefault(); this.loadoutOpen ? this.closeLoadout() : this.openLoadout(); return; }
      if (event.code === 'Escape' && this.loadoutOpen) { event.preventDefault(); this.closeLoadout(); return; }
      if (this.loadoutOpen) {
        const item = WEAPONS.find((weapon) => weapon.slot <= 10 && (`Digit${weapon.slot % 10}` === event.code || `Numpad${weapon.slot % 10}` === event.code));
        if (item && !event.repeat) { event.preventDefault(); this.selectWeapon(item.id); }
        return;
      }
      if (event.code === 'Tab' && this.room?.phase === 'active') { event.preventDefault(); $('scoreboard-overlay').hidden = false; renderScoreboard($('scoreboard-table'), this.players, this.selfId); }
      if (!this.locked) return;
      if (/^(Digit|Numpad)\d$/.test(event.code)) event.preventDefault();
      if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'ControlLeft', 'ControlRight', 'Tab'].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (event.code === 'Space' && !event.repeat) { this.jumpPressedUntil = performance.now() + 120; this.send(this.input()); }
      if (event.code === 'KeyR' && !event.repeat) this.reloadPressedUntil = performance.now() + 180;
      if (event.code === 'KeyF' && !event.repeat) {
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        else this.canvas.parentElement.requestFullscreen?.().catch(() => {});
      }
    }, options);
    document.addEventListener('keyup', (event) => { this.keys.delete(event.code); if (event.code === 'Tab') $('scoreboard-overlay').hidden = true; }, options);
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) this.clearInput();
      if (this.room?.phase !== 'ended' && !this.loadoutOpen && this.local?.hp > 0) this.onMenu(!this.locked);
    }, options);
    window.addEventListener('blur', () => { this.clearInput(); if (this.locked) document.exitPointerLock(); }, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.clearInput(); if (this.locked) document.exitPointerLock(); } }, options);
    this.canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); this.onFatal('그래픽 연결이 중단되었습니다. 페이지를 새로고침한 후 다시 참가해 주세요.'); }, options);
    $('respawn-loadout-close').addEventListener('click', () => this.closeLoadout(), options);
    $('respawn-weapon-choices').replaceChildren();
    for (const weapon of WEAPONS) {
      const button = document.createElement('button'); button.className = 'respawn-weapon'; button.dataset.weapon = weapon.id;
      const number = document.createElement('kbd'); number.textContent = weapon.slot <= 10 ? weapon.slot % 10 : '선택';
      const title = document.createElement('strong'); title.textContent = weapon.name;
      const label = document.createElement('small'); label.textContent = `${weapon.label} · ${weapon.magazine}발`;
      button.append(number, title, label); button.addEventListener('click', () => this.selectWeapon(weapon.id), options); $('respawn-weapon-choices').append(button);
    }
    document.querySelector('.respawn-loadout-card>small').textContent = '사망 후 최대 15초 대기 · 목록을 클릭해 선택 · 처음 10종은 숫자 1–9, 0 지원';
  }

  clearInput() {
    this.keys.clear(); this.fireHeld = false; this.localFirePending = false; this.firePressedUntil = 0; this.ads = false; this.reloadPressedUntil = 0; this.jumpPressedUntil = 0; this.localBurstLeft = 0;
    $('scoreboard-overlay').hidden = true;
    this.send({ type: 'input', ...EMPTY_INPUT, yaw: this.yaw, pitch: this.pitch, weaponId: this.requestedWeaponId });
  }

  async lock() {
    if (this.disposed) return;
    // Request synchronously inside the click/key gesture. Waiting for an audio
    // device to resume can consume user activation and strand a respawn unlocked.
    const audioReady = this.audio.unlock();
    try { if (!this.locked) await this.canvas.requestPointerLock(); await audioReady; if (this.disposed && this.locked) document.exitPointerLock(); } catch {
      if (this.disposed) return;
      this.onMenu(true); this.onFatal('마우스 잠금을 허용한 뒤 다시 눌러 주세요. 다른 브라우저 탭에서 돌아왔다면 한 번 더 클릭해 주세요.', false);
    }
  }

  applySettings() {
    this.renderer.setPixelRatio(this.settings.quality === 'low' ? 0.75 : Math.min(window.devicePixelRatio, 1.65));
    this.renderer.shadowMap.enabled = this.settings.quality !== 'low';
    this.sun.castShadow = this.settings.quality !== 'low';
    for (const lamp of this.lamps) lamp.visible = this.settings.quality !== 'low';
    this.resize();
  }

  resize() {
    const width = window.innerWidth, height = window.innerHeight;
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height, false);
  }

  applySnapshot(data, id = this.selfId) {
    if (this.disposed) return;
    this.selfId = id; this.room = data.room; this.players = data.players;
    this.serverOffset = data.serverTime - Date.now();
    const local = data.players.find((p) => p.id === id);
    if (!local) return;
    const respawned = !this.local || (this.local.hp <= 0 && local.hp > 0) || data.events.some((e) => e.type === 'restart');
    if (this.local?.hp > 0 && local.hp <= 0) this.deathAt = performance.now();
    if (!this.predicted || respawned) {
      this.closeLoadout(false);
      if (this.local && this.local.hp <= 0 && local.hp > 0) this.onMenu(!this.locked);
      this.predicted = { ...local, jumpHeld: false }; this.yaw = local.yaw; this.pitch = local.pitch; this.recoil = 0;
      this.requestedWeaponId = local.weaponId; this.localNextFire = 0; this.fireLatched = false;
      this.clearInput();
      this.clearDamageDirections();
    } else {
      reconcileMovement(this.predicted, local, this.world);
    }
    this.local = local;
    this.predicted.weaponId = local.weaponId;
    this.predicted.shotHeat = local.shotHeat || 0;
    this.activateWeapon(local.weaponId);
    const present = new Set();
    for (const player of data.players) {
      if (player.id === id) continue;
      present.add(player.id);
      if (!this.remote.has(player.id)) this.remote.set(player.id, this.makeAvatar(player));
      const avatar = this.remote.get(player.id); avatar.target = player;
      avatar.targetTime = data.serverTime; avatar.renderTime ??= data.serverTime;
      if (avatar.weapon.userData.weaponId !== player.weaponId) {
        avatar.group.remove(avatar.weapon); disposeModel(avatar.weapon);
        avatar.weapon = this.models.create(player.weaponId, player.skinId); avatar.weapon.position.set(0.19, 1.05, -0.22); avatar.group.add(avatar.weapon);
      }
    }
    for (const [remoteId, avatar] of this.remote) if (!present.has(remoteId)) { this.scene.remove(avatar.group); this.disposeObject(avatar.group, false); this.remote.delete(remoteId); }
    this.updateHud();
    for (const event of data.events) this.handleEvent(event);
    if (data.room.phase === 'ended') {
      this.closeLoadout(false);
      this.clearInput(); if (this.locked) document.exitPointerLock();
      $('pause-overlay').hidden = true; $('round-overlay').hidden = false; $('respawn-overlay').hidden = true;
      const winner = data.players.find((player) => player.id === data.room.result?.winnerId) || [...data.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0];
      $('round-winner').textContent = winner ? `${data.room.result?.winnerName || winner.name} · ${data.room.result?.winnerKills ?? winner.kills} KILLS · 이번 라운드의 최고 기록` : '';
      $('restart-button').hidden = data.room.hostId !== id; $('wait-host').hidden = data.room.hostId === id;
      renderScoreboard($('round-table'), data.players, id);
    } else if (!$('round-overlay').hidden) {
      $('round-overlay').hidden = true; this.onMenu(true);
    }
  }

  updateHud() {
    const local = this.local, weapon = getWeapon(local.weaponId), lowAmmo = local.ammo <= Math.ceil(weapon.magazine * 0.2);
    this.hud['hud-health'].textContent = local.hp;
    this.hud['health-fill'].style.width = `${local.hp}%`;
    this.hud['health-fill'].style.background = local.hp < 35 ? '#ff7057' : '#a3dbc9';
    this.hud['hud-ammo'].textContent = local.ammo.toString().padStart(2, '0');
    this.hud['hud-ammo'].style.color = lowAmmo ? '#ff876a' : '';
    this.hud['hud-timer'].textContent = clockText(this.room.timeLeft);
    $('hud-frag-limit').textContent = `FIRST TO ${this.room.fragLimit}`;
    this.hud['hud-timer'].style.color = this.room.timeLeft < 30 ? '#ff876a' : '';
    this.hud['hud-kd'].textContent = `${local.kills} K  /  ${local.deaths} D`;
    const reloading = local.reloadUntil > this.serverNow;
    if (reloading || local.hp <= 0) this.localBurstLeft = 0;
    this.hud['reload-indicator'].hidden = !reloading || local.hp <= 0;
    this.hud['reload-hint'].textContent = reloading ? 'RELOADING...' : local.switchUntil > this.serverNow ? 'EQUIPPING...' : lowAmmo ? '[ R ] 재장전' : `${weapon.caliber} · ${weapon.type}`;
    $('hud-weapon-name').textContent = weapon.name; $('hud-weapon-action').textContent = weapon.action;
    $('hud-skin-name').textContent = getSkin(local.skinId).name;
    $('hud-stance').hidden = !local.crouching || local.hp <= 0;
    $('hud-map-name').textContent = this.world.name; $('scoreboard-map-name').textContent = this.world.name;
    this.hud['reload-indicator'].querySelector('i').style.animationDuration = `${weapon.reloadSeconds}s`;
    for (const slot of $('weapon-slots').children) {
      slot.classList.toggle('selected', slot.dataset.weapon === local.weaponId);
      slot.querySelector('small').textContent = local.magazines[slot.dataset.weapon];
    }
    if (reloading && !this.hadReload) this.audio.reload(); this.hadReload = reloading;
    this.hud['respawn-overlay'].hidden = local.hp > 0 || this.room.phase === 'ended';
    $('respawn-next-weapon').textContent = `${getWeapon(local.nextWeaponId || local.weaponId).name} · 다음 부활 장비`;
    for (const choice of $('respawn-weapon-choices').children) choice.classList.toggle('selected', choice.dataset.weapon === (local.nextWeaponId || local.weaponId));
    this.hud['crosshair'].style.opacity = local.hp <= 0 ? '0' : this.ads ? '0.25' : '1';
    if (!$('scoreboard-overlay').hidden) renderScoreboard($('scoreboard-table'), this.players, this.selfId);
    $('hud-room-code').textContent = this.room.code;
  }

  handleEvent(event) {
    if (event.type === 'shot') {
      let origin = event.origin;
      if (event.id === this.selfId && this.weapon) {
        const now = performance.now();
        while (this.predictedShots[0]?.at < now - 700) this.predictedShots.shift();
        const predicted = this.predictedShots.findIndex((shot) => shot.id === event.weaponId);
        if (predicted >= 0) this.predictedShots.splice(predicted, 1);
        else { const weapon = getWeapon(event.weaponId); this.playLocalShot(weapon, now, false); if (weapon.burstCount) this.localBurstLeft = Math.max(0, (this.localBurstLeft || 0) - 1); this.localNextFire = Math.max(this.localNextFire, now + Math.max(0, this.local.nextFireAt - this.serverNow)); }
        const world = new THREE.Vector3(); this.activeModel.userData.muzzle.getWorldPosition(world); origin = world;
        if (event.hit) {
          this.audio.hit(event.headshot); this.hud.hitmarker.classList.add('visible'); this.hud.hitmarker.classList.toggle('headshot', event.headshot);
          this.hud.hitmarker.classList.remove('protected');
          this.hitmarkerUntil = performance.now() + 110;
        } else if (event.rays?.some((ray) => ray.protectedTarget)) {
          this.hud.hitmarker.classList.add('visible', 'protected'); this.hud.hitmarker.classList.remove('headshot'); this.hitmarkerUntil = performance.now() + 130;
        }
      } else if (this.predicted) {
        const dx = event.origin.x - this.predicted.x, dz = event.origin.z - this.predicted.z, distance = Math.hypot(dx, dz);
        if (distance < 45) {
          const pan = clamp((dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw)) / Math.max(distance, 0.1), -1, 1);
          this.audio.shot(Math.max(0.03, 0.55 / (1 + distance / 9)), pan, event.weaponId, distance);
        }
      }
      const avatar = this.remote.get(event.id); if (avatar) avatar.flashUntil = performance.now() + 45;
      for (const ray of event.rays || [{ end: event.end, hit: event.hit }]) {
        this.tracer(origin, ray.end, event.id === this.selfId, !ray.hit && !ray.protectedTarget);
        if (ray.hit && ray.hit !== this.selfId) this.combat.blood(ray.end, event.origin, this.players.find((player) => player.id === ray.hit)?.y || 0);
      }
    }
    if (event.type === 'damage' && event.id === this.selfId) {
      this.audio.hurt(); this.hud['damage-vignette'].classList.add('visible'); this.damageUntil = performance.now() + 180;
      this.recordDamageDirection(event);
      if (this.predicted) this.combat.blood({ x: this.predicted.x, y: this.predicted.y + 0.8, z: this.predicted.z }, event.origin, this.predicted.y, 0.5);
    }
    if (event.type === 'kill') {
      const victim = this.players.find((player) => player.id === event.victimId), rendered = this.remote.get(event.victimId);
      if (victim) this.combat.death(rendered ? { ...victim, x: rendered.group.position.x, y: rendered.group.position.y, z: rendered.group.position.z, yaw: rendered.group.rotation.y } : victim);
      const entry = document.createElement('div'); entry.className = `feed-item${event.killerId === this.selfId ? ' mine' : ''}`;
      for (const [className, text] of [['killer', event.killer], ['feed-icon', `${getWeapon(event.weaponId).name} ${event.headshot ? '⌖' : '›'}`], ['victim', event.victim]]) {
        const span = document.createElement('span'); span.className = className; span.textContent = text; entry.append(span);
      }
      $('killfeed').prepend(entry);
      while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
      setTimeout(() => entry.remove(), 5500);
      if (event.killerId === this.selfId) {
        this.audio.kill(); this.hud['kill-confirmation'].textContent = event.headshot ? 'HEADSHOT  +1' : 'ELIMINATED  +1'; this.killUntil = performance.now() + 1800;
      }
    }
    if (event.type === 'restart') { this.combat.clear(); $('killfeed').replaceChildren(); this.hud['kill-confirmation'].textContent = ''; }
  }

  tracer(origin, end, mine, showImpact = true) {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(origin.x, origin.y, origin.z), new THREE.Vector3(end.x, end.y, end.z)]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: mine ? '#ffdf9c' : '#f6ba75', transparent: true, opacity: mine ? 0.8 : 0.45, depthWrite: false }));
    this.scene.add(line); this.effects.push({ object: line, expires: performance.now() + 65 });
    if (showImpact) {
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.045, 4, 4), new THREE.MeshBasicMaterial({ color: '#ffc17d', transparent: true, opacity: 0.8 }));
      spark.position.set(end.x, end.y, end.z); this.scene.add(spark); this.effects.push({ object: spark, expires: performance.now() + 85 });
    }
  }

  clearDamageDirections() {
    this.damageDirections.length = 0; $('incoming-damage').replaceChildren(); $('damage-direction-caption').hidden = true;
  }

  recordDamageDirection(event) {
    const source = event.origin || this.players.find((player) => player.id === event.attacker);
    if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.z)) return;
    let marker = this.damageDirections.find((entry) => entry.attacker === event.attacker);
    if (!marker) {
      const element = document.createElement('div'); element.className = 'damage-direction'; $('incoming-damage').append(element);
      marker = { attacker: event.attacker, element }; this.damageDirections.push(marker);
    } else { this.damageDirections.splice(this.damageDirections.indexOf(marker), 1); this.damageDirections.push(marker); }
    Object.assign(marker, { source: { x: source.x, z: source.z }, expires: performance.now() + 1100, strength: clamp(0.35 + event.damage / 65, 0.55, 1) });
    while (this.damageDirections.length > 4) this.damageDirections.shift().element.remove();
  }

  updateDamageDirections(now) {
    const directions = ['front', 'front-right', 'right', 'rear-right', 'rear', 'rear-left', 'left', 'front-left'];
    for (let i = this.damageDirections.length - 1; i >= 0; i--) {
      const marker = this.damageDirections[i], angle = damageBearing(this.predicted, marker.source, this.yaw);
      if (now >= marker.expires || angle === null) { marker.element.remove(); this.damageDirections.splice(i, 1); continue; }
      const sector = (Math.round(angle / (Math.PI / 4)) + 8) % 8;
      marker.sector = sector; marker.element.dataset.direction = directions[sector];
      marker.element.style.transform = `translate(-50%, -50%) rotate(${sector * 45}deg)`;
      marker.element.style.opacity = marker.strength * Math.min(1, (marker.expires - now) / 350);
    }
    $('damage-direction-caption').hidden = true;
  }

  input() {
    const active = this.locked && this.local?.hp > 0 && this.room?.phase === 'active';
    const crouch = active && (this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.keys.has('ControlRight'));
    return {
      type: 'input', forward: active ? Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')) : 0,
      strafe: active ? Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')) : 0,
      yaw: this.yaw, pitch: this.pitch, jump: active && (this.keys.has('Space') || performance.now() < this.jumpPressedUntil),
      sprint: active && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && !this.ads,
      crouch,
      fire: active && this.fireHeld, reload: active && performance.now() < this.reloadPressedUntil,
      ads: active && this.ads, weaponId: this.requestedWeaponId, viewTime: this.viewTime ?? this.serverNow - 70,
    };
  }

  animate(now) {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.animate);
    const dt = Math.min((now - this.previousFrame) / 1000, 1 / 30); this.previousFrame = now;
    this.aimRecoil.update(now);
    const input = this.input();
    if (now - this.lastSend >= 1000 / 30 && this.local) { this.send(input); this.lastSend = now; }
    if (this.predicted && this.local) {
      const previousX = this.predicted.x, previousZ = this.predicted.z;
      if (this.local.hp > 0 && this.room.phase === 'active') movePlayer(this.predicted, input, dt, this.world);
      const moved = Math.hypot(this.predicted.x - previousX, this.predicted.z - previousZ);
      this.stepDistance += moved;
      const sprinting = this.predicted.sprinting;
      if (this.stepDistance > (sprinting ? 2.5 : 2.0) && this.predicted.grounded && this.locked) { this.audio.step(sprinting, this.predicted.crouching); this.stepDistance = 0; }
      const moving = Math.abs(input.forward) + Math.abs(input.strafe) > 0;
      const ads = this.ads && this.locked && !this.hadReload && this.local.switchUntil <= this.serverNow && this.requestedWeaponId === this.local.weaponId && this.local.hp > 0;
      const bob = !ads && moving && this.predicted.grounded ? Math.sin(now * (sprinting ? 0.017 : 0.012)) : 0;
      // Recoil recovers toward mouse aim; the composed pitch is also sent to
      // the server, so recovery never creates a camera-only aiming offset.
      this.camera.position.set(this.predicted.x, this.predicted.y + playerPose(this.predicted).eyeHeight, this.predicted.z);
      this.audio.setEnvironment?.((this.world.buildings || []).some((building) => Math.abs(this.predicted.x - building.x) < building.w / 2 && Math.abs(this.predicted.z - building.z) < building.d / 2 && this.predicted.y < building.height - 0.1));
      if (this.local.hp <= 0) this.camera.position.y = this.predicted.y + lerp(playerPose(this.predicted).eyeHeight, 0.45, Math.min(1, (now - (this.deathAt || now)) / 700));
      this.camera.rotation.set(this.pitch, this.yaw, 0);
      const weapon = getWeapon(this.local.weaponId), switching = this.local.switchUntil > this.serverNow || this.requestedWeaponId !== this.local.weaponId;
      const scoped = ads && weapon.type === 'SNIPER'; $('scope-overlay').hidden = !scoped;
      if (scoped) document.querySelector('.scope-lens>span').textContent = `${weapon.name} / PRECISION OPTICS`;
      const desiredFov = ads ? this.settings.fov * weapon.zoom : sprinting && moving ? this.settings.fov + 5 : this.settings.fov;
      this.camera.fov = lerp(this.camera.fov, desiredFov, Math.min(1, dt * 12)); this.camera.updateProjectionMatrix();
      const reloadRemaining = this.local.reloadUntil - this.serverNow;
      const reloadTilt = reloadRemaining > 0 ? Math.sin(clamp(reloadRemaining / (weapon.reloadSeconds * 1000), 0, 1) * Math.PI) : 0;
      this.switchAnimation = lerp(this.switchAnimation, 0, dt * 10);
      this.weapon.position.x = lerp(this.weapon.position.x, (ads ? 0 : 0.25) + bob * 0.005, dt * 14);
      this.weapon.position.y = lerp(this.weapon.position.y, (ads ? -this.activeModel.userData.aimHeight : -0.23) - reloadTilt * 0.18 - this.switchAnimation * 0.25 + bob * 0.007 - (sprinting && moving ? 0.08 : 0), dt * 14);
      this.weapon.position.z = lerp(this.weapon.position.z, (ads ? -0.35 : -0.43) + this.recoil * 0.035, dt * 17);
      this.weapon.rotation.z = -reloadTilt * 0.65 + bob * 0.008;
      this.weapon.rotation.x = -reloadTilt * 0.25;
      const sightAligned = ads && Math.abs(this.weapon.position.x) < 0.003 && Math.abs(this.weapon.position.y + this.activeModel.userData.aimHeight) < 0.003;
      if (sightAligned) { this.weapon.position.x = 0; this.weapon.position.y = -this.activeModel.userData.aimHeight; }
      this.sightAligned = sightAligned;
      if (this.activeModel.userData.reticle) this.activeModel.userData.reticle.visible = !ads;
      $('ads-reticle').hidden = !ads || scoped || this.local.hp <= 0;
      $('ads-reticle').style.backgroundColor = getSkin(this.local.skinId).accent;
      this.weapon.visible = this.local.hp > 0 && this.room.phase === 'active' && !scoped;
      if (now > this.firePressedUntil) this.localFirePending = false;
      const trigger = input.fire || this.localFirePending;
      if (weapon.burstCount && !this.localBurstLeft && trigger && !this.fireLatched && now >= this.localNextFire) this.localBurstLeft = weapon.burstCount;
      const fireReady = weapon.burstCount ? this.localBurstLeft > 0 : trigger && (weapon.automatic || !this.fireLatched);
      if (fireReady && !switching && !this.hadReload && this.local.ammo > 0 && now >= this.localNextFire && this.serverNow >= this.local.nextFireAt - 20) {
        this.playLocalShot(weapon, now); this.localNextFire = now + weapon.fireSeconds * 1000;
        if (weapon.burstCount) { this.localBurstLeft--; if (!this.localBurstLeft) this.localNextFire = now + weapon.burstPause * 1000; }
      }
      this.fireLatched = input.fire;
      if (this.activeModel.userData.pump) this.activeModel.userData.pump.position.z = -0.43 + Math.sin(clamp((now - this.lastFire) / 600, 0, 1) * Math.PI) * 0.1;
      if (this.activeModel.userData.slide) this.activeModel.userData.slide.position.z = this.recoil * 0.025;
      this.recoil = lerp(this.recoil, 0, dt * 15);
      this.muzzleFlash.visible = now < this.muzzleUntil; this.muzzleLight.intensity = now < this.muzzleUntil ? 2 : 0;
      this.hud['crosshair'].style.opacity = this.local.hp <= 0 || ads ? '0' : '1';
      const spread = shotSpread(weapon, ads, this.predicted);
      // Scaling the translated container moved its center by up to 42px.
      // Only the four arms spread; both hip-fire and ADS centers stay fixed.
      this.hud['crosshair'].style.scale = '1';
      this.hud['crosshair'].style.setProperty('--crosshair-gap', `${Math.min(26, spread * 170 + this.recoil * 2.5 + (weapon.type === 'SHOTGUN' ? 5 : 0))}px`);
      this.hud['crosshair'].dataset.accuracy = !this.predicted.grounded ? 'airborne' : sprinting ? 'sprinting' : this.predicted.moveSpeed > 0.2 ? 'moving' : 'steady';
      this.hud['protection-hint'].hidden = this.local.hp <= 0 || this.local.protectedUntil < this.serverNow;
      if (this.local.hp <= 0) this.hud['respawn-count'].textContent = Math.max(1, Math.ceil((this.local.respawnAt - this.serverNow) / 1000));
    }
    for (const avatar of this.remote.values()) {
      const target = avatar.target, position = avatar.group.position;
      avatar.group.visible = target.hp > 0;
      avatar.shield.visible = target.hp > 0 && target.protectedUntil > this.serverNow;
      const teleport = position.distanceTo(new THREE.Vector3(target.x, target.y, target.z)) > 6;
      const smoothing = teleport ? 1 : Math.min(1, dt * 15);
      avatar.renderTime = lerp(avatar.renderTime, avatar.targetTime, smoothing);
      position.x = lerp(position.x, target.x, smoothing); position.y = lerp(position.y, target.y, smoothing); position.z = lerp(position.z, target.z, smoothing);
      avatar.group.rotation.y += angleDelta(target.yaw, avatar.group.rotation.y) * smoothing;
      avatar.weapon.rotation.x = target.pitch;
      avatar.weapon.userData.flash.visible = now < avatar.flashUntil;
      avatar.crouchAmount = lerp(avatar.crouchAmount, target.crouching ? 1 : 0, Math.min(1, dt * 14));
      avatar.label.position.y = 2.15 - avatar.crouchAmount * 0.7;
      const speed = Math.hypot(position.x - avatar.lastX, position.z - avatar.lastZ) / Math.max(dt, 0.001);
      const stride = Math.sin(now * 0.011) * Math.min(0.5, speed * 0.08) * (1 - avatar.crouchAmount * 0.65);
      poseOperator(avatar, avatar.crouchAmount, stride);
      avatar.lastX = position.x; avatar.lastZ = position.z;
    }
    const viewTimes = [...this.remote.values()].filter((avatar) => avatar.target.hp > 0).map((avatar) => avatar.renderTime);
    this.viewTime = viewTimes.length ? Math.min(...viewTimes) : this.serverNow;
    if (now - this.lastMap > 100 && this.predicted) {
      const origin = { x: this.predicted.x, y: this.predicted.y + playerPose(this.predicted).eyeHeight, z: this.predicted.z };
      const visible = this.players.filter((p) => p.id !== this.selfId && p.hp > 0 && Math.hypot(p.x - origin.x, p.z - origin.z) < 25 && hasLineOfSight(origin, { x: p.x, y: p.y + playerPose(p).eyeHeight, z: p.z }, this.world));
      for (const [id, avatar] of this.remote) avatar.label.visible = visible.some((p) => p.id === id);
      drawTacticalMap(this.minimap, { world: this.world, players: visible, self: { ...this.predicted, id: this.selfId, hp: this.local.hp, yaw: this.yaw } });
      this.lastMap = now;
    }
    if (now > this.hitmarkerUntil) this.hud.hitmarker.classList.remove('visible');
    if (now > this.damageUntil) this.hud['damage-vignette'].classList.remove('visible');
    if (now > this.killUntil) this.hud['kill-confirmation'].textContent = '';
    this.updateDamageDirections(now);
    this.combat.update(now, dt);
    for (let i = this.effects.length - 1; i >= 0; i--) if (now > this.effects[i].expires) {
      const effect = this.effects[i]; this.scene.remove(effect.object); effect.object.geometry.dispose(); effect.object.material.dispose(); this.effects.splice(i, 1);
    }
    this.dust.rotation.y = Math.sin(now / 50000) * 0.03;
    this.fpsFrames++;
    if (now - this.fpsTime > 1000) { this.hud['hud-fps'].textContent = `${Math.round(this.fpsFrames * 1000 / (now - this.fpsTime))} FPS`; this.fpsFrames = 0; this.fpsTime = now; }
    if (this.locked || !this.lastRender || now - this.lastRender > 1000 / 10) {
      this.renderer.render(this.scene, this.camera); this.lastRender = now;
    }
  }

  disposeObject(object, all = true) {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    object.traverse((child) => {
      if (child.geometry && (all || child.geometry !== this.boxGeometry)) geometries.add(child.geometry);
      const items = child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : [];
      for (const material of items) {
        if (!all && Object.values(this.materials).includes(material)) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture && (all || ![...this.models.textures.values()].includes(value))) textures.add(value);
      }
    });
    geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose()); textures.forEach((texture) => texture.dispose());
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.abort.abort(); cancelAnimationFrame(this.frameId);
    if (this.locked) document.exitPointerLock();
    this.combat.dispose(); this.disposeObject(this.scene); this.sun.shadow.dispose(); this.renderer.dispose();
    this.models.dispose(); $('scope-overlay').hidden = true; $('ads-reticle').hidden = true;
    this.clearDamageDirections();
    this.remote.clear(); this.effects.length = 0;
    this.closeLoadout(false);
    for (const id of ['pause-overlay', 'round-overlay', 'scoreboard-overlay', 'respawn-overlay']) $(id).hidden = true;
    $('killfeed').replaceChildren();
    this.hud.hitmarker.classList.remove('visible'); this.hud['damage-vignette'].classList.remove('visible');
  }
}
