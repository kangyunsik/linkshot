import * as THREE from '/vendor/three.module.js';

// Shared rounded anatomy for third-person operators and first-person hands.
// These meshes are visual only; combat dimensions stay in shared/world.js.
export class HumanParts {
  constructor() {
    this.sphere = new THREE.SphereGeometry(1, 16, 12);
    this.limb = new THREE.LatheGeometry([[0, -0.5], [0.3, -0.48], [0.43, -0.38], [0.5, -0.12], [0.46, 0.25], [0.34, 0.44], [0, 0.5]].map(([x, y]) => new THREE.Vector2(x, y)), 12);
  }

  mesh(parent, geometry, size, position, material, name) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name || '';
    mesh.scale.set(...size); mesh.position.set(...position); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }

  oval(parent, size, position, material, name) {
    return this.mesh(parent, this.sphere, size.map((value) => value / 2), position, material, name);
  }

  panel(parent, size, position, material, name) {
    if (!this.roundedPanel) {
      const shape = new THREE.Shape(), r = 0.12;
      shape.moveTo(-0.5 + r, -0.5); shape.lineTo(0.5 - r, -0.5); shape.quadraticCurveTo(0.5, -0.5, 0.5, -0.5 + r);
      shape.lineTo(0.5, 0.5 - r); shape.quadraticCurveTo(0.5, 0.5, 0.5 - r, 0.5); shape.lineTo(-0.5 + r, 0.5);
      shape.quadraticCurveTo(-0.5, 0.5, -0.5, 0.5 - r); shape.lineTo(-0.5, -0.5 + r); shape.quadraticCurveTo(-0.5, -0.5, -0.5 + r, -0.5);
      this.roundedPanel = new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.04, bevelThickness: 0.1, curveSegments: 5 });
      this.roundedPanel.translate(0, 0, -0.4);
    }
    return this.mesh(parent, this.roundedPanel, size, position, material, name);
  }

  segment(parent, start, end, width, material, name, depth = width) {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), direction = b.clone().sub(a);
    const mesh = this.mesh(parent, this.limb, [width, direction.length(), depth], a.add(b).multiplyScalar(0.5).toArray(), material, name);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); return mesh;
  }

  hand(parent, position, glove, fingers = glove, name = 'hand') {
    const hand = new THREE.Group(); hand.name = name; hand.position.set(...position); parent.add(hand);
    this.oval(hand, [0.085, 0.105, 0.047], [0, 0, 0], glove, 'palm');
    // Four individually curled fingers and an opposed thumb, not a square mitt.
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 0.019, length = [0.039, 0.046, 0.043, 0.033][i];
      this.segment(hand, [x, 0.025, -0.006], [x, 0.025 + length, -0.022], 0.018, fingers, `finger-${i}`);
      this.segment(hand, [x, 0.025 + length, -0.022], [x, 0.034 + length, -0.051], 0.017, fingers, `fingertip-${i}`);
    }
    this.segment(hand, [-0.031, -0.023, 0], [-0.057, 0.004, -0.021], 0.024, fingers, 'thumb');
    this.segment(hand, [-0.057, 0.004, -0.021], [-0.043, 0.028, -0.046], 0.021, fingers, 'thumb-tip');
    hand.userData.fingers = 5; return hand;
  }
}
