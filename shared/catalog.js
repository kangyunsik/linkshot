export const WEAPONS = Object.freeze([
  { id: 'rifle', slot: 1, name: 'VX–7', label: '돌격소총', type: 'ASSAULT', action: 'AUTO', magazine: 30, fireSeconds: 0.105, reloadSeconds: 1.75, damage: 28, headDamage: 48, pellets: 1, spread: 0.004, adsSpread: 0.001, range: 110, falloffStart: 40, minDamage: 0.75, zoom: 0.73, recoil: 1, automatic: true, caliber: '5.56 MM', description: '정확도와 화력의 균형. 어느 전장에서나 믿을 수 있는 기본 소총.' },
  { id: 'smg', slot: 2, name: 'PD–9', label: '기관단총', type: 'SMG', action: 'AUTO', magazine: 36, fireSeconds: 0.065, reloadSeconds: 1.45, damage: 18, headDamage: 30, pellets: 1, spread: 0.018, adsSpread: 0.006, range: 70, falloffStart: 18, minDamage: 0.5, zoom: 0.82, recoil: 0.58, automatic: true, caliber: '9 MM', description: '빠른 연사와 짧은 재장전. 좁은 골목과 적극적인 근접전에 특화.' },
  { id: 'shotgun', slot: 3, name: 'SG–12', label: '산탄총', type: 'SHOTGUN', action: 'PUMP', magazine: 8, fireSeconds: 0.78, reloadSeconds: 2.4, damage: 16, headDamage: 24, pellets: 8, spread: 0.075, adsSpread: 0.052, range: 40, falloffStart: 8, minDamage: 0.2, zoom: 0.82, recoil: 1.9, automatic: false, caliber: '12 GAUGE', description: '한 발에 8개의 산탄. 가까울수록 강력하며, 클릭할 때마다 한 발씩 발사.' },
  { id: 'sniper', slot: 4, name: 'SR–1', label: '저격소총', type: 'SNIPER', action: 'BOLT', magazine: 5, fireSeconds: 1.15, reloadSeconds: 2.65, damage: 100, headDamage: 150, pellets: 1, spread: 0.025, adsSpread: 0.0004, range: 200, falloffStart: 150, minDamage: 0.9, zoom: 0.30, recoil: 2.3, automatic: false, caliber: '7.62 MM', description: '고배율 스코프와 강력한 헤드샷. 긴 시야를 장악하는 볼트액션 저격총.' },
].map(Object.freeze));

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
export const getWeapon = (id) => WEAPONS.find((weapon) => weapon.id === id) || WEAPONS[0];
export const getSkin = (id) => SKINS.find((skin) => skin.id === id) || SKINS[0];
export const freshMagazines = () => Object.fromEntries(WEAPONS.map((weapon) => [weapon.id, weapon.magazine]));

export function damageAtDistance(weapon, distance, headshot = false) {
  const falloff = Math.min(1, Math.max(0, (distance - weapon.falloffStart) / Math.max(1, weapon.range - weapon.falloffStart)));
  return (headshot ? weapon.headDamage : weapon.damage) * (1 - falloff * (1 - weapon.minDamage));
}

// A fixed radial distribution makes shotgun spread reproducible and server-testable.
export function shotAngles(weapon, ads = false, random = Math.random) {
  const spread = ads ? weapon.adsSpread : weapon.spread;
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
