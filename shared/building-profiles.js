// Facades use clockwise faces (S, W, N, E). Offsets run along that face as
// seen from inside. Rotating a profile moves both the facade and its openings.
const fold = (face, lane, width = 1.38, hand = 1) => ({ shape: 'switchback', face, lane, width, hand });
const straight = (face, lane, width = 1.65) => ({ shape: 'straight', face, lane, width });
const design = (style, turn, ...stairs) => ({ style, turn, stairs });

export const BUILDING_FACADES = {
  watch: {
    doors: [[0, .62, 1.65]], rail: .68,
    windows: [
      [[2, .38, 'slot'], [3, 0, 'regular']],
      [[3, .67, 'regular'], [2, -.38, 'slot'], [0, -.46, 'slot']],
      [[2, 0, 'panorama'], [3, -.52, 'slot'], [1, .30, 'slot']],
    ],
  },
  service: {
    doors: [[0, -.48, 1.8], [1, .33, 1.65]], rail: .76,
    windows: [
      [[2, .24, 'slot'], [3, -.38, 'regular']],
      [[0, .43, 'regular'], [2, -.4, 'regular'], [1, .48, 'slot']],
      [[3, 0, 'wide'], [2, .4, 'slot']],
    ],
  },
  depot: {
    doors: [[0, 0, 2.55], [2, -.52, 1.8]], rail: .87,
    windows: [
      [[0, -.69, 'slot'], [3, .34, 'slot']],
      [[3, .48, 'wide'], [1, -.32, 'regular'], [2, .45, 'slot']],
      [[0, 0, 'wide'], [3, -.55, 'slot'], [2, -.4, 'slot']],
    ],
  },
  hall: {
    doors: [[0, -.48, 3.1], [2, -.32, 2.35], [3, 0, 2.25]], rail: .96,
    windows: [
      [[0, .51, 'wide'], [1, -.42, 'slot'], [3, .64, 'regular']],
      [[0, -.46, 'panorama'], [0, .43, 'wide'], [2, .24, 'panorama'], [1, .56, 'slot']],
      [[0, .15, 'panorama'], [3, -.4, 'wide'], [2, -.52, 'regular']],
    ],
  },
  arcade: {
    doors: [[0, -.48, 2.4], [0, .48, 2.05], [1, .22, 1.65]], rail: .88,
    windows: [
      [[3, -.37, 'tall'], [2, .48, 'slot']],
      [[0, -.48, 'tall'], [0, .48, 'tall'], [3, 0, 'wide'], [2, -.54, 'regular']],
      [[1, .42, 'regular'], [3, -.41, 'wide'], [2, .47, 'slot']],
    ],
  },
  lab: {
    doors: [[0, .52, 1.95], [2, .1, 2.15]], rail: .81,
    windows: [
      [[0, -.32, 'wide'], [1, .44, 'slot']],
      [[0, -.3, 'panorama'], [3, .31, 'panorama'], [2, -.51, 'regular']],
      [[1, .24, 'wide'], [2, .51, 'slot'], [3, -.44, 'wide']],
    ],
  },
  research: {
    doors: [[0, .34, 2.3], [2, .48, 1.85]], rail: .92,
    windows: [[[0, -.32, 'slot']], [[2, .36, 'slot']]],
    partitions: [[2.05, -.95, .24, 5.6], [-2.8, -2.2, .24, 2.3]],
  },
  utility: {
    doors: [[0, -.35, 1.95], [1, .05, 1.7]], rail: .87,
    windows: [[[0, .46, 'slot']], [[3, .27, 'slot']]],
  },
};

const profiles = {
  foundry: {
    'operations-tower-0': design('watch', 0, fold(0, -1)),
    'operations-tower-1': design('service', 2, fold(1, .92, 1.48, -1)),
  },
  longrail: {
    'operations-tower-0': design('depot', 2, fold(0, -.88, 1.48, -1)),
    'operations-tower-1': design('service', 0, straight(0, -.87, 1.7)),
  },
  drydock: {
    warehouse: design('hall', 0, straight(0, .24, 3.05), fold(0, -.95, 1.5, -1)),
    'operations-tower-0': design('service', 0, fold(0, .94, 1.37)),
    'operations-tower-1': design('depot', 1, straight(3, .64, 1.85)),
  },
  blocknine: {
    'building-0-0': design('hall', 0, fold(0, -.92, 1.55), straight(0, .91, 1.53)),
    'building-0-1': design('arcade', 2, straight(3, -.78, 2.45)),
    'building-1-0': design('service', 1, fold(1, .84, 1.55, -1)),
    'building-1-1': design('lab', 1, fold(0, .92, 1.49), fold(0, -.92, 1.4)),
    'center-west': design('arcade', 1, fold(0, .95, 1.35, -1)),
    'center-east': design('depot', 3, straight(3, -.76, 2.06)),
    'operations-tower-0': design('watch', 3, fold(3, .92, 1.35, -1)),
    'operations-tower-1': design('service', 2, fold(0, .7, 1.42)),
  },
  whiteout: {
    'lab-west': design('lab', 2, straight(1, .71, 2.4)),
    'lab-east': design('research', 0, fold(0, -.95, 1.48), straight(2, -.65, 1.68)),
    'operations-tower-0': design('service', 2, fold(1, .92, 1.42)),
    'operations-tower-1': design('utility', 0, fold(0, .86, 1.48)),
  },
  redline: {
    'depot-0': design('depot', 2, straight(1, -.86, 1.95)),
    'depot-1': design('service', 3, fold(0, .93, 1.38)),
    'depot-2': design('hall', 1, straight(0, -.8, 2.35)),
    'depot-3': design('depot', 0, fold(1, .96, 1.44, -1)),
    'operations-tower-0': design('watch', 0, fold(2, -.92, 1.37)),
    'operations-tower-1': design('service', 2, straight(0, .87, 1.62)),
  },
  overgrowth: {
    'botanical-lab--1': design('lab', 3, straight(0, -.85, 2.18)),
    'botanical-lab-1': design('hall', 2, fold(0, -.93, 1.55), straight(0, .89, 1.55)),
    'operations-tower-0': design('watch', 2, fold(0, .91, 1.36, -1)),
    'operations-tower-1': design('service', 3, straight(3, .85, 1.72)),
  },
  nightmarket: {
    'restaurant-0': design('arcade', 0, fold(2, -.9, 1.59)),
    'restaurant-1': design('depot', 2, straight(0, -.83, 2.24)),
    'restaurant-2': design('arcade', 1, fold(3, .92, 1.48), straight(3, -.60, 1.55)),
    'restaurant-3': design('hall', 2, straight(0, -.85, 2.3)),
    'operations-tower-0': design('watch', 3, fold(2, -.9, 1.39, -1)),
  },
};

export const buildingProfile = (world, id) => profiles[world]?.[id] || design('service', 0, fold(0, -.90));

export const ROOF_BRIDGES = {
  blocknine: [{ id: 'civic-skywalk', name: '시청 연결교', from: 'building-0-0', to: 'operations-tower-0', axis: 'x', at: -20.5, width: 2.45, style: 'steel' }],
  whiteout: [{ id: 'lab-link', name: '연구동 연결교', from: 'lab-east', to: 'operations-tower-1', axis: 'x', at: 9.6, width: 2.55, style: 'lab' }],
  nightmarket: [{ id: 'market-veranda', name: '시장 지붕길', from: 'restaurant-2', to: 'restaurant-3', axis: 'z', at: 25.5, width: 2.4, style: 'covered' }],
};
