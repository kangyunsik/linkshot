import { Room } from './simulation.js';
import { WEAPONS, getWeapon, isWeaponId } from './catalog.js';
import { EMPTY_INPUT } from './movement.js';
import { RANGE_DISTANCES, RANGE_TARGET, RANGE_WORLD, RANGE_PLOT, rangeLine } from './range-world.js';

const freshGroup = () => ({ shots: 0, hits: 0, outside: 0, points: [] });

// A hit uses its real contact point; a miss is shown only if the actual
// traveled ray reached the target's cross-section. Never extend a blocked ray.
function plottedPoint(origin, ray) {
  const hit = ray.hit === RANGE_TARGET.id;
  const dz = ray.end.z - origin.z;
  const t = hit ? 1 : Math.abs(dz) < 1e-8 ? -1 : (RANGE_TARGET.z - origin.z) / dz;
  if (t < 0 || t > 1) return null;
  const x = origin.x + (ray.end.x - origin.x) * t - RANGE_TARGET.x;
  const y = origin.y + (ray.end.y - origin.y) * t - RANGE_TARGET.y;
  if (Math.abs(x) > RANGE_PLOT.halfWidth || y < 0 || y > RANGE_PLOT.height) return null;
  return { x: +x.toFixed(3), y: +y.toFixed(3), hit };
}

export class ShootingRange extends Room {
  constructor(id, name, { weaponId, distance, skinId, outfitId, characterId } = {}, { clock, random } = {}) {
    super('RANGE', { mode: 'range', bots: 0, roundSeconds: 3600, clock, random });
    this.world = RANGE_WORLD;
    this.distance = RANGE_DISTANCES.includes(distance) ? distance : 30;
    this.endsAt = Infinity;
    this.revision = 0;
    this.group = freshGroup();
    this.addPlayer(id, name, false, { weaponId, skinId, outfitId, characterId, ownedWeapons: WEAPONS.map(weapon => weapon.id) });
    this.addPlayer(RANGE_TARGET.id, '고정 표적', true, { weaponId: 'rifle' });
  }

  spawn(player) {
    super.spawn(player);
    const pose = player.isBot ? RANGE_TARGET : rangeLine(this.distance);
    // The dummy must keep the same pose and hit volumes between trials.
    if (player.isBot) Object.assign(player, { weaponId: 'rifle', nextWeaponId: 'rifle', ammo: getWeapon('rifle').magazine });
    Object.assign(player, { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, protectedUntil: 0 });
    player.input = { ...EMPTY_INPUT, yaw: pose.yaw, weaponId: player.weaponId };
    player.history.length = 0;
    this.recordPlayerHistory(player, this.clock());
  }

  configure({ roundId, weaponId, distance }) {
    if (roundId !== this.roundId || !isWeaponId(weaponId) || !RANGE_DISTANCES.includes(distance)) return false;
    this.distance = distance;
    this.players.get(this.hostId).nextWeaponId = weaponId;
    this.restart(this.hostId);
    return true;
  }

  restart(id) {
    super.restart(id);
    this.endsAt = Infinity;
    this.group = freshGroup();
    this.revision++;
  }

  botInput(player) { return player.input; }
  applyDamage() {} // Hit markers stay real; the dummy never dies or grants progress.
  finish() {}

  shoot(player, now, ads, shot) {
    if (!player || player.isBot) return false;
    const fullMagazine = player.ammo === getWeapon(player.weaponId).magazine, before = this.events.length;
    if (!super.shoot(player, now, ads, shot)) return false;
    const event = this.events[before];
    if (fullMagazine) this.group = freshGroup();
    this.group.shots++;
    this.group.hits += Number(event.rays.some(ray => ray.hit === RANGE_TARGET.id));
    for (const ray of event.rays) {
      const point = plottedPoint(event.origin, ray);
      if (point) this.group.points.push(point);
      else this.group.outside++;
    }
    this.revision++;
    return true;
  }

  snapshot() {
    const state = super.snapshot();
    state.room.timeLeft = null;
    return { ...state, range: { ...this.group, points: [...this.group.points], distance: this.distance, revision: this.revision } };
  }
}
