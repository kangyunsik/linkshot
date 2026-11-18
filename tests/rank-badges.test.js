import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { highestRank, normalizeRankBadge, rankBadgeLabel, rankEmblem, RANK_TIERS } from '../shared/ranks.js';
import { Room } from '../shared/simulation.js';
import { getWeapon } from '../shared/catalog.js';

test('player badges choose the stronger independent ladder by tier, division and RP, with stable ties', () => {
  const profile = { competitive: { ffa: { rankTier: 'PLATINUM', rankDivision: 4, rankPoints: 12 }, teams: { rankTier: 'GOLD', rankDivision: 1, rankPoints: 99 } } };
  assert.deepEqual(highestRank(profile), { tier: 'PLATINUM', division: 4, ladder: 'ffa' });
  profile.competitive.teams = { rankTier: 'PLATINUM', rankDivision: 2, rankPoints: 0 }; assert.equal(highestRank(profile).ladder, 'teams');
  profile.competitive.ffa.rankDivision = 2; profile.competitive.ffa.rankPoints = 80; assert.equal(highestRank(profile).ladder, 'ffa');
  profile.competitive.teams.rankPoints = 80; assert.equal(highestRank(profile).ladder, 'teams');
  profile.competitive.ffa.rankTier = 'CHALLENGER'; assert.equal(highestRank(profile).ladder, 'ffa');
  assert.equal(highestRank({}), null); assert.equal(highestRank(null), null);
});
test('rank badge paths never accept arbitrary tiers or ladder paths', () => {
  assert.equal(normalizeRankBadge({ tier: '../../private', ladder: 'ffa' }), null);
  assert.equal(normalizeRankBadge({ tier: 'GOLD', ladder: '../private' }), null);
  assert.equal(rankEmblem('GOLD', 'ffa'), '/assets/ranks/ffa/gold.svg?v=1');
  assert.equal(rankEmblem('__proto__', '../private'), '/assets/ranks/unranked.svg?v=1');
  assert.equal(rankBadgeLabel({ tier: 'GOLD', division: 2, ladder: 'ffa' }), '개인전 · 골드 II');
});
test('solo insignia are distinct from team shields and keep every tier local and safe', async () => {
  for (const tier of RANK_TIERS) {
    const solo = await readFile(new URL(`../public/assets/ranks/ffa/${tier.icon}.svg`, import.meta.url), 'utf8'), team = await readFile(new URL(`../public/assets/ranks/${tier.icon}.svg`, import.meta.url), 'utf8');
    assert.notEqual(solo, team); assert.match(solo, /viewBox="0 0 128 128"/); assert.match(solo, /<circle/);
    assert.doesNotMatch(solo, /<script|<image|<foreignObject|\bon\w+=|(?:href|src)=/i);
  }
});
test('LAN loadouts cannot fabricate a badge; server-issued marks persist into kill and death metadata', () => {
  const room = new Room('BADGES', { bots: 0 }), attacker = room.addPlayer('a', 'A', false, { rankBadge: { tier: 'CHALLENGER', division: 1, ladder: 'ffa' } }), victim = room.addPlayer('b', 'B');
  assert.equal(attacker.rankBadge, null);
  attacker.rankBadge = { tier: 'GOLD', division: 2, ladder: 'ffa' }; victim.rankBadge = { tier: 'SILVER', division: 3, ladder: 'teams' };
  room.applyDamage(attacker, victim, 100, false, {}, getWeapon('rifle'), room.clock());
  assert.deepEqual(victim.lastDeath.attackerRankBadge, attacker.rankBadge);
  assert.deepEqual(room.events.findLast(event => event.type === 'kill').victimRankBadge, victim.rankBadge);
  assert.deepEqual(room.snapshot().players.find(p => p.id === attacker.id).rankBadge, attacker.rankBadge);
});
