const WEAPON_MOVEMENT = {
  rifle: { walkMultiplier: 1, sprintMultiplier: 1, adsMoveMultiplier: 0.65 },
  smg: { walkMultiplier: 1.06, sprintMultiplier: 1.05, adsMoveMultiplier: 0.8 },
  shotgun: { walkMultiplier: 0.92, sprintMultiplier: 0.94, adsMoveMultiplier: 0.72 },
  sniper: { walkMultiplier: 0.86, sprintMultiplier: 0.88, adsMoveMultiplier: 0.45 },
  pistol: { walkMultiplier: 1.1, sprintMultiplier: 1.08, adsMoveMultiplier: 0.85 },
  lmg: { walkMultiplier: 0.78, sprintMultiplier: 0.82, adsMoveMultiplier: 0.5 },
  dmr: { walkMultiplier: 0.92, sprintMultiplier: 0.93, adsMoveMultiplier: 0.6 },
  ak47: { walkMultiplier: 0.94, sprintMultiplier: 0.96, adsMoveMultiplier: 0.6 },
  m4a1: { walkMultiplier: 1.02, sprintMultiplier: 1, adsMoveMultiplier: 0.7 },
  famas: { walkMultiplier: 1, sprintMultiplier: 1, adsMoveMultiplier: 0.68 },
  mp5: { walkMultiplier: 1.08, sprintMultiplier: 1.06, adsMoveMultiplier: 0.83 },
  p90: { walkMultiplier: 1.04, sprintMultiplier: 1.05, adsMoveMultiplier: 0.8 },
  ump45: { walkMultiplier: 1.03, sprintMultiplier: 1.02, adsMoveMultiplier: 0.76 },
  awp: { walkMultiplier: 0.76, sprintMultiplier: 0.82, adsMoveMultiplier: 0.35 },
  m82: { walkMultiplier: 0.66, sprintMultiplier: 0.73, adsMoveMultiplier: 0.3 },
  spas12: { walkMultiplier: 0.88, sprintMultiplier: 0.92, adsMoveMultiplier: 0.68 },
  deagle: { walkMultiplier: 1.0, sprintMultiplier: 1.02, adsMoveMultiplier: 0.78 },
  m249: { walkMultiplier: 0.7, sprintMultiplier: 0.76, adsMoveMultiplier: 0.42 },
  m14: { walkMultiplier: 0.9, sprintMultiplier: 0.92, adsMoveMultiplier: 0.57 },
  glock18c: { walkMultiplier: 1.1, sprintMultiplier: 1.08, adsMoveMultiplier: 0.85 },
};

const WEAPON_PRICES = { smg: 600, lmg: 1200, dmr: 1100, ak47: 1400, m4a1: 1600, famas: 1800, mp5: 900, p90: 1500, ump45: 1000, awp: 1900, m82: 2000, spas12: 1300, deagle: 1200, m249: 1700, m14: 1400, glock18c: 800 };

export const WEAPONS = Object.freeze([
  { id: 'rifle', slot: 1, name: 'VX–7', label: '돌격소총', type: 'ASSAULT', action: 'AUTO', magazine: 30, fireSeconds: 0.105, reloadSeconds: 1.75, damage: 28, headDamage: 48, pellets: 1, spread: 0.008, adsSpread: 0.0016, range: 110, falloffStart: 40, minDamage: 0.75, zoom: 0.73, recoil: 1.7, automatic: true, caliber: '5.56 MM', description: '강한 수직 반동의 기본 소총. 멈춰서 정조준하고 짧게 끊어 쏘면 정확합니다.' },
  { id: 'pistol', slot: 2, name: 'PX–9', label: '권총', type: 'SIDEARM', action: 'SEMI', magazine: 15, fireSeconds: 0.22, reloadSeconds: 1.15, damage: 32, headDamage: 56, pellets: 1, spread: 0.013, adsSpread: 0.003, range: 65, falloffStart: 20, minDamage: 0.55, zoom: 0.82, recoil: 0.8, automatic: false, caliber: '9 MM', description: '가벼운 반자동 권총. 빠른 재장전과 정확한 단발 사격으로 빈틈을 공략하세요.' },
  { id: 'shotgun', slot: 3, name: 'SG–12', label: '산탄총', type: 'SHOTGUN', action: 'PUMP', magazine: 8, fireSeconds: 0.78, reloadSeconds: 2.4, damage: 16, headDamage: 24, pellets: 8, spread: 0.075, adsSpread: 0.052, range: 40, falloffStart: 8, minDamage: 0.2, zoom: 0.82, recoil: 1.9, automatic: false, caliber: '12 GAUGE', description: '한 발에 8개의 산탄. 가까울수록 강력하며, 클릭할 때마다 한 발씩 발사.' },
  { id: 'sniper', slot: 4, name: 'SR–1', label: '저격소총', type: 'SNIPER', action: 'BOLT', magazine: 5, fireSeconds: 1.15, reloadSeconds: 2.65, damage: 100, headDamage: 150, pellets: 1, spread: 0.08, adsSpread: 0.0004, range: 200, falloffStart: 150, minDamage: 0.9, zoom: 0.30, recoil: 2.3, automatic: false, caliber: '7.62 MM', description: '고배율 스코프의 볼트액션 저격총. 멈춰서 확대하면 정확하지만 노줌·이동 사격은 탄이 크게 퍼집니다.' },
  { id: 'smg', slot: 5, name: 'PD–9', label: '기관단총', type: 'SMG', action: 'AUTO', magazine: 36, fireSeconds: 0.065, reloadSeconds: 1.45, damage: 18, headDamage: 30, pellets: 1, spread: 0.018, adsSpread: 0.006, range: 70, falloffStart: 18, minDamage: 0.5, zoom: 0.82, recoil: 0.58, automatic: true, caliber: '9 MM', description: '빠른 연사와 짧은 재장전. 좁은 골목과 적극적인 근접전에 특화.' },
  { id: 'lmg', slot: 6, name: 'LM–60', label: '경기관총', type: 'LMG', action: 'AUTO', magazine: 60, fireSeconds: 0.095, reloadSeconds: 3.35, damage: 24, headDamage: 40, pellets: 1, spread: 0.019, adsSpread: 0.007, range: 120, falloffStart: 45, minDamage: 0.7, zoom: 0.76, recoil: 1.2, automatic: true, caliber: '5.56 MM', description: '60발 탄창으로 이어가는 지속 화력. 넓은 탄 퍼짐과 긴 재장전 시간을 엄폐로 보완하세요.' },
  { id: 'dmr', slot: 7, name: 'MR–14', label: '지정사수소총', type: 'DMR', action: 'SEMI', magazine: 12, fireSeconds: 0.32, reloadSeconds: 2.05, damage: 52, headDamage: 90, pellets: 1, spread: 0.012, adsSpread: 0.0015, range: 160, falloffStart: 70, minDamage: 0.75, zoom: 0.48, recoil: 1.55, automatic: false, caliber: '7.62 MM', description: '중장거리 교전을 위한 반자동 소총. 빠른 후속 사격과 확대 조준으로 시야를 장악하세요.' },
  { id: 'ak47', model: 'rifle', slot: 8, name: 'AK-47', label: '강타격 돌격소총', type: 'ASSAULT', action: 'AUTO', magazine: 30, fireSeconds: 0.115, reloadSeconds: 2.25, damage: 36, headDamage: 72, pellets: 1, spread: 0.013, adsSpread: 0.003, range: 125, falloffStart: 45, minDamage: 0.7, zoom: 0.73, recoil: 2.2, automatic: true, caliber: '7.62×39 MM', description: '묵직한 한 발과 강한 반동. 곡선 탄창과 목제 가구의 고전적인 강타격 소총.' },
  { id: 'm4a1', model: 'rifle', slot: 9, name: 'M4A1', label: '경량 돌격소총', type: 'ASSAULT', action: 'AUTO', magazine: 30, fireSeconds: 0.09, reloadSeconds: 1.9, damage: 26, headDamage: 52, pellets: 1, spread: 0.007, adsSpread: 0.0013, range: 120, falloffStart: 40, minDamage: 0.75, zoom: 0.73, recoil: 1.25, automatic: true, caliber: '5.56×45 MM', description: '가볍고 빠른 연사, 비교적 다루기 쉬운 반동. 안정적인 중거리 교전에 적합합니다.' },
  { id: 'famas', model: 'rifle', slot: 10, name: 'FAMAS F1', label: '3점사 소총', type: 'ASSAULT', action: '3-BURST', magazine: 25, fireSeconds: 0.075, burstCount: 3, burstPause: 0.24, reloadSeconds: 2.3, damage: 25, headDamage: 50, pellets: 1, spread: 0.01, adsSpread: 0.0018, range: 115, falloffStart: 38, minDamage: 0.7, zoom: 0.74, recoil: 1.3, automatic: false, caliber: '5.56×45 MM', description: '클릭 한 번에 정확히 3발을 빠르게 점사합니다. 짧은 점사 후 다시 클릭해야 하며 반동 제어가 중요합니다.' },
  { id: 'mp5', model: 'smg', slot: 11, name: 'MP5', label: '정밀 기관단총', type: 'SMG', action: 'AUTO', magazine: 30, fireSeconds: 0.075, reloadSeconds: 1.6, damage: 20, headDamage: 36, pellets: 1, spread: 0.013, adsSpread: 0.004, range: 75, falloffStart: 20, minDamage: 0.5, zoom: 0.82, recoil: 0.5, automatic: true, caliber: '9×19 MM', description: '낮은 반동과 가벼운 조작감. 원형 조준기와 슬림한 몸체를 가진 근거리 정밀 SMG.' },
  { id: 'p90', model: 'smg', slot: 12, name: 'FN P90', label: '50발 고속 PDW', type: 'SMG', action: 'AUTO', magazine: 50, fireSeconds: 0.055, reloadSeconds: 2.4, damage: 16, headDamage: 29, pellets: 1, spread: 0.02, adsSpread: 0.007, range: 80, falloffStart: 22, minDamage: 0.55, zoom: 0.82, recoil: 0.62, automatic: true, caliber: '5.7×28 MM', description: '상부 수평 탄창에 50발. 낮은 단발 피해 대신 매우 빠른 연사와 긴 근거리 압박을 제공합니다.' },
  { id: 'ump45', model: 'smg', slot: 13, name: 'UMP45', label: '중타격 기관단총', type: 'SMG', action: 'AUTO', magazine: 25, fireSeconds: 0.115, reloadSeconds: 2.1, damage: 28, headDamage: 50, pellets: 1, spread: 0.015, adsSpread: 0.005, range: 75, falloffStart: 19, minDamage: 0.5, zoom: 0.82, recoil: 1, automatic: true, caliber: '.45 ACP', description: '느린 연사와 무거운 한 발. 각진 리시버와 접이식 개머리판의 중타격 SMG.' },
  { id: 'awp', model: 'sniper', slot: 14, name: 'AWP', label: '고배율 볼트 저격총', type: 'SNIPER', action: 'BOLT', magazine: 10, fireSeconds: 1.5, reloadSeconds: 3, damage: 100, headDamage: 160, pellets: 1, spread: 0.095, adsSpread: 0.00025, range: 230, falloffStart: 165, minDamage: 0.9, zoom: 0.27, recoil: 2.8, automatic: false, caliber: '7.62×51 MM', description: '멈춘 상태의 고배율 정조준은 매우 정확합니다. 노줌·이동 중에는 큰 탄 퍼짐이 생기므로 정지 사격이 중요합니다.' },
  { id: 'm82', model: 'sniper', slot: 15, name: 'Barrett M82', label: '대구경 반자동 저격총', type: 'SNIPER', action: 'SEMI', magazine: 10, fireSeconds: 0.48, reloadSeconds: 3.4, damage: 96, headDamage: 160, pellets: 1, spread: 0.11, adsSpread: 0.001, range: 240, falloffStart: 180, minDamage: 0.9, zoom: 0.42, recoil: 3.2, automatic: false, caliber: '.50 BMG', description: '묵직한 대구경 반자동 저격총. 노줌·이동·공중 사격의 탄 퍼짐이 매우 크며, 정확한 후속 사격에는 정지·확대가 필요합니다.' },
  { id: 'spas12', model: 'shotgun', slot: 16, name: 'SPAS-12', label: '고위력 산탄총', type: 'SHOTGUN', action: 'PUMP', magazine: 8, fireSeconds: 0.65, reloadSeconds: 3, damage: 18, headDamage: 26, pellets: 9, spread: 0.085, adsSpread: 0.06, range: 42, falloffStart: 7, minDamage: 0.15, zoom: 0.82, recoil: 2.3, automatic: false, caliber: '12 GAUGE', description: '한 발에 9개 산탄과 강한 근거리 화력. 접힌 상부 개머리판이 특징이며 거리가 벌어지면 급격히 약해집니다.' },
  { id: 'deagle', model: 'pistol', slot: 17, name: 'Desert Eagle', label: '대구경 권총', type: 'SIDEARM', action: 'SEMI', magazine: 7, fireSeconds: 0.36, reloadSeconds: 1.9, damage: 58, headDamage: 110, pellets: 1, spread: 0.028, adsSpread: 0.006, range: 95, falloffStart: 30, minDamage: 0.65, zoom: 0.77, recoil: 2.2, automatic: false, caliber: '.50 AE', description: '7발 탄창의 무거운 대구경 권총. 정확한 한 발은 강력하지만 연타 반동과 빗나간 탄의 대가도 큽니다.' },
  { id: 'm249', model: 'lmg', slot: 18, name: 'M249 SAW', label: '100발 분대지원화기', type: 'LMG', action: 'AUTO', magazine: 100, fireSeconds: 0.075, reloadSeconds: 4.2, damage: 22, headDamage: 38, pellets: 1, spread: 0.026, adsSpread: 0.009, range: 135, falloffStart: 45, minDamage: 0.7, zoom: 0.76, recoil: 1.55, automatic: true, caliber: '5.56×45 MM', description: '100발 탄대와 지속 제압. 재장전이 매우 길고 이동이 무거우므로 엄폐와 사격 타이밍을 계획해야 합니다.' },
  { id: 'm14', model: 'dmr', slot: 19, name: 'M14', label: '20발 전투소총', type: 'DMR', action: 'SEMI', magazine: 20, fireSeconds: 0.24, reloadSeconds: 2.45, damage: 48, headDamage: 90, pellets: 1, spread: 0.015, adsSpread: 0.0025, range: 175, falloffStart: 70, minDamage: 0.75, zoom: 0.5, recoil: 1.8, automatic: false, caliber: '7.62×51 MM', description: '목제 개머리판과 20발 탄창. 중장거리에서 꾸준히 후속 단발을 이어가는 전투소총입니다.' },
  { id: 'glock18c', model: 'pistol', slot: 20, name: 'Glock 18C', label: '자동권총', type: 'SIDEARM', action: 'AUTO', magazine: 33, fireSeconds: 0.06, reloadSeconds: 1.65, damage: 17, headDamage: 30, pellets: 1, spread: 0.026, adsSpread: 0.009, range: 60, falloffStart: 14, minDamage: 0.45, zoom: 0.83, recoil: 0.85, automatic: true, caliber: '9×19 MM', description: '33발 확장 탄창의 고속 자동권총. 가볍고 근거리 연사가 빠르지만 탄 퍼짐과 탄 소모를 주의하세요.' },
].map((weapon) => Object.freeze({ ...weapon, price: WEAPON_PRICES[weapon.id] || 0, ...WEAPON_MOVEMENT[weapon.id] })));

export const FREE_WEAPON_IDS = Object.freeze(WEAPONS.filter((weapon) => !weapon.price).map((weapon) => weapon.id));
// Fallback equipment is deliberately outside the firearm shop/audio catalogue.
export const KNIFE = Object.freeze({ id: 'knife', model: 'knife', name: 'FIELD KNIFE', label: '근접 나이프', type: 'MELEE', action: 'SLASH', melee: true, magazine: 0, fireSeconds: .55, reloadSeconds: 0, damage: 45, headDamage: 45, pellets: 1, spread: 0, adsSpread: 0, range: 1.85, falloffStart: 1.85, minDamage: 1, zoom: 1, recoil: 0, automatic: false, caliber: '근접', walkMultiplier: 1.1, sprintMultiplier: 1.08, adsMoveMultiplier: 1 });
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

export function damageAtDistance(weapon, distance, headshot = false) {
  const falloff = Math.min(1, Math.max(0, (distance - weapon.falloffStart) / Math.max(1, weapon.range - weapon.falloffStart)));
  return (headshot ? weapon.headDamage : weapon.damage) * (1 - falloff * (1 - weapon.minDamage));
}

// A fixed radial distribution makes shotgun spread reproducible and server-testable.
export function shotSpread(weapon, ads = false, state = {}) {
  const base = ads ? weapon.adsSpread : weapon.spread;
  const moving = (state.moveSpeed || 0) > 0.2;
  const movement = weapon.type === 'SNIPER'
    ? state.grounded === false ? 0.18 : state.sprinting ? 0.12 : moving ? ads ? 0.045 : 0.065 : 0
    : state.grounded === false ? 0.105 : state.sprinting ? 0.075 : moving ? ads ? 0.014 : 0.024 : 0;
  const bloom = Math.min(1, Math.max(0, state.shotHeat || 0)) * (weapon.type === 'ASSAULT' ? 0.023 : 0.012);
  return base + movement + bloom;
}

export function shotAngles(weapon, ads = false, random = Math.random, state = {}) {
  const spread = shotSpread(weapon, ads, state);
  const phase = random() * Math.PI * 2;
  if (weapon.pellets === 1) {
    const radius = Math.sqrt(random()) * spread;
    return [{ yaw: Math.cos(phase) * radius, pitch: Math.sin(phase) * radius }];
  }
  return Array.from({ length: weapon.pellets }, (_, index) => {
    const radius = index === 0 ? 0 : Math.sqrt(index / (weapon.pellets - 1)) * spread;
    return { yaw: Math.cos(phase + index * 2.39996) * radius, pitch: Math.sin(phase + index * 2.39996) * radius };
  });
}
