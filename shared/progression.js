import { DEFAULT_OUTFIT, getOutfit, isOutfitId } from './outfits.js';

export const POINT_RULES = Object.freeze({ completion: 50, perKill: 20, victory: 100 });
export const PROFILE_VERSION = 1;
const MAX_VALUE = 1_000_000_000;
const count = (value) => Number.isSafeInteger(value) ? Math.max(0, Math.min(MAX_VALUE, value)) : 0;
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);
const callsign = (value) => typeof value === 'string' ? value.replace(/[\p{C}<>]/gu, '').trim().slice(0, 16) || 'OPERATOR' : 'OPERATOR';

export function createProfile(id, now = Date.now(), name = 'OPERATOR') {
  if (!validId(id)) throw new Error('프로필 ID가 올바르지 않습니다.');
  return { version: PROFILE_VERSION, id, callsign: callsign(name), kills: 0, deaths: 0, points: 0, totalEarned: 0, roundsPlayed: 0, wins: 0, ownedOutfits: [DEFAULT_OUTFIT], equippedOutfitId: DEFAULT_OUTFIT, roundLedger: {}, createdAt: now, updatedAt: now };
}

export function normalizeProfile(raw, fallbackId, now = Date.now()) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const result = createProfile(validId(value.id) ? value.id : fallbackId, now, value.callsign);
  for (const key of ['kills', 'deaths', 'points', 'totalEarned', 'roundsPlayed', 'wins']) result[key] = count(value[key]);
  result.ownedOutfits = [...new Set([DEFAULT_OUTFIT, ...(Array.isArray(value.ownedOutfits) ? value.ownedOutfits.filter(isOutfitId) : [])])];
  result.equippedOutfitId = result.ownedOutfits.includes(value.equippedOutfitId) ? value.equippedOutfitId : DEFAULT_OUTFIT;
  result.createdAt = Number.isFinite(value.createdAt) && value.createdAt > 0 ? value.createdAt : now;
  result.updatedAt = Number.isFinite(value.updatedAt) && value.updatedAt > 0 ? value.updatedAt : now;
  if (value.roundLedger && typeof value.roundLedger === 'object') {
    for (const [id, entry] of Object.entries(value.roundLedger).slice(-256)) {
      if (validId(id) && entry && typeof entry === 'object') result.roundLedger[id] = { kills: count(entry.kills), deaths: count(entry.deaths), awarded: entry.awarded === true, updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0 };
    }
  }
  return result;
}

export function profileStats(profile) {
  const kills = count(profile.kills), deaths = count(profile.deaths);
  return { kills, deaths, ratio: kills / Math.max(1, deaths), killRate: kills + deaths ? kills / (kills + deaths) * 100 : 0 };
}

export function roundReward(kills, won = false) {
  const killBonus = Math.min(count(kills), 10_000) * POINT_RULES.perKill;
  const winBonus = won === true ? POINT_RULES.victory : 0;
  return { completion: POINT_RULES.completion, killBonus, winBonus, points: POINT_RULES.completion + killBonus + winBonus, won: won === true };
}

export function recordRound(profile, { roundId, kills, deaths, completed = false, won = false }, now = Date.now()) {
  if (!validId(roundId)) return { profile, changed: false, award: null };
  const prior = Object.hasOwn(profile.roundLedger, roundId) ? profile.roundLedger[roundId] : { kills: 0, deaths: 0, awarded: false };
  const nextKills = Math.max(prior.kills, count(kills)), nextDeaths = Math.max(prior.deaths, count(deaths));
  const shouldAward = completed === true && !prior.awarded;
  if (nextKills === prior.kills && nextDeaths === prior.deaths && !shouldAward) return { profile, changed: false, award: null };
  const next = normalizeProfile(profile, profile.id, now);
  next.kills = count(next.kills + nextKills - prior.kills); next.deaths = count(next.deaths + nextDeaths - prior.deaths);
  next.roundLedger[roundId] = { kills: nextKills, deaths: nextDeaths, awarded: prior.awarded || shouldAward, updatedAt: now };
  let award = null;
  if (shouldAward) {
    award = roundReward(nextKills, won);
    next.points = count(next.points + award.points); next.totalEarned = count(next.totalEarned + award.points);
    next.roundsPlayed = count(next.roundsPlayed + 1); next.wins = count(next.wins + Number(award.won));
  }
  next.roundLedger = Object.fromEntries(Object.entries(next.roundLedger).slice(-256)); next.updatedAt = now;
  return { profile: next, changed: true, award };
}

export function purchaseOutfit(profile, outfitId, now = Date.now()) {
  if (!isOutfitId(outfitId)) throw new Error('존재하지 않는 외형입니다.');
  const outfit = getOutfit(outfitId);
  if (profile.ownedOutfits.includes(outfitId)) return { profile: equipOutfit(profile, outfitId, now), cost: 0, alreadyOwned: true };
  if (profile.points < outfit.price) throw new Error(`포인트가 부족합니다. ${outfit.price - profile.points} LP가 더 필요합니다.`);
  const next = normalizeProfile(profile, profile.id, now);
  next.points -= outfit.price; next.ownedOutfits.push(outfitId); next.equippedOutfitId = outfitId; next.updatedAt = now;
  return { profile: next, cost: outfit.price, alreadyOwned: false };
}

export function equipOutfit(profile, outfitId, now = Date.now()) {
  if (!isOutfitId(outfitId) || !profile.ownedOutfits.includes(outfitId)) throw new Error('보유한 외형만 장착할 수 있습니다.');
  if (profile.equippedOutfitId === outfitId) return profile;
  const next = normalizeProfile(profile, profile.id, now); next.equippedOutfitId = outfitId; next.updatedAt = now; return next;
}

export function applyProfileOperation(profile, operation, now = Date.now()) {
  if (operation.type === 'round') return recordRound(profile, operation, now);
  if (operation.type === 'purchase') { const result = purchaseOutfit(profile, operation.outfitId, now); return { ...result, changed: result.profile !== profile, award: null }; }
  if (operation.type === 'equip') { const next = equipOutfit(profile, operation.outfitId, now); return { profile: next, changed: next !== profile, award: null }; }
  if (operation.type === 'name') {
    const name = callsign(operation.callsign); if (name === profile.callsign) return { profile, changed: false, award: null };
    const next = normalizeProfile(profile, profile.id, now); next.callsign = name; next.updatedAt = now; return { profile: next, changed: true, award: null };
  }
  throw new Error('지원하지 않는 프로필 작업입니다.');
}
