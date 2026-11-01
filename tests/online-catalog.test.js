import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WEAPONS, FREE_WEAPON_IDS } from '../shared/catalog.js';
import { MAPS } from '../shared/world.js';
import { POINT_RULES } from '../shared/progression.js';

test('Spring server catalogue and rewards exactly match the shared game rules without adding knife ownership', async () => {
  const catalog = JSON.parse(await readFile(new URL('../online-server/src/main/resources/game-catalog.json', import.meta.url), 'utf8'));
  assert.deepEqual(catalog, { weapons: WEAPONS.map(({ id, price }) => ({ id, price })), maps: MAPS.map(({ id }) => id), freeWeapons: FREE_WEAPON_IDS, rewards: POINT_RULES });
});
