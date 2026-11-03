import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RANK_TIERS, rankPresentation } from '../public/rank-view.js';

test('rank presentation uses canonical online tiers and divisions, not local LP or wins', () => {
  for (const tier of RANK_TIERS.slice(1)) {
    const view = rankPresentation({ rankTier: tier.id, rankDivision: 3, rankPoints: 42, points: 99999, wins: 999 });
    assert.equal(view.tier,tier.id); assert.equal(view.label, tier.id === 'CHALLENGER' ? tier.name : `${tier.name} III`); assert.equal(view.detail,'42 승급점수'); assert.ok(view.emblem.includes(`/${tier.icon}.svg`));
  }
});
test('unranked placement games/wins stay visible and logged-out profiles never invent a ranked tier', () => {
  const placement = rankPresentation({ rankTier: 'UNRANKED', placementsPlayed: 3, placementWins: 2, wins: 999 }); assert.equal(placement.label,'배치 중'); assert.equal(placement.detail,'배치 3/10판 · 2승'); assert.equal(placement.progress,30);
  const guest = rankPresentation(null); assert.equal(guest.tier,'UNRANKED'); assert.equal(guest.label,'로그인 필요'); assert.equal(guest.showProgress,false);
  assert.equal(rankPresentation({ rankTier: 'CHALLENGER' }).showProgress,false);
});
test('malformed or prototype-shaped tiers cannot become asset paths or fabricate a tier', () => {
  for (const rankTier of ['__proto__','constructor','../../private',{},null]) { const view = rankPresentation({ rankTier }); assert.equal(view.label,'티어 확인 중'); assert.equal(view.emblem,'/assets/ranks/unranked.svg?v=1'); assert.equal(view.showProgress,false); }
  const view = rankPresentation({ rankTier: 'UNRANKED', placementsPlayed: 99, placementWins: Infinity }); assert.equal(view.progress,100); assert.equal(view.detail,'배치 10/10판 · 0승');
});
test('every original tier insignia is a distinct self-contained vector without scripts or external resources', async () => {
  const documents = [];
  for (const tier of RANK_TIERS) { const svg = await readFile(new URL(`../public/assets/ranks/${tier.icon}.svg`,import.meta.url),'utf8'); assert.match(svg, /viewBox="0 0 128 128"/); assert.match(svg,/<title>.+<\/title>/); assert.doesNotMatch(svg,/<script|<image|<foreignObject|\bon\w+=|(?:href|src)=/i); documents.push(svg); }
  assert.equal(new Set(documents).size,7); assert.deepEqual(RANK_TIERS.slice(1).map((tier) => tier.id),['BRONZE','SILVER','GOLD','PLATINUM','DIAMOND','CHALLENGER']);
});
