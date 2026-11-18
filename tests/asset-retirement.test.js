import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { MAPS } from '../shared/world.js';

test('team maps ship only actual terrain previews while concept originals and their provenance stay in documentation', async () => {
  const runtime = JSON.parse(await readFile(new URL('../public/assets/asset-manifest.json', import.meta.url), 'utf8'));
  const concepts = JSON.parse(await readFile(new URL('../docs/maps/concepts/asset-manifest.json', import.meta.url), 'utf8'));
  assert.equal(concepts.modelLicense, runtime.modelLicense);
  for (const world of MAPS.filter(world => world.terrain)) {
    assert.equal(world.image, world.previewImage); assert.match(world.image, /^maps\/[a-z]+\.svg$/);
    await access(new URL('../public/assets/' + world.image, import.meta.url));
    const name = `${world.id}-hero.png`, original = await readFile(new URL('../docs/maps/concepts/' + name, import.meta.url));
    assert.equal(original.readUInt32BE(0), 0x89504e47); assert.ok(concepts.assets.some(asset => asset.file === name && asset.prompt && asset.seed));
    assert.ok(!runtime.assets.some(asset => asset.file === name));
    await assert.rejects(access(new URL('../public/assets/' + name, import.meta.url)), { code: 'ENOENT' });
  }
  assert.equal(concepts.assets.length, 4);
});
