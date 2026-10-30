import * as THREE from '/vendor/three.module.js';
import { WeaponModels, disposeModel } from './weapon-model.js';
export { createOperator, poseOperator } from './rigged-operator.js';
import { createOperator } from './rigged-operator.js';

export class OperatorPreview {
  constructor(canvas) {
    this.canvas = canvas; this.models = new WeaponModels(); this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#13212b');
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.02, 20); this.camera.position.set(2.1, 1.35, -3.1); this.camera.lookAt(0, 0.95, 0);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.1;
    this.scene.add(new THREE.HemisphereLight('#d4e9ff', '#384540', 2.6));
    const key = new THREE.DirectionalLight('#ffe3c5', 3); key.position.set(3, 4, -3); this.scene.add(key);
    const rim = new THREE.DirectionalLight('#8cdadf', 3); rim.position.set(-2, 2, 2); this.scene.add(rim);
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: '#28404b', roughness: 0.8 })); this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = -0.005; this.scene.add(this.floor);
    this.resize = () => { const rect = canvas.getBoundingClientRect(); this.renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false); this.camera.aspect = rect.width / Math.max(1, rect.height); this.camera.updateProjectionMatrix(); };
    this.observer = new ResizeObserver(this.resize); this.observer.observe(canvas); this.resize();
    const animate = (time) => { if (this.stopped) return; this.frame = requestAnimationFrame(animate); if (this.operator) this.operator.group.rotation.y = -0.2 + Math.sin(time / 4000) * 0.6; this.renderer.render(this.scene, this.camera); }; this.frame = requestAnimationFrame(animate);
  }
  set(outfitId, skinId = 'standard', weaponId = 'rifle') { if (this.operator) { this.scene.remove(this.operator.group); disposeModel(this.operator.group); } this.operator = createOperator({ outfitId, skinId, weaponId }, this.models); this.scene.add(this.operator.group); }
  dispose() { this.stopped = true; cancelAnimationFrame(this.frame); this.observer.disconnect(); if (this.operator) disposeModel(this.operator.group); this.floor.geometry.dispose(); this.floor.material.dispose(); this.models.dispose(); this.renderer.dispose(); }
}
