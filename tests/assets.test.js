import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { WEAPONS } from '../shared/catalog.js';
import { CHARACTERS } from '../shared/outfits.js';

test('recorded firearm samples have verified CC0 provenance, valid PCM and safe peaks', async () => {
  const directory = new URL('../public/assets/sounds/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  assert.equal(manifest.license, 'CC0-1.0'); assert.equal(manifest.creator, 'Tabasco'); assert.equal(manifest.files.length, WEAPONS.length);
  assert.equal(new Set(manifest.files.map((file) => file.sha256)).size, WEAPONS.length);
  for (const item of manifest.files) {
    const data = await readFile(new URL(item.file, directory));
    assert.equal(data.toString('ascii', 0, 4), 'RIFF'); assert.equal(data.toString('ascii', 8, 12), 'WAVE'); assert.equal(data.readUInt16LE(20), 1);
    assert.equal(data.readUInt16LE(22), 1); assert.equal(data.readUInt32LE(24), 44100); assert.equal(data.readUInt16LE(34), 16);
    let peak = 0, energy = 0;
    for (let offset = 44; offset < data.length; offset += 2) { const value = data.readInt16LE(offset) / 32768; peak = Math.max(peak, Math.abs(value)); energy += value * value; }
    assert.ok(peak > 0.8 && peak < 0.93); assert.ok(energy > 1); assert.equal(createHash('sha256').update(data).digest('hex'), item.sha256);
    assert.equal(item.singleShot, true); assert.ok(item.sourceAttack > 0);
    const rms = [];
    for (let start = 44; start < data.length; start += 882) {
      let sum = 0, count = 0; for (let i = start; i < Math.min(data.length, start + 882); i += 2) { sum += (data.readInt16LE(i) / 32768) ** 2; count++; } rms.push(Math.sqrt(sum / count));
    }
    assert.ok(Math.max(...rms.slice(15)) < Math.max(...rms.slice(0, 8)) * 0.12, `${item.file}: a later blast/mechanical attack is audible`);
  }
});

test('compact human models are valid self-contained glTF with documented free licensing', async () => {
  for (const file of CHARACTERS.flatMap((character) => [character.model, character.hair, character.helmetHair].filter(Boolean))) {
    const bytes = await readFile(new URL(`../public/assets/models/${file}`, import.meta.url));
    assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(8), bytes.length);
    const length = bytes.readUInt32LE(12), document = JSON.parse(bytes.toString('utf8', 20, 20 + length));
    assert.match(document.asset.copyright, /Quaternius.*CC0/); assert.equal(document.buffers[0].uri, undefined);
    assert.ok(document.images.every((image) => image.bufferView !== undefined && image.uri === undefined));
  }
  for (const character of CHARACTERS) {
    const portrait = await readFile(new URL(`../public/assets/${character.image}`, import.meta.url));
    assert.equal(portrait.readUInt32BE(0), 0x89504e47); assert.equal(portrait.readUInt32BE(16), 512); assert.equal(portrait.readUInt32BE(20), 640);
  }
});
