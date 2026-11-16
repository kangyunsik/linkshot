// Hand-authored team-only terrain. No legacy hollow-building/stair expansion.
const box = (id, x, z, w, d, h, kind = 'rock', y = 0, extra = {}) => ({ id, x, z, w, d, h, y, kind, ...extra });
const deck = (id, x, z, w, d, height) => box(id, x, z, w, d, .28, 'terrain-deck', height - .28, { walkable: true });
const ramp = (id, x, z, w, d, axis, low, high) => box(id, x, z, w, d, Math.max(low, high), 'ramp', 0, { walkable: true, slope: { axis, low, high } });
const cylinder = (id, x, z, diameter, h, kind = 'pipe', y = 0) => box(id, x, z, diameter, diameter, h, kind, y, { shape: 'cylinder' });
function arena(config, obstacles, spawns) {
  const { width: w, depth: d } = config;
  const perimeter = [box('north', 0, -d / 2 - .5, w + 2, 1, 6, 'wall'), box('south', 0, d / 2 + .5, w + 2, 1, 6, 'wall'), box('west', -w / 2 - .5, 0, 1, d + 2, 6, 'wall'), box('east', w / 2 + .5, 0, 1, d + 2, 6, 'wall')];
  return Object.freeze({ ...config, terrain: true, image: `${config.id}-hero.png`, previewImage: `maps/${config.id}.svg`, buildings: [], walkways: [], platforms: [], extraCover: [], coverWalls: [], obstacles: [...perimeter, ...obstacles], spawns });
}
function sideSpawns(x, zs = [-12, -6, 6, 12]) {
  return [-1, 1].flatMap((side) => zs.map((z, i) => ({ x: side * x, y: 0, z, yaw: side < 0 ? -Math.PI / 2 : Math.PI / 2, teamId: side < 0 ? 'blue' : 'red', spawnId: `team-${side}-${i}`, exitPath: [{ x: side * (x - 3), y: 0, z }] })));
}
const faultline = arena({ id: 'faultline', name: 'FAULTLINE', title: 'FAULTLINE', label: '폐광 채석장', width: 76, depth: 68, theme: 'quarry', tag: '팀전 전용 · 절벽/굴착 터널', gameTypes: ['teams'], navLayers: [0, 3], sky: '#777d79', ground: '#857862', wall: '#605d53', accent: '#d1a767', light: '#ffe0b1', description: '북쪽 절벽길과 중앙 채굴 분지, 앉아 통과하는 굴착 터널을 연결한 팀전 전용 채석장.' }, [
  deck('north-ridge', 0, -23, 56, 10, 3), ramp('ridge-west-ramp', -25, -9, 6, 18, 'z', 3, 0), ramp('ridge-east-ramp', 25, -9, 6, 18, 'z', 3, 0),
  ...[-1, 1].flatMap((side) => [box(`spawn-screen-${side}`, side * 27, 0, 2.4, 10, 3.8), box(`spawn-rock-a-${side}`, side * 29, -15, 3, 3, 2.5), box(`spawn-rock-b-${side}`, side * 29, 15, 3, 3, 2.5), box(`ridge-cover-${side}`, side * 12, -22, 5, 2.4, 1.25, 'rock', 3), box(`center-cover-${side}`, side * 9, -3, 5, 4, 2.7), box(`jump-rock-${side}`, side * 11, 11, 3, 2.2, 1.05), box(`tunnel-wall-${side}`, side * 9, 24, 2, 12, 3)]),
  box('drill-base', 0, 1, 6, 5, 2.6, 'machine'), cylinder('drill-tower', 0, 1, 2.6, 5, 'machine', 2.6),
  box('tunnel-roof', 0, 24, 16, 10, .65, 'tunnel-roof', 1.25), box('tunnel-end-cover-west', -17, 25, 3, 3, 2), box('tunnel-end-cover-east', 17, 21, 3, 3, 2),
  ...[-18, 0, 18].map((x, i) => box(`ridge-support-${i}`, x, -23, 1.4, 8, 2.72, 'support')),
], sideSpawns(33));

const sump = arena({ id: 'sump', name: 'SUMP', title: 'SUMP', label: '원형 지하 저수조', width: 68, depth: 68, theme: 'reservoir', tag: '팀전 전용 · 상하부 은신/입체 우회', gameTypes: ['teams'], navLayers: [0, 2.4], sky: '#172e38', ground: '#506764', wall: '#38525b', accent: '#8dc6b0', light: '#c9e9e3', description: '네 방향 경사로, 서서 이동하는 하부 회랑과 낮은 정비 은신처, 차폐벽으로 나뉜 원형 순환로의 팀전 전용 저수조.' }, [
  // Keep the 2.4m upper route, but leave standing headroom in the undercroft.
  box('outer-ring', 0, 0, 56, 56, .4, 'terrain-deck', 2, { walkable: true, shape: 'ring', innerRadius: 14, cutHalf: 2.5 }),
  ...Array.from({ length: 16 }, (_, i) => { const angle = i * Math.PI * 2 / 16; return Math.abs(Math.sin(angle)) < .22 || Math.abs(Math.cos(angle)) < .22 ? null : cylinder(`outer-pier-${i}`, Math.cos(angle) * 30, Math.sin(angle) * 30, 4.6, 7, 'wall'); }).filter(Boolean),
  ramp('west-outer-ramp', -29, 0, 10, 5, 'x', 0, 2.4), ramp('east-outer-ramp', 29, 0, 10, 5, 'x', 2.4, 0),
  ramp('north-outer-ramp', 0, -29, 5, 10, 'z', 0, 2.4), ramp('south-outer-ramp', 0, 29, 5, 10, 'z', 2.4, 0),
  ramp('west-inner-ramp', -16, 0, 10, 5, 'x', 2.4, 0), ramp('east-inner-ramp', 16, 0, 10, 5, 'x', 0, 2.4),
  ramp('north-inner-ramp', 0, -16, 5, 10, 'z', 2.4, 0), ramp('south-inner-ramp', 0, 16, 5, 10, 'z', 0, 2.4),
  deck('west-ring-bridge', -22.5, 0, 3, 5, 2.4), deck('east-ring-bridge', 22.5, 0, 3, 5, 2.4), deck('north-ring-bridge', 0, -24.5, 5, 7, 2.4), deck('south-ring-bridge', 0, 24.5, 5, 7, 2.4),
  cylinder('central-baffle', 0, 0, 4.5, 3.8, 'machine'),
  ...[-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [
    box(`basin-baffle-${sx}-${sz}`, sx * 7, sz * 7, 4, .9, 2.1, 'machine'),
    box(`basin-low-return-${sx}-${sz}`, sx * 8.6, sz * 5.6, .8, 3.6, 1.15, 'machine'),
    box(`lower-screen-${sx}-${sz}`, sx * 20, sz * 11, 1, 5, 2, 'support'),
    box(`ring-baffle-${sx}-${sz}`, sx * 16, sz * 20, 4.8, 1.1, 2.1, 'machine', 2.4),
    box(`ring-low-return-${sx}-${sz}`, sx * 19, sz * 18.5, 1.1, 4.1, 1.15, 'machine', 2.4),
    cylinder(`ring-pipe-${sx}-${sz}`, sx * 22, sz * 9, 1.8, 2.1, 'pipe', 2.4),
  ])),
  ...[-1, 1].flatMap((side) => [
    box(`spawn-screen-${side}`, side * 31, side * 13, 1.2, 5, 3.5),
    box(`maintenance-roof-${side}`, side * 8, -side * 22, 5, 7, .35, 'tunnel-roof', 1.25),
    box(`maintenance-screen-${side}`, side * 12, -side * 22, 1, 7, 2, 'support'),
  ]),
], sideSpawns(31, [-8, -4, 4, 8]));

const relay = arena({ id: 'relay', name: 'RELAY', title: 'RELAY', label: '순환 중계소', width: 72, depth: 64, theme: 'relay', tag: '이동 거점전 전용', gameTypes: ['hardpoint'], navLayers: [0, 2.4, 1.2], sky: '#52727b', ground: '#798981', wall: '#42626b', accent: '#76d9c3', light: '#e4f5df', description: '중앙 중계판과 북쪽 고지대, 남쪽 정비 데크를 45초마다 이동하며 점령하는 전용 전장.', hardpoints: [{ id: 'A', name: '중앙 중계판', x: 0, y: 0, z: 0, radius: 4.8 }, { id: 'B', name: '북쪽 안테나', x: 0, y: 2.4, z: -20, radius: 4.8 }, { id: 'C', name: '남쪽 정비 데크', x: 0, y: 1.2, z: 20, radius: 4.8 }] }, [
  deck('north-node', 0, -20, 20, 12, 2.4), deck('south-node', 0, 20, 20, 12, 1.2),
  ramp('north-west-ramp', -16, -20, 12, 6, 'x', 0, 2.4), ramp('north-east-ramp', 16, -20, 12, 6, 'x', 2.4, 0),
  ramp('south-west-ramp', -16, 20, 12, 6, 'x', 0, 1.2), ramp('south-east-ramp', 16, 20, 12, 6, 'x', 1.2, 0),
  ...[-1, 1].flatMap((side) => [box(`spawn-screen-${side}`, side * 25, 0, 2.5, 10, 3.4, 'machine'), box(`center-screen-${side}`, side * 9, side * 6, 5, 3, 2.2, 'machine'), cylinder(`central-relay-${side}`, side * 5, -side * 2, 1.6, 1.1, 'pipe'), box(`north-cover-${side}`, side * 5, -22, 3, 2, 1.2, 'machine', 2.4), box(`south-cover-${side}`, side * 5, 22, 3, 2, 1.1, 'machine', 1.2)]),
  cylinder('north-aerial', 0, -24.5, 1.1, 6, 'antenna', 2.4), cylinder('south-aerial', 0, 24.5, 1.1, 4, 'antenna', 1.2),
  // Break approach sightlines without closing either ramp or the capture slots.
  ...[-1, 1].flatMap((side) => [
    box(`point-a-low-${side}`, side * 3.8, 0, .9, 3.2, 1.15, 'machine'),
    box(`point-a-screen-${side}`, 0, side * 6.5, 5, .9, 2.2, 'machine'),
    ...[-1, 1].map((end) => box(`approach-relay-${side}-${end}`, side * 18, end * 11, 3.6, 2.4, 2.1, 'machine')),
    box(`north-side-cover-${side}`, side * 6.5, -18.5, 1.1, 4.4, 2.1, 'machine', 2.4),
    box(`north-front-cover-${side}`, side * 4, -15.5, 3.2, 1, 1.15, 'machine', 2.4),
    box(`south-side-cover-${side}`, side * 6.5, 18.5, 1.1, 4.4, 2.1, 'machine', 1.2),
    box(`south-front-cover-${side}`, side * 4, 15.5, 3.2, 1, 1.15, 'machine', 1.2),
  ]),
  box('north-back-cover', 0, -23.5, 3.2, 1, 2.1, 'machine', 2.4), box('south-back-cover', 0, 23.5, 3.2, 1, 2.1, 'machine', 1.2),
], sideSpawns(31));

const defenseSpawns = [
  ...[[-27, 38], [-15, 38], [-6, 38], [6, 38], [15, 38], [27, 38], [-23, 29], [23, 29]].map(([x, z], i) => ({ x, y: 0, z, yaw: 0, teamId: 'blue', spawnId: `defender-${i}`, exitPath: [{ x, y: 0, z: z - 3 }] })),
  ...[...[-24, -16, -8, 8, 16, 24].map((x) => [x, -38]), ...[-1, 1].flatMap((side) => [-28, -20, -12].map((z) => [side * 42, z]))].map(([x, z], i) => ({ x, y: 0, z, yaw: Math.atan2(-x, -(28 - z)), teamId: 'red', spawnId: `wave-entry-${i}`, exitPath: [{ x: Math.abs(x) === 42 ? x - Math.sign(x) * 4 : x, y: 0, z: Math.abs(x) === 42 ? z : z + 4 }] })),
];
const bastion = arena({ id: 'bastion', name: 'BASTION', title: 'BASTION', label: '협동 방어 기지', width: 96, depth: 88, theme: 'bastion', tag: '협동 방어 · 다층 방어선/무작위 공세', gameTypes: ['defense'], navLayers: [0, 1.2, 1.8], sky: '#263a46', ground: '#6c7773', wall: '#45515a', accent: '#e3a56a', light: '#ffe2bb', description: '외곽 공세 진입부와 펌프 야드, 양쪽 고지대, 후방 차폐 코어실을 잇는 대형 협동 방어 전장. 공세는 여러 진입 지점에서 무작위로 등장합니다.', defenseCore: { id: 'defense-core', x: 0, y: 0, z: 28, w: 4, d: 4, h: 3 }, defensePosts: [{ x: -16, y: 0, z: 14 }, { x: 16, y: 0, z: 14 }, { x: -18, y: 0, z: 29 }, { x: 18, y: 0, z: 29 }], defenseApproaches: [{ x: -6, y: 0, z: 34 }, { x: 6, y: 0, z: 34 }] }, [
  box('defense-core', 0, 28, 4, 4, 3, 'core'),
  // The core is shielded from every entry lane; attackers must round a flank
  // and breach a rear entrance. Protection is physical, not damage immunity.
  box('core-front-shield', 0, 20, 18, 2, 5.2, 'wall'),
  ...[-1, 1].map((side) => box(`core-side-shield-${side}`, side * 10, 27, 2, 12, 4.8, 'wall')),
  box('core-canopy', 0, 27, 20, 14, .5, 'tunnel-roof', 5.2), box('core-rear-baffle', 0, 35, 8, 1.2, 3.8, 'machine'),
  box('north-splitter', 0, -29, 5, 8, 4, 'machine'),
  ...[-1, 1].flatMap((side) => [
    box(`north-berm-${side}`, side * 16, -26, 14, 4, 3.4),
    box(`side-berm-${side}`, side * 33, -18, 6, 10, 3.3),
    cylinder(`pump-tank-${side}`, side * 13, -10, 5.8, 4.4, 'pipe'),
    box(`front-cover-${side}`, side * 6, 11, 4, 2, 1.15, 'machine'),
    box(`middle-screen-${side}`, side * 18, 8, 6, 2, 2.2, 'machine'),
    cylinder(`core-flank-pump-${side}`, side * 17, 23, 3.4, 2.5, 'machine'),
    box(`rear-cover-${side}`, side * 22, 34, 5, 2, 1.4, 'machine'),
    box(`rear-storage-${side}`, side * 34, 32, 5, 6, 3, 'machine'),
    deck(`flank-deck-${side}`, side * 31, 7, 10, 10, 1.8),
    ramp(`flank-north-ramp-${side}`, side * 31, -4, 5, 12, 'z', 0, 1.8),
    ramp(`flank-south-ramp-${side}`, side * 31, 18, 5, 12, 'z', 1.8, 0),
    box(`flank-low-cover-${side}`, side * 31, 7, 5, 1.2, 1.15, 'machine', 1.8),
    box(`flank-high-cover-${side}`, side * 33, 10, 1, 3, 2.1, 'machine', 1.8),
  ]),
  deck('support-deck', 0, -4, 16, 10, 1.2), ramp('support-ramp-west', -14, -4, 12, 6, 'x', 0, 1.2), ramp('support-ramp-east', 14, -4, 12, 6, 'x', 1.2, 0),
  box('maintenance-roof', 0, -19, 8, 7, .45, 'tunnel-roof', 1.25),
], defenseSpawns);

export const TEAM_WORLDS = Object.freeze([faultline, sump, relay, bastion]);
