const bounded = (value, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;

export const gunshotRange = (suppressed = false) => suppressed === true ? 22 : 45;

export function gunshotMix(type, suppressed = false, volume = 1, distance = 0) {
  const sniper = type === 'SNIPER', shotgun = type === 'SHOTGUN', quiet = suppressed === true, range = Math.max(0, Number.isFinite(distance) ? distance : 0);
  return {
    gain: bounded(volume, 0, 1) * (sniper ? 2 : shotgun ? 1.12 : 1) * (quiet ? .32 : 1),
    cutoff: quiet ? Math.max(900, 4300 * Math.exp(-range / 32)) : Math.max(1800, (shotgun ? 11000 : 14500) * Math.exp(-range / 32)),
    bassDB: (sniper || shotgun) && !quiet ? 2 : 0,
  };
}
