// Local-only practice lane, separate from the tutorial and matchmaking maps.
export const RANGE_DISTANCES = Object.freeze([10, 30, 60]);
export const RANGE_TARGET = Object.freeze({ id: 'range-target', x: 0, y: 0, z: -37, yaw: Math.PI });
export const RANGE_PLOT = Object.freeze({ halfWidth: 1.5, height: 2.25 });

export const rangeLine = distance => ({ x: 0, y: 0, z: RANGE_TARGET.z + distance, yaw: 0 });

const obstacle = (id, x, z, w, d, h) => Object.freeze({ id, x, y: 0, z, w, d, h, kind: 'wall' });
export const RANGE_WORLD = Object.freeze({
  id: 'shooting-range', name: 'FREE RANGE', title: 'FREE RANGE', label: '자유 사격장', width: 18, depth: 88,
  theme: 'industrial', sky: '#304957', ground: '#85938f', wall: '#405966', accent: '#c38d61', light: '#ffead1',
  buildings: [], walkways: [], platforms: [], coverWalls: [],
  obstacles: Object.freeze([
    obstacle('range-north', 0, -44.5, 19, 1, 5),
    obstacle('range-south', 0, 44.5, 19, 1, 5),
    obstacle('range-west', -9.5, 0, 1, 90, 5),
    obstacle('range-east', 9.5, 0, 1, 90, 5),
    obstacle('range-backstop', 0, RANGE_TARGET.z - 1.4, 12, .8, 4.2),
  ]),
  spawns: Object.freeze([{ ...rangeLine(30), spawnId: 'range-line' }]),
});
