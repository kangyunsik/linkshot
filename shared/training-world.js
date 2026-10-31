// Dedicated local-only training space; never part of the multiplayer map pool.
const block = (id, x, z, w, d, h, kind = 'crate', y = 0) => ({ id, x, y, z, w, d, h, kind, color: 'slate' });
export const TRAINING_WORLD = Object.freeze({
  id: 'training', name: 'TRAINING RANGE', title: 'TRAINING', label: '기초 훈련장', width: 32, depth: 40,
  theme: 'industrial', sky: '#263e4a', ground: '#7e8d88', wall: '#3e5762', accent: '#b67946', light: '#ffe7bd',
  buildings: [], walkways: [], platforms: [], coverWalls: [],
  obstacles: [
    block('training-north', 0, -20.5, 33, 1, 4, 'wall'), block('training-south', 0, 20.5, 33, 1, 4, 'wall'),
    block('training-west', -16.5, 0, 1, 42, 4, 'wall'), block('training-east', 16.5, 0, 1, 42, 4, 'wall'),
    block('training-low-cover', -5, 4, 4, .8, 1.1),
    ...[.3, .6, .9].map((height, index) => block(`training-step-${index}`, 6, 6 - index * .6, 3, .6, height, 'step')),
    block('training-deck', 6, 2.3, 3, 4.4, 1.2, 'platform'),
    block('training-target-backstop', 0, -11, 7, .6, 3, 'equipment'),
  ],
  spawns: [{ x: 0, y: 0, z: 14, yaw: 0, spawnId: 'training-entry', exitPath: [{ x: 0, z: 10 }] }],
});
