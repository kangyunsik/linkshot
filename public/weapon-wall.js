import * as THREE from '/vendor/three.module.js';
import { rayBox, impactSurface } from '/shared/world.js';
import { collisionData, nearbyColliders } from '/shared/collision-grid.js';

const OFFSETS = [-.1, 0, .1];

// Clip only the world-visible gun, never the player body, camera/viewmodel,
// aiming ray or damage volumes. Three small probes also cover barrel edges.
export class WeaponWallGuard {
  constructor(weapon) {
    this.planes = OFFSETS.map(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 10000));
    this.origin = new THREE.Vector3(); this.direction = new THREE.Vector3(); this.end = new THREE.Vector3(); this.setWeapon(weapon);
  }
  setWeapon(weapon) {
    this.weapon = weapon;
    weapon.traverse((object) => { for (const material of object.material ? Array.isArray(object.material) ? object.material : [object.material] : []) {
      material.clippingPlanes = this.planes; material.clipShadows = true; material.needsUpdate = true;
    } });
  }
  update(world, position, yaw) {
    const weapon = this.weapon, pitch = weapon.rotation.x, sine = Math.sin(yaw), cosine = Math.cos(yaw), data = collisionData(world);
    const reach = Math.abs(weapon.userData.muzzle.position.z) + .14;
    this.direction.set(-sine * Math.cos(pitch), Math.sin(pitch), -cosine * Math.cos(pitch));
    for (let i = 0; i < OFFSETS.length; i++) {
      const x = weapon.position.x + OFFSETS[i], z = weapon.position.z;
      this.origin.set(position.x + cosine * x + sine * z, position.y + weapon.position.y + .02, position.z - sine * x + cosine * z);
      this.end.copy(this.origin).addScaledVector(this.direction, reach);
      let distance = reach, obstacle = null;
      for (const box of nearbyColliders(data, this.origin, this.end)) { const hit = rayBox(this.origin, this.direction, box.raw, distance); if (hit !== null) { distance = hit; obstacle = box.raw; } }
      const surface = impactSurface(this.origin, this.direction, distance, obstacle, world), plane = this.planes[i];
      if (surface) { plane.normal.set(surface.normal.x, surface.normal.y, surface.normal.z); plane.constant = -plane.normal.dot(surface.point) - .003; }
      else { plane.normal.set(0, 1, 0); plane.constant = 10000; }
    }
  }
}
