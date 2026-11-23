const WEAPON_MOVEMENT = {
  rifle: { walkMultiplier: 1, sprintMultiplier: 1 },
  smg: { walkMultiplier: 1.06, sprintMultiplier: 1.05 },
  shotgun: { walkMultiplier: 0.92, sprintMultiplier: 0.94 },
  sniper: { walkMultiplier: 0.86, sprintMultiplier: 0.88 },
  pistol: { walkMultiplier: 1.1, sprintMultiplier: 1.08 },
  lmg: { walkMultiplier: 0.78, sprintMultiplier: 0.82 },
  dmr: { walkMultiplier: 0.92, sprintMultiplier: 0.93 },
  ak47: { walkMultiplier: 0.94, sprintMultiplier: 0.96 },
  m4a1: { walkMultiplier: 1.02, sprintMultiplier: 1 },
  famas: { walkMultiplier: 1, sprintMultiplier: 1 },
  mp5: { walkMultiplier: 1.08, sprintMultiplier: 1.06 },
  p90: { walkMultiplier: 1.04, sprintMultiplier: 1.05 },
  ump45: { walkMultiplier: 1.03, sprintMultiplier: 1.02 },
  awp: { walkMultiplier: 0.76, sprintMultiplier: 0.82 },
  m82: { walkMultiplier: 0.66, sprintMultiplier: 0.73 },
  spas12: { walkMultiplier: 0.88, sprintMultiplier: 0.92 },
  deagle: { walkMultiplier: 1.0, sprintMultiplier: 1.02 },
  m249: { walkMultiplier: 0.7, sprintMultiplier: 0.76 },
  m14: { walkMultiplier: 0.9, sprintMultiplier: 0.92 },
  glock18c: { walkMultiplier: 1.1, sprintMultiplier: 1.08 },
  an94: { walkMultiplier: .97, sprintMultiplier: .97 },
  s686: { walkMultiplier: .94, sprintMultiplier: .94 },
  vector: { walkMultiplier: 1.07, sprintMultiplier: 1.06 },
};

const WEAPON_PRICES = { smg: 600, lmg: 1200, dmr: 1100, ak47: 1400, m4a1: 1600, famas: 1800, mp5: 900, p90: 1500, ump45: 1000, awp: 1900, m82: 2000, spas12: 1300, deagle: 1200, m249: 1700, m14: 1400, glock18c: 800, an94: 1700, s686: 1300, vector: 1600 };

export const WEAPONS = Object.freeze([
  { id: 'rifle', slot: 1, name: 'VX–7', label: '돌격소총', type: 'ASSAULT', action: 'AUTO', magazine: 30, fireSeconds: 0.105, reloadSeconds: 1.75, damage: 28, headDamage: 56, pellets: 1, spread: 0.0105, adsSpread: 0.0032, spreadBloom: 0.023, range: 110, falloffStart: 40, minDamage: 0.75, zoom: 0.73, recoil: 1.7, automatic: true, caliber: '5.56 MM', description: '정밀도와 위력의 균형을 잡은 기본 소총. 연사하면 탄이 퍼지므로 중거리에서는 짧게 끊어 쏘기 좋습니다.' },
  { id: 'pistol', slot: 2, name: 'PX–9', label: '권총', type: 'SIDEARM', action: 'SEMI', magazine: 15, fireSeconds: 0.20, reloadSeconds: 1.15, damage: 32, headDamage: 56, pellets: 1, spread: 0.013, adsSpread: 0.003, range: 65, falloffStart: 20, minDamage: 0.55, zoom: 0.82, recoil: 0.8, automatic: false, caliber: '9 MM', description: '가벼운 반자동 권총. 빠른 재장전과 정확한 단발 사격으로 빈틈을 공략하세요.' },
  { id: 'shotgun', slot: 3, name: 'SG–12', label: '산탄총', type: 'SHOTGUN', action: 'PUMP', magazine: 8, fireSeconds: 0.78, reloadSeconds: 2.4, damage: 16, headDamage: 24, pellets: 8, spread: 0.068, adsSpread: 0.044, range: 32, falloffStart: 7, minDamage: 0.15, zoom: 0.82, recoil: 1.9, automatic: false, caliber: '12 GAUGE', description: '조밀한 8개 산탄과 넉넉한 탄창의 기본 산탄총. 근거리 정조준에 강하지만 거리가 벌어지면 피해가 빠르게 줄어듭니다.' },
  { id: 'sniper', slot: 4, name: 'SR–1', label: '저격소총', type: 'SNIPER', action: 'BOLT', magazine: 5, fireSeconds: 1.15, reloadSeconds: 2.65, damage: 100, headDamage: 150, pellets: 1, spread: 0.084, adsSpread: 0.00092, spreadBloom: 0.010, range: 200, falloffStart: 150, minDamage: 0.9, zoom: 0.30, recoil: 2.3, automatic: false, caliber: '7.62 MM', description: '저격총 중 정지 정조준 탄 퍼짐이 가장 작습니다. 노줌·이동 사격은 탄이 크게 퍼집니다.' },
  { id: 'smg', slot: 5, name: 'PD–9', label: '기관단총', type: 'SMG', action: 'AUTO', magazine: 36, fireSeconds: 0.062, reloadSeconds: 1.45, damage: 19, headDamage: 30, pellets: 1, spread: 0.018, adsSpread: 0.006, range: 60, falloffStart: 16, minDamage: 0.42, zoom: 0.82, recoil: 0.58, automatic: true, caliber: '9 MM', description: '빠른 연사와 짧은 재장전. 좁은 골목과 적극적인 근접전에 특화.' },
  { id: 'lmg', slot: 6, name: 'LM–60', label: '경기관총', type: 'LMG', action: 'AUTO', magazine: 60, fireSeconds: 0.09, reloadSeconds: 3.35, damage: 24, headDamage: 40, pellets: 1, spread: 0.019, adsSpread: 0.0045, range: 120, falloffStart: 45, minDamage: 0.7, zoom: 0.76, recoil: 1.2, automatic: true, caliber: '5.56 MM', description: '60발 탄창과 안정적인 정조준으로 중거리를 제압합니다. 무거운 이동과 긴 재장전은 엄폐로 보완하세요.' },
  { id: 'dmr', slot: 7, name: 'MR–14', label: '지정사수소총', type: 'DMR', action: 'SEMI', magazine: 12, fireSeconds: 0.30, reloadSeconds: 2.05, damage: 52, headDamage: 100, pellets: 1, spread: 0.022, adsSpread: 0.0038, spreadBloom: 0.018, range: 160, falloffStart: 70, minDamage: 0.75, zoom: 0.48, recoil: 1.55, automatic: false, caliber: '7.62 MM', description: '위력이 높은 반자동 소총. 피해 감소 전 헤드샷은 한 발로 제압하지만 M14보다 탄이 더 퍼집니다.' },
  { id: 'ak47', model: 'rifle', slot: 8, name: 'AK-47', label: '강타격 돌격소총', type: 'ASSAULT', action: 'AUTO', magazine: 30, fireSeconds: 0.115, reloadSeconds: 2.25, damage: 36, headDamage: 72, pellets: 1, spread: 0.021, adsSpread: 0.0061, spreadBloom: 0.034, range: 125, falloffStart: 45, minDamage: 0.7, zoom: 0.73, recoil: 2.2, automatic: true, caliber: '7.62×39 MM', description: '한 발 위력이 높은 대신 정조준 중에도 M4A1보다 탄이 넓게 퍼집니다. 연사보다 짧은 점사가 안정적입니다.' },
  { id: 'm4a1', model: 'rifle', slot: 9, name: 'M4A1', label: '경량 돌격소총', type: 'ASSAULT', action: 'AUTO', magazine: 30, fireSeconds: 0.085, reloadSeconds: 1.9, damage: 26, headDamage: 52, pellets: 1, spread: 0.007, adsSpread: 0.00245, spreadBloom: 0.016, range: 120, falloffStart: 40, minDamage: 0.75, zoom: 0.73, recoil: 1.25, automatic: true, caliber: '5.56×45 MM', description: '낮은 반동과 좁은 탄 퍼짐의 경량 소총. 비조준과 짧은 연사 모두 안정적입니다.' },
  { id: 'famas', model: 'rifle', slot: 10, name: 'FAMAS F1', label: '3점사 소총', type: 'ASSAULT', action: '3-BURST', magazine: 25, fireSeconds: 0.075, burstCount: 3, burstPause: 0.24, reloadSeconds: 2.3, damage: 28, headDamage: 50, pellets: 1, spread: 0.014, adsSpread: 0.00405, spreadBloom: 0.027, range: 115, falloffStart: 38, minDamage: 0.7, zoom: 0.74, recoil: 1.3, automatic: false, caliber: '5.56×45 MM', description: '클릭 한 번에 3발을 점사합니다. 후속 탄이 더 퍼지므로 가까운 거리에서 세 발을 모아 맞히기 좋습니다.' },
  { id: 'mp5', model: 'smg', slot: 11, name: 'MP5', label: '정밀 기관단총', type: 'SMG', action: 'AUTO', magazine: 30, fireSeconds: 0.075, reloadSeconds: 1.6, damage: 21, headDamage: 36, pellets: 1, spread: 0.013, adsSpread: 0.004, range: 70, falloffStart: 18, minDamage: 0.5, zoom: 0.82, recoil: 0.5, automatic: true, caliber: '9×19 MM', description: '낮은 반동과 가벼운 조작감. 원형 조준기와 슬림한 몸체를 가진 근거리 정밀 SMG.' },
  { id: 'p90', model: 'smg', slot: 12, name: 'FN P90', label: '50발 고속 PDW', type: 'SMG', action: 'AUTO', magazine: 50, fireSeconds: 0.052, reloadSeconds: 2.4, damage: 16, headDamage: 29, pellets: 1, spread: 0.02, adsSpread: 0.0055, range: 80, falloffStart: 22, minDamage: 0.55, zoom: 0.82, recoil: 0.62, automatic: true, caliber: '5.7×28 MM', description: '상부 수평 탄창에 50발. 낮은 단발 피해 대신 빠른 연사와 긴 압박을 제공하지만 재장전은 느립니다.' },
  { id: 'ump45', model: 'smg', slot: 13, name: 'UMP45', label: '중타격 기관단총', type: 'SMG', action: 'AUTO', magazine: 25, fireSeconds: 0.11, reloadSeconds: 2.1, damage: 28, headDamage: 50, pellets: 1, spread: 0.015, adsSpread: 0.005, range: 65, falloffStart: 18, minDamage: 0.45, zoom: 0.82, recoil: 1, automatic: true, caliber: '.45 ACP', description: '느린 연사와 무거운 한 발. 각진 리시버와 접이식 개머리판의 중타격 SMG.' },
  { id: 'awp', model: 'sniper', slot: 14, name: 'AWP', label: '고배율 볼트 저격총', type: 'SNIPER', action: 'BOLT', magazine: 10, fireSeconds: 1.5, reloadSeconds: 3, damage: 100, headDamage: 160, pellets: 1, spread: 0.101, adsSpread: 0.00125, spreadBloom: 0.012, range: 230, falloffStart: 165, minDamage: 0.9, zoom: 0.27, recoil: 2.8, automatic: false, caliber: '7.62×51 MM', description: 'SR–1보다 사거리가 길고 헤드샷 위력이 높지만 정지 정조준 탄도 조금 더 퍼집니다.' },
  { id: 'm82', model: 'sniper', slot: 15, name: 'Barrett M82', label: '대구경 반자동 저격총', type: 'SNIPER', action: 'SEMI', magazine: 10, fireSeconds: 0.60, reloadSeconds: 3.4, damage: 80, headDamage: 160, pellets: 1, spread: 0.122, adsSpread: 0.0022, spreadBloom: 0.017, range: 240, falloffStart: 180, minDamage: 0.9, zoom: 0.42, recoil: 3.2, automatic: false, caliber: '.50 BMG', description: '빠른 후속 사격이 장점인 반자동 저격총. 볼트액션 저격총보다 탄이 더 퍼지며, 몸통은 두 발이 필요합니다.' },
  { id: 'spas12', model: 'shotgun', slot: 16, name: 'SPAS-12', label: '고위력 산탄총', type: 'SHOTGUN', action: 'PUMP', magazine: 6, fireSeconds: 0.75, reloadSeconds: 3, damage: 16, headDamage: 26, pellets: 9, spread: 0.078, adsSpread: 0.052, range: 30, falloffStart: 6, minDamage: 0.15, zoom: 0.82, recoil: 2.3, automatic: false, caliber: '12 GAUGE', description: '한 발에 9개 산탄과 강한 근거리 화력. 작은 6발 탄창과 긴 재장전을 감수하고 근접 순간 화력을 선택하는 산탄총입니다.' },
  { id: 'deagle', model: 'pistol', slot: 17, name: 'Desert Eagle', label: '대구경 권총', type: 'SIDEARM', action: 'SEMI', magazine: 7, fireSeconds: 0.36, reloadSeconds: 1.9, damage: 58, headDamage: 110, pellets: 1, spread: 0.028, adsSpread: 0.006, range: 95, falloffStart: 30, minDamage: 0.65, zoom: 0.77, recoil: 2.2, automatic: false, caliber: '.50 AE', description: '7발 탄창의 무거운 대구경 권총. 정확한 한 발은 강력하지만 연타 반동과 빗나간 탄의 대가도 큽니다.' },
  { id: 'm249', model: 'lmg', slot: 18, name: 'M249 SAW', label: '100발 분대지원화기', type: 'LMG', action: 'AUTO', magazine: 100, fireSeconds: 0.085, reloadSeconds: 4.2, damage: 22, headDamage: 38, pellets: 1, spread: 0.026, adsSpread: 0.0065, range: 135, falloffStart: 45, minDamage: 0.7, zoom: 0.76, recoil: 1.55, automatic: true, caliber: '5.56×45 MM', description: '100발 탄대와 안정적인 정조준으로 지속 제압합니다. 무거운 이동과 긴 재장전 때문에 돌격보다 엄폐 지원에 적합합니다.' },
  { id: 'm14', model: 'dmr', slot: 19, name: 'M14', label: '20발 전투소총', type: 'DMR', action: 'SEMI', magazine: 20, fireSeconds: 0.28, reloadSeconds: 2.45, damage: 46, headDamage: 90, pellets: 1, spread: 0.013, adsSpread: 0.00265, spreadBloom: 0.012, range: 175, falloffStart: 70, minDamage: 0.75, zoom: 0.5, recoil: 1.8, automatic: false, caliber: '7.62×51 MM', description: 'MR–14보다 탄 퍼짐이 작고 20발 탄창으로 후속 사격에 유리하지만 헤드샷 한 발 처치는 불가능합니다.' },
  { id: 'glock18c', model: 'pistol', slot: 20, name: 'Glock 18C', label: '자동권총', type: 'SIDEARM', action: 'AUTO', magazine: 33, fireSeconds: 0.06, reloadSeconds: 1.65, damage: 17, headDamage: 30, pellets: 1, spread: 0.026, adsSpread: 0.009, range: 60, falloffStart: 14, minDamage: 0.45, zoom: 0.83, recoil: 0.85, automatic: true, caliber: '9×19 MM', description: '33발 확장 탄창의 고속 자동권총. 가볍고 근거리 연사가 빠르지만 탄 퍼짐과 탄 소모를 주의하세요.' },
  { id: 'an94', model: 'rifle', slot: 21, name: 'AN-94', label: '초탄 2연발 소총', type: 'ASSAULT', action: 'HYPER / AUTO', magazine: 30, fireSeconds: .12, hyperburstCount: 2, hyperburstSeconds: .04, reloadSeconds: 2.35, damage: 26, headDamage: 50, pellets: 1, spread: .0088, adsSpread: .0021, spreadBloom: .020, range: 120, falloffStart: 38, minDamage: .68, zoom: .74, recoil: 1.45, automatic: true, caliber: '5.45×39 MM', description: '돌격소총 중 정지 정조준 초탄이 가장 촘촘합니다. 빠른 첫 두 발 뒤에는 연사가 느려집니다.' },
  { id: 's686', model: 'shotgun', slot: 22, name: 'S686', label: '2발 더블배럴', type: 'SHOTGUN', action: 'BREAK', magazine: 2, fireSeconds: .22, reloadSeconds: 2.65, damage: 16, headDamage: 24, pellets: 8, spread: .066, adsSpread: .044, range: 28, falloffStart: 5, minDamage: .12, zoom: .82, recoil: 2.25, automatic: false, caliber: '12 GAUGE', description: '위아래 두 총열의 빠른 두 발로 승부합니다. 초근접 순간 화력은 강하지만 짧은 사거리와 빗맞힌 뒤의 재장전이 큰 빈틈입니다.' },
  { id: 'vector', model: 'smg', slot: 23, name: 'KRISS Vector', label: '초근접 고속 SMG', type: 'SMG', action: 'AUTO', magazine: 19, fireSeconds: .045, reloadSeconds: 1.95, damage: 18, headDamage: 31, pellets: 1, spread: .022, adsSpread: .008, range: 50, falloffStart: 10, minDamage: .30, zoom: .82, recoil: .9, automatic: true, caliber: '.45 ACP', description: '19발을 순식간에 비우는 초근접 기관단총. 매우 가까운 적에 강하지만 10m 이후 피해가 빠르게 줄어 중거리 돌격소총을 대체하지는 못합니다.' },
].map((weapon) => Object.freeze({ ...weapon, price: WEAPON_PRICES[weapon.id] || 0, ...WEAPON_MOVEMENT[weapon.id] })));

export const FREE_WEAPON_IDS = Object.freeze(WEAPONS.filter((weapon) => !weapon.price).map((weapon) => weapon.id));
// Fallback equipment is deliberately outside the firearm shop/audio catalogue.
export const KNIFE = Object.freeze({ id: 'knife', model: 'knife', name: 'FIELD KNIFE', label: '근접 나이프', type: 'MELEE', action: 'SLASH', melee: true, magazine: 0, fireSeconds: .55, reloadSeconds: 0, damage: 45, headDamage: 45, pellets: 1, spread: 0, adsSpread: 0, range: 1.85, falloffStart: 1.85, minDamage: 1, zoom: 1, recoil: 0, automatic: false, caliber: '근접', walkMultiplier: 1.1, sprintMultiplier: 1.08 });
export const EQUIPMENT = Object.freeze([...WEAPONS, KNIFE]);
export const normalizeOwnedWeapons = (ids) => [...new Set([...FREE_WEAPON_IDS, ...(Array.isArray(ids) ? ids.filter((id) => WEAPONS.some((weapon) => weapon.id === id)) : [])])];
export const ownsWeapon = (profile, id) => FREE_WEAPON_IDS.includes(id) || Array.isArray(profile?.ownedWeapons) && profile.ownedWeapons.includes(id) && isWeaponId(id);

export const SKINS = Object.freeze([
  { id: 'standard', name: 'FIELD ISSUE', label: '필드 이슈', color: '#53636b', accent: '#e58458', dark: '#1e2b32', suit: '#53645d', visor: '#ffc08a', pattern: null },
  { id: 'circuit', name: 'NEON CIRCUIT', label: '네온 서킷', color: '#247e86', accent: '#8affeb', dark: '#162a35', suit: '#305762', visor: '#7cfff2', pattern: 'skin-circuit.png' },
  { id: 'ember', name: 'EMBER FORGE', label: '엠버 포지', color: '#a44c32', accent: '#ffb14e', dark: '#30272b', suit: '#705448', visor: '#ffb157', pattern: 'skin-forge.png' },
  { id: 'arctic', name: 'ARCTIC GHOST', label: '아크틱 고스트', color: '#d5e1df', accent: '#7bc5f4', dark: '#465c6b', suit: '#aabbbf', visor: '#82e2ff', pattern: 'skin-camo.png' },
  { id: 'toxic', name: 'BIOHAZARD', label: '바이오해저드', color: '#677f30', accent: '#d3ff69', dark: '#24352f', suit: '#536244', visor: '#d6ff7d', pattern: 'skin-camo.png' },
  { id: 'phantom', name: 'PHANTOM HEX', label: '팬텀 헥스', color: '#655293', accent: '#e2a2ff', dark: '#28283d', suit: '#524d6a', visor: '#e6b8ff', pattern: 'skin-circuit.png' },
].map(Object.freeze));

export const DEFAULT_WEAPON = 'rifle';
export const DEFAULT_SKIN = 'standard';
export const isWeaponId = (id) => WEAPONS.some((weapon) => weapon.id === id);
export const isSkinId = (id) => SKINS.some((skin) => skin.id === id);
export const getWeapon = (id) => id === KNIFE.id ? KNIFE : WEAPONS.find((weapon) => weapon.id === id) || WEAPONS[0];
export const getSkin = (id) => SKINS.find((skin) => skin.id === id) || SKINS[0];
export const weaponModel = (weapon) => weapon.model || weapon.id;
export const freshMagazines = () => Object.fromEntries(WEAPONS.map((weapon) => [weapon.id, weapon.magazine]));

// Releasing restores the ordinary delay, so rapid single-click spam cannot
// bypass the AN-94's slower cadence after its initial held pair.
export const shotInterval = (weapon, shotIndex = 1, held = true) => weapon.hyperburstCount && shotIndex < weapon.hyperburstCount && held ? weapon.hyperburstSeconds : weapon.fireSeconds;

export function damageAtDistance(weapon, distance, headshot = false) {
  const falloff = Math.min(1, Math.max(0, (distance - weapon.falloffStart) / Math.max(1, weapon.range - weapon.falloffStart)));
  return (headshot ? weapon.headDamage : weapon.damage) * (1 - falloff * (1 - weapon.minDamage));
}

// Shift shares the focused cone only while walking upright on the ground.
// ADS still works independently of stance and never locks bullets to center.
export function shotSpread(weapon, ads = false, state = {}) {
  const airborne = state.grounded === false;
  const moving = (state.moveSpeed || 0) > 0.2;
  const crouch = airborne ? 0 : Number.isFinite(state.crouchAmount) ? Math.max(0, Math.min(1, state.crouchAmount)) : state.crouching === true ? 1 : 0;
  const focused = ads || (!airborne && moving && state.walking === true && state.crouching !== true && crouch === 0);
  const base = focused ? weapon.adsSpread : weapon.spread;
  // Ordinary ground movement adds only a small spread on top of each hip-fire profile.
  const movingSpread = weapon.type === 'SMG' ? focused ? 0.0063 : 0.0042 : weapon.type === 'SIDEARM' ? focused ? 0.0075 : 0.0048 : focused ? 0.009 : 0.0055;
  const movement = weapon.type === 'SNIPER'
    ? airborne ? 0.18 : moving ? focused ? 0.035 : 0.025 : 0
    : airborne ? 0.105 : moving ? movingSpread : 0;
  const bloom = Math.min(1, Math.max(0, state.shotHeat || 0)) * (weapon.spreadBloom ?? 0.012);
  // Both authoritative shots and the crosshair use the real, blended stance.
  // Airborne accuracy can never be improved by sending a crouch key.
  return (base + movement + bloom) * (1 - crouch * 0.3) * 0.85;
}

export function shotAngles(weapon, ads = false, random = Math.random, state = {}) {
  const spread = shotSpread(weapon, ads, state);
  const phase = random() * Math.PI * 2;
  if (weapon.pellets === 1) {
    const radius = Math.sqrt(random()) * spread;
    return [{ yaw: Math.cos(phase) * radius, pitch: Math.sin(phase) * radius }];
  }
  // A fixed radial distribution keeps multi-pellet spread reproducible.
  return Array.from({ length: weapon.pellets }, (_, index) => {
    const radius = index === 0 ? 0 : Math.sqrt(index / (weapon.pellets - 1)) * spread;
    return { yaw: Math.cos(phase + index * 2.39996) * radius, pitch: Math.sin(phase + index * 2.39996) * radius };
  });
}
