import * as THREE from '/vendor/three.module.js';
import { WeaponModels, disposeModel } from './weapon-model.js';
export { createOperator, poseOperator } from './rigged-operator.js';
import { createOperator } from './rigged-operator.js';

function contactShadow() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d'), gradient = ctx.createRadialGradient(64,64,5,64,64,63);
  gradient.addColorStop(0,'#081018b8'); gradient.addColorStop(.45,'#08101887'); gradient.addColorStop(1,'#08101800');
  ctx.fillStyle = gradient; ctx.fillRect(0,0,128,128);
  const texture = new THREE.CanvasTexture(canvas);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.04,.64), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.009; return shadow;
}

export class OperatorPreview {
  constructor(canvas) {
    this.models = new WeaponModels(); this.scene = new THREE.Scene(); this.angle = -.24; this.frameStyle = 'full'; this.canvas = canvas;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .02, 20);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    lightOperator(this.scene);
    this.shadow = contactShadow(); this.scene.add(this.shadow);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas); this.resize();
    // Let users inspect the side and back. Buttons use the same rotation for
    // keyboard users, and the model never auto-rotates away from that view.
    this.events = new AbortController();
    const options = { signal: this.events.signal };
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      this.drag = { id: event.pointerId, x: event.clientX }; canvas.setPointerCapture(event.pointerId);
    }, options);
    canvas.addEventListener('pointermove', event => {
      if (this.drag?.id !== event.pointerId) return;
      this.rotate((event.clientX - this.drag.x) * .012); this.drag.x = event.clientX;
    }, options);
    canvas.addEventListener('lostpointercapture', () => { this.drag = null; }, options);
    canvas.addEventListener('webglcontextrestored', () => this.draw(), options);
  }
  resize() {
    const width = Math.max(1, this.canvas.clientWidth), height = Math.max(1, this.canvas.clientHeight);
    const aspect = width / height, detail = this.frameStyle === 'detail';
    const half = detail ? Math.max(.33,.31 / aspect) : Math.max(.985,.41 / aspect), focus = detail ? 1.515 : .895;
    this.camera.position.set(0, focus + (detail ? .11 : .23), -4); this.camera.lookAt(0, focus, 0);
    Object.assign(this.camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height, false); this.draw();
  }
  draw() {
    if (this.frame != null) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.renderer.render(this.scene, this.camera); });
  }
  setFrame(style) {
    if (!['full','detail'].includes(style) || style === this.frameStyle) return;
    this.frameStyle = style; this.resize();
  }
  rotate(radians) {
    this.angle = (this.angle + radians) % (Math.PI * 2);
    if (this.operator) { this.operator.group.rotation.y = this.angle; this.draw(); }
  }
  set(outfitId, characterId) {
    const key = `${outfitId}/${characterId}`; if (key === this.selection) return;
    const operator = createOperator({ outfitId, characterId }, this.models, { wardrobe: true });
    if (this.operator) { this.scene.remove(this.operator.group); disposeModel(this.operator.group); }
    this.selection = key; this.operator = operator; this.operator.group.rotation.y = this.angle;
    this.scene.add(this.operator.group); this.draw();
  }
  dispose() { cancelAnimationFrame(this.frame); this.events.abort(); this.observer.disconnect(); if (this.operator) disposeModel(this.operator.group); this.shadow.material.map.dispose(); disposeModel(this.shadow); this.models.dispose(); this.renderer.dispose(); }
}

export function lightOperator(scene) {
  scene.add(new THREE.HemisphereLight('#e4ecff', '#837873', 2.35));
  for (const [color, intensity, position] of [['#fff2e3', 2.70, [-2.5, 3.4, -4]], ['#c7daf0', 1.02, [2, 1.9, -3]], ['#bad4e0', 2.25, [1.5, 2.7, 2.2]]]) {
    const light = new THREE.DirectionalLight(color, intensity); light.position.set(...position); scene.add(light);
  }
}
