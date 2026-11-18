import test from 'node:test';
import assert from 'node:assert/strict';
import { competitiveStats, ladderProfile } from '../public/competitive-stats.js';
import { rankPresentation } from '../public/rank-view.js';
import { Room } from '../shared/simulation.js';
import { getWeapon } from '../shared/catalog.js';

test('personal and team statistics and tiers never mix with each other or device/global stats', () => {
  const profile = { kills: 99999, wins: 8888, rankTier: 'DIAMOND', competitive: {
    ffa: { rankTier: 'SILVER', rankDivision: 4, rankPoints: 17, roundsPlayed: 20, wins: 5, draws: 2, kills: 80, deaths: 40, assists: 20, recentMatches: Array.from({ length: 12 }, (_, i) => ({ matchId: `ffa-${i}` })) },
    teams: { rankTier: 'GOLD', rankDivision: 2, rankPoints: 42, roundsPlayed: 10, wins: 7, draws: 1, kills: 20, deaths: 10, assists: 10, recentMatches: [{ matchId: 'team-0' }] },
  } };
  assert.equal(rankPresentation(ladderProfile(profile, 'ffa')).label, '실버 IV');
  assert.equal(rankPresentation(ladderProfile(profile, 'teams')).label, '골드 II');
  const personal = competitiveStats(profile, 'ffa'), team = competitiveStats(profile, 'teams');
  assert.equal(personal.winRate, 25); assert.equal(personal.losses, 13); assert.equal(personal.kda, 2.5); assert.equal(personal.kd, 2); assert.equal(personal.recent.length, 10);
  assert.equal(team.winRate, 70); assert.equal(team.kda, 3); assert.equal(team.recent[0].matchId, 'team-0');
  assert.equal(competitiveStats({ kills: 500 }, 'ffa').available, false); assert.equal(competitiveStats(null).available, false);
});
test('zero games/deaths and malformed counts never create NaN, infinity, a made-up tier or a fake win rate', () => {
  const stats = competitiveStats({ competitive: { ffa: { roundsPlayed: 0, wins: 99, kills: 4, deaths: 0, assists: 2, recentMatches: null } } }, 'ffa');
  assert.equal(stats.winRate, 0); assert.equal(stats.wins, 0); assert.equal(stats.kda, 6); assert.equal(stats.recent.length, 0);
  assert.equal(rankPresentation(ladderProfile({ rankTier: 'GOLD' }, 'ffa')).label, '티어 확인 중');
});
test('assists require at least 20 actual damage in the same life within ten seconds and exclude the killer', () => {
  let now = 1000; const room = new Room('ASSIST', { bots: 0, clock: () => now, fragLimit: 100 });
  const killer = room.addPlayer('killer', 'KILLER'), helper = room.addPlayer('helper', 'HELPER'), victim = room.addPlayer('victim', 'VICTIM');
  const hit = (from, damage) => room.applyDamage(from, victim, damage, false, {}, getWeapon('rifle'), now);
  hit(helper, 25); hit(killer, 100); assert.equal(helper.assists, 1); assert.equal(killer.assists, 0);
  hit(killer, 100); assert.equal(helper.assists, 1);
  room.spawn(victim); hit(helper, 19); hit(killer, 100); assert.equal(helper.assists, 1);
  room.spawn(victim); hit(helper, 25); now += 10001; hit(killer, 100); assert.equal(helper.assists, 1);
  room.spawn(victim); hit(helper, 25); now += 9500; hit(helper, 1); now += 9500; hit(killer, 100); assert.equal(helper.assists, 1);
  room.spawn(victim); hit(helper, 25); room.spawn(victim); hit(killer, 100); assert.equal(helper.assists, 1);
  room.restart(killer.id); assert.equal(helper.assists, 0);
});
test('team assists only credit the killer teammate, survive posthumous help and are present in snapshots', () => {
  const room = new Room('TEAMAS', { bots: 0, gameType: 'teams', fragLimit: 100 });
  const killer = room.addPlayer('killer', 'KILLER'), victim = room.addPlayer('victim', 'VICTIM'), helper = room.addPlayer('helper', 'HELPER');
  room.applyDamage(helper, victim, 40, false, {}, getWeapon('rifle'), room.clock()); helper.hp = 0;
  room.applyDamage(killer, victim, 100, false, {}, getWeapon('rifle'), room.clock());
  assert.equal(helper.assists, 1); assert.equal(room.snapshot().players.find((p) => p.id === helper.id).assists, 1);
});
