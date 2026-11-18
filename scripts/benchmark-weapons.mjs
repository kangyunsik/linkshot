import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as current from '../shared/catalog.js';
import { RULES, WORLD, aimDirection } from '../shared/world.js';
import { traceShot } from '../shared/simulation.js';

// Ideal stationary 100-HP damage thresholds, not a prediction of player win
// rates. Chest hits use the real 1.2x multiplier and per-shot damage rounding.
export function idealTimeToKill(weapon, distance = 5, headshot = false, catalog = current) {
  if (distance > weapon.range) return null;
  const damage = Math.round(catalog.damageAtDistance(weapon, distance, headshot) * weapon.pellets * (headshot ? 1 : RULES.torsoDamageMultiplier));
  if (damage <= 0) return null;
  const shots = Math.ceil(100 / damage); let seconds = 0;
  for (let shot = 1; shot < shots; shot++) {
    seconds += shot % weapon.magazine === 0 ? weapon.reloadSeconds : weapon.burstCount && shot % weapon.burstCount === 0 ? weapon.burstPause : catalog.shotInterval(weapon, shot, true);
  }
  return { shots, damage, milliseconds: Math.round(seconds * 1000) };
}

export function shotgunDistribution(weapon, distance, catalog = current, samples = 256) {
  const world = { ...WORLD, width: 300, depth: 300, buildings: [], walkways: [], obstacles: [] };
  const shooter = { id: 'shooter', weaponId: weapon.id, x: 0, y: 0, z: 0, yaw: 0, pitch: Math.atan2(1.05 - RULES.eyeHeight, distance), hp: 100, grounded: true, crouchAmount: 0 };
  const target = { id: 'target', weaponId: 'rifle', x: 0, y: 0, z: -distance, yaw: 0, pitch: 0, hp: 100, protectedUntil: 0, crouchAmount: 0 };
  let seed = 71023, kills = 0, total = 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let sample = 0; sample < samples; sample++) {
    let damage = 0;
    for (const angle of catalog.shotAngles(weapon, true, random, { grounded: true, moveSpeed: 0, shotHeat: 0 })) {
      const hit = traceShot(shooter, [target], 1000, world, aimDirection(angle.yaw, shooter.pitch + angle.pitch), weapon.range);
      if (hit.victim) damage += catalog.damageAtDistance(weapon, hit.distance, hit.headshot) * hit.damageMultiplier;
    }
    damage = Math.round(damage); total += damage; kills += Number(damage >= 100);
  }
  return { distance, meanDamage: Math.round(total / samples * 10) / 10, oneShotPercent: Math.round(kills / samples * 1000) / 10 };
}

async function main() {
  let before = null;
  if (process.argv[2]) {
    const source = execFileSync('git', ['show', `${process.argv[2]}:shared/catalog.js`], { encoding: 'utf8' });
    before = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  }
  const report = {
    assumptions: '100 HP, stationary, first shot at t=0, exact chest/head hits; includes burst pauses and reloads. Shotguns additionally use actual hitboxes, pellet spread and seeded rays. Not a live-player balance guarantee.',
    firearms: current.WEAPONS.map(weapon => ({
      id: weapon.id,
      before: before ? Object.fromEntries([5,20,50].map(distance => [distance, { chest: idealTimeToKill(before.getWeapon(weapon.id), distance, false, before), head: idealTimeToKill(before.getWeapon(weapon.id), distance, true, before) }])) : null,
      after: Object.fromEntries([5,20,50].map(distance => [distance, { chest: idealTimeToKill(weapon, distance), head: idealTimeToKill(weapon, distance, true) }])),
    })),
    shotguns: current.WEAPONS.filter(weapon => weapon.type === 'SHOTGUN').map(weapon => ({
      id: weapon.id,
      before: before ? [3,5,10,15,20].map(distance => shotgunDistribution(before.getWeapon(weapon.id), distance, before)) : null,
      after: [3,5,10,15,20].map(distance => shotgunDistribution(weapon, distance)),
    })),
  };
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/weapon-balance-report.json', JSON.stringify(report, null, 2) + '\n');
  console.table(report.firearms.map(row => ({ weapon: row.id, beforeChest5ms: row.before?.[5].chest?.milliseconds, chest5ms: row.after[5].chest?.milliseconds, head5ms: row.after[5].head?.milliseconds, chest50ms: row.after[50].chest?.milliseconds ?? 'out of range' })));
  console.log(JSON.stringify(report.shotguns, null, 2));
  console.log('Saved reproducible metrics to artifacts/weapon-balance-report.json');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
