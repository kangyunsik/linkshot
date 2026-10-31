import * as THREE from '/vendor/three.module.js';
import { createOperator, poseOperator } from './operator-model.js';
import { disposeModel } from './weapon-model.js';
import { bounds } from '/shared/world.js';

export class CombatEffects {
  constructor(scene, models, world) { this.scene = scene; this.models = models; this.world = world; this.bursts = []; this.stains = []; this.corpses = []; }

  prepareWarmup(players) {
    if (this.warmup) return this.warmup;
    const group = new THREE.Group(), seen = new Set(); group.position.set(10000, 0, 10000);
    for (const player of players) {
      const key = `${player.characterId}/${player.outfitId}/${player.skinId}`; if (seen.has(key)) continue; seen.add(key);
      const operator = createOperator(player, this.models); operator.weapon.visible = false; this.corpseMaterials(operator.group); group.add(operator.group);
    }
    group.add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)), new THREE.PointsMaterial({ color: '#a62532', size: .045, transparent: true, opacity: .85, depthWrite: false })));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: '#ffdf9c', transparent: true, opacity: .8, depthWrite: false })));
    group.add(new THREE.Mesh(new THREE.SphereGeometry(.045, 4, 4), new THREE.MeshBasicMaterial({ color: '#ffc17d', transparent: true, opacity: .8 })));
    group.traverse((object) => { object.frustumCulled = false; }); this.warmup = group; return group;
  }

  corpseMaterials(group) {
    // Keep the transparent program from the start. Switching material mode at
    // 8.5s triggered a long driver shader compile in the middle of combat.
    group.traverse((object) => { if (object.isMesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.transparent = true; });
  }

  floor(x, z, ceiling) {
    let floor = 0;
    for (const box of this.world.obstacles) { const b = bounds(box); if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY <= ceiling + 0.05) floor = Math.max(floor, b.maxY); }
    return floor;
  }

  blood(point, origin, floor = 0, strength = 1) {
    floor = this.floor(point.x, point.z, floor);
    const direction = new THREE.Vector3(point.x - origin.x, point.y - origin.y, point.z - origin.z).normalize();
    const count = Math.round(12 * strength), positions = new Float32Array(count * 3), velocities = [];
    for (let i = 0; i < count; i++) {
      positions.set([point.x, point.y, point.z], i * 3);
      velocities.push(new THREE.Vector3(direction.x * 0.8 + (Math.random() - 0.5) * 1.5, 0.4 + Math.random() * 1.2, direction.z * 0.8 + (Math.random() - 0.5) * 1.5));
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const object = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#a62532', size: 0.045, transparent: true, opacity: 0.85, depthWrite: false }));
    object.name = 'blood-particles'; object.frustumCulled = false; this.scene.add(object); this.bursts.push({ object, velocities, floor, born: performance.now() });
    while (this.bursts.length > 20) this.remove(this.bursts.shift().object);
    this.stain(point.x, floor, point.z, 0.12 + strength * 0.07);
  }

  stain(x, y, z, radius) {
    const object = new THREE.Mesh(new THREE.CircleGeometry(radius, 16), new THREE.MeshBasicMaterial({ color: '#671c28', transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    object.name = 'blood-stain'; object.rotation.x = -Math.PI / 2; object.scale.y = 0.65 + Math.random() * 0.45; object.position.set(x, y + 0.015, z);
    this.scene.add(object); this.stains.push({ object, born: performance.now() });
    while (this.stains.length > 24) this.remove(this.stains.shift().object);
  }

  death(player) {
    const operator = createOperator(player, this.models), pivot = new THREE.Group(); pivot.name = 'corpse'; pivot.rotation.order = 'YXZ'; pivot.rotation.y = player.yaw;
    this.corpseMaterials(operator.group);
    pivot.position.set(player.x, player.y, player.z); operator.weapon.visible = false; pivot.add(operator.group); this.scene.add(pivot);
    const sign = Math.random() < 0.65 ? 1 : -1, x = player.x + Math.sin(player.yaw) * sign * 0.75, z = player.z + Math.cos(player.yaw) * sign * 0.75;
    const floor = this.floor(x, z, player.y);
    this.corpses.push({ operator, pivot, born: performance.now(), startY: player.y, floor, sign, roll: (Math.random() - 0.5) * 0.12 });
    this.stain(x, floor, z, 0.3);
    while (this.corpses.length > 8) this.remove(this.corpses.shift().pivot);
  }

  update(now, dt) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i], age = now - burst.born;
      if (age > 750) { this.remove(burst.object); this.bursts.splice(i, 1); continue; }
      const attribute = burst.object.geometry.getAttribute('position');
      burst.velocities.forEach((velocity, index) => { velocity.y -= dt * 4.5; attribute.setXYZ(index, attribute.getX(index) + velocity.x * dt, Math.max(burst.floor + 0.02, attribute.getY(index) + velocity.y * dt), attribute.getZ(index) + velocity.z * dt); });
      attribute.needsUpdate = true; burst.object.material.opacity = 0.85 * (1 - age / 750);
    }
    for (let i = this.stains.length - 1; i >= 0; i--) {
      const stain = this.stains[i], age = now - stain.born;
      if (age > 9000) { this.remove(stain.object); this.stains.splice(i, 1); } else stain.object.material.opacity = 0.42 * Math.min(1, (9000 - age) / 1500);
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const corpse = this.corpses[i], age = now - corpse.born, t = Math.min(1, age / 950), ease = t * t * (3 - 2 * t);
      if (age > 10000) { this.remove(corpse.pivot); this.corpses.splice(i, 1); continue; }
      if (t < 1 || !corpse.settled) {
        corpse.pivot.rotation.x = corpse.sign * Math.PI / 2 * ease; corpse.pivot.rotation.z = corpse.roll * ease;
        corpse.pivot.position.y = THREE.MathUtils.lerp(corpse.startY, corpse.floor + 0.30, ease);
        poseOperator(corpse.operator, Math.sin(t * Math.PI) * 0.55);
        if (t === 1) corpse.settled = true;
      }
      if (age > 8500) corpse.pivot.traverse((object) => { if (object.isMesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.opacity = Math.min(material.opacity, (10000 - age) / 1500); });
    }
  }

  remove(object) { this.scene.remove(object); disposeModel(object); }
  clear() { for (const burst of this.bursts) this.remove(burst.object); for (const stain of this.stains) this.remove(stain.object); for (const corpse of this.corpses) this.remove(corpse.pivot); this.bursts.length = this.stains.length = this.corpses.length = 0; }
  dispose() { this.clear(); if (this.warmup) { disposeModel(this.warmup); this.warmup = null; } }
}
