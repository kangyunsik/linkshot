// Presentation follows the authoritative reload deadline. It never updates
// ammunition or predicts individual ammo transfers during the motion.
const unit = value => Math.max(0, Math.min(1, value));
export function reloadProgress(deadline, now, weapon) {
  const duration = weapon?.reloadSeconds * 1000;
  const remaining = deadline - now;
  return duration > 0 && Number.isFinite(remaining) && remaining > 0 ? unit(1 - remaining / duration) : null;
}

export function easeBetween(t, start, end) {
  const f = unit((t - start) / (end - start));
  return f * f * (3 - 2 * f);
}
export const beat = (t, start, rise, fall, end) => easeBetween(t,start,rise) * (1 - easeBetween(t,fall,end));

export function visualInsert(t, start, end, count) {
  if (t < start || t >= end || count < 1) return null;
  const travel = (t - start) * count / (end - start), index = Math.min(count - 1, Math.floor(travel));
  return { index, fraction: unit(travel - index) };
}

export function reloadKind(weapon) {
  if (weapon.melee) return null;
  if (weapon.id === 's686') return 'break';
  if (weapon.type === 'SHOTGUN') return 'shell';
  if (weapon.type === 'LMG') return 'belt';
  if (weapon.id === 'p90') return 'top';
  return 'magazine';
}

const still = Object.freeze({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 });
export function reloadFraming(t, weapon, reduceMotion = false) {
  if (t == null) return still;
  const kind = reloadKind(weapon);
  const display = beat(t,0,.18,.84,1), seat = beat(t,.59,.62,.627,.72);
  const narrow = weapon.type === 'SIDEARM', long = weapon.type === 'SNIPER' || kind === 'belt';
  const movement = reduceMotion ? .64 : 1;
  const roll = kind === 'top' ? .27 : kind === 'shell' ? -.78 : kind === 'break' ? -.30 : kind === 'belt' ? .27 : narrow ? -.65 : -.50;
  return {
    x: -(long ? .21 : .144) * display,
    y: (long ? .146 : .072) * display - (reduceMotion ? 0 : .014 * seat),
    z: -(narrow ? .075 : .16) * display,
    pitch: (kind === 'break' ? .31 : kind === 'belt' ? .10 : kind === 'top' ? -.08 : .18) * display * movement,
    yaw: (kind === 'belt' || kind === 'top' ? -.22 : .29) * display,
    roll: roll * display * movement,
  };
}
