import * as THREE from '/vendor/three.module.js';

export function drawNightMarket({ scene, group, world, add, beam, sign, color }) {
  color('ginkgo', '#b9a24f'); color('ginkgo-light', '#d1bc67'); color('plaza-stone', '#a98f75'); color('plaza-border', '#d1b995');
  const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  add('plaza-stone', [16, 16, 1], [13, .012, 14], flat, 'disc');
  add('plaza-border', [16.6, 16.6, 1], [13, .016, 14], flat, 'ring');
  for (let i = 0; i < 9; i++) {
    const angle = i * Math.PI * 2 / 9, branch = [13 + Math.cos(angle) * 4.5, 9 + i % 3, 14 + Math.sin(angle) * 4];
    beam('wood', [13, 6.5, 14], branch, .5, 'tube');
    add(i % 3 ? 'ginkgo' : 'ginkgo-light', [3, 1.2, 2.5], [branch[0], branch[1] + .7, branch[2]], null, 'leaf');
    for (let leaf = 0; leaf < 4; leaf++) add('ginkgo-light', [.8, .09, .5], [branch[0] + Math.cos(leaf * 2) * 1.5, branch[1] + .7, branch[2] + Math.sin(leaf * 2) * 1.5], new THREE.Quaternion().setFromEuler(new THREE.Euler(.2, leaf, .1)), 'leaf');
  }
  sign('밤빛마당', '은행나무 쉼터 / 야시장 먹거리 광장', [13, .5, 16.53], 3.4, .6, 0, '#f2ce8e');

  const menus = ['한밤국밥', '밤빛분식', '달빛식당', '골목만두'];
  for (const [index, building] of world.buildings.entries()) {
    const z = building.z + building.d / 2 + .035, focusX = building.x > 10 ? 13 : -8, innerSide = building.x < focusX ? 1 : -1;
    sign(menus[index % menus.length], '2층 식당 · 계단 이용', [building.x, 2.7, z], Math.min(6, building.w - .6), .5, 0, index % 2 ? '#9be8df' : '#ffd199');
    sign(menus[index % menus.length], '밤빛시장 · 계단은 건물 앞쪽', [building.x + innerSide * (building.w / 2 + .035), 2.7, building.z], Math.min(6, building.d - .6), .5, innerSide * Math.PI / 2, index % 2 ? '#9be8df' : '#ffd199');
    sign('식당 2F', 'DINING UPSTAIRS', [building.x + innerSide * (building.w / 2 + .035), 5.65, building.z], 3, .5, innerSide * Math.PI / 2, '#f1a6b6');
    add(index % 2 ? 'cyan' : 'amber', [building.w - .5, .055, .08], [building.x, 3.08, z]);
  }
  const entrances = [
    { text: '밤빛시장', sub: '분식골목 / STREET FOOD', p: [-8, 5, -29.7], rotation: 0 },
    { text: '달빛식당가', sub: 'DINING STREET', p: [-8, 5, 27.7], rotation: Math.PI },
    { text: '장터 뒷길', sub: 'DELIVERY ALLEY', p: [-36.7, 5, -13], rotation: Math.PI / 2 },
    { text: '밤빛마당', sub: 'GINKGO COURTYARD', p: [33.7, 5, 13], rotation: -Math.PI / 2 },
  ];
  for (const { text, sub, p, rotation } of entrances) sign(text, sub, p, 7, 1.6, rotation, '#ffd09d');
  const lantern = (x, y, z, pink = false) => { add(pink ? 'red' : 'amber', [.27, .42, .27], [x, y, z]); add('trim', [.3, .045, .3], [x, y + .23, z]); };
  for (const z of [-22, -12, -2]) {
    beam('trim', [-19.5, 5.5, z], [-8, 4.9, z + .3], .035); beam('trim', [-8, 4.9, z + .3], [3.5, 5.5, z], .035);
    for (let i = 0; i < 7; i++) lantern(-18.5 + i * 3.5, 5 + Math.abs(i - 3) * .12, z + .25, i % 3 === 0);
  }
  for (const end of [[0, 11], [3, 25], [31, 11], [29, 26]]) {
    beam('trim', [13, 6.7, 14], [end[0], 5.5, end[1]], .035);
    for (let step = 1; step <= 5; step++) { const t = step / 6; lantern(13 + (end[0] - 13) * t, 6.7 - 1.2 * t, 14 + (end[1] - 14) * t, step % 3 === 0); }
  }
  // Faded center markings turn with the street; the circular courtyard is not
  // a rectangular arena with decorative market stalls dropped into it.
  for (let z = -23; z < 8; z += 4) add('cream', [.09, .012, 1.4], [-8, .022, z]);
  for (let x = -5; x < 5; x += 3) add('cream', [1.4, .012, .09], [x, .022, 11]);
  for (let i = 0; i < 25; i++) {
    const angle = i * 2.39996, radius = 3 + i % 4 * 1.3;
    add('ginkgo', [.12, .008, .075], [13 + Math.cos(angle) * radius, .025, 14 + Math.sin(angle) * radius], null, 'leaf');
  }
  const lamps = [];
  for (const [x, z, tint] of [[-8, -13, '#ffa968'], [-8, 3, '#7ed4d0'], [13, 14, '#ffc271']]) {
    const lamp = new THREE.PointLight(tint, 9, 17, 2); lamp.position.set(x, 4.8, z); scene.add(lamp); lamps.push(lamp);
  }
  // Closed street-front annexes are real, solid map boundaries. Windows are
  // opaque panes, unlike the actual openings in the traversable restaurants.
  let shop = 0;
  for (const annex of world.obstacles.filter((b) => b.kind === 'closed-annex' && b.w >= 6 && b.d >= 5)) {
    if (shop >= 6) break;
    sign(['수선집', '한빛상회', '오래된 사진관', '밤빛다방', '동네서점', '과일가게'][shop], '영업 종료 / CLOSED', [annex.x, 3, annex.z + annex.d / 2 + .04], Math.min(5, annex.w - .5), .65, 0, shop % 2 ? '#9be8df' : '#f1a6b6'); shop++;
  }
  group.userData.market = { entrances: entrances.length, foodStalls: 10, doglegStreet: true, ginkgoCourtyard: true };
  return lamps;
}
