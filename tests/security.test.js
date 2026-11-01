import test from 'node:test';
import assert from 'node:assert/strict';
import { checkText, publicationRisk, pngMetadata } from '../scripts/security-audit.mjs';

test('publication guard blocks local credentials and generated output, including force-tracked files', () => {
  for (const file of ['.env', '.env.production', '.npmrc', 'private.key', 'service-account-prod.json', 'release/game.zip', '.toolchain/go/bin/go', 'artifacts/lobby.png', 'profile.json', 'profile.json.tmp', 'linkshot-profile-backup.json', 'data/profiles.json', 'online-server/target/postgres-tests/PG_VERSION', 'online-server/app.jar', 'next-plan.md']) assert.ok(publicationRisk(file), file);
  for (const file of ['.env.example', '.env.production.example', 'public/assets/foundry-hero.png', 'shared/catalog.js']) assert.equal(publicationRisk(file), null, file);
});

test('security findings identify rules without exposing the matching values', () => {
  const token = ['ghp', '_', 'A'.repeat(36)].join('');
  const findings = checkText(`const key = '${token}';`);
  assert.ok(findings.some((finding) => finding.rule === 'github-token'));
  assert.ok(!JSON.stringify(findings).includes(token));
  const home = ['/', 'Users', '/', 'private-user', '/', 'project'].join('');
  assert.ok(checkText(home).some((finding) => finding.rule === 'absolute-user-path'));
  const privateAddress = ['192', '168', '42', '73'].join('.');
  assert.ok(checkText(privateAddress).some((finding) => finding.rule === 'private-network-address'));
  assert.deepEqual(checkText('http://127.0.0.1:3000 https://example.com process.env.API_KEY'), []);
});

test('PNG metadata inspection reads text without touching image pixels', () => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const text = Buffer.from('prompt\0{"safe":"test"}');
  const chunk = Buffer.alloc(12 + text.length); chunk.writeUInt32BE(text.length); chunk.write('tEXt', 4); text.copy(chunk, 8);
  assert.deepEqual(pngMetadata(Buffer.concat([signature, chunk])), [{ key: 'prompt', text: '{"safe":"test"}' }]);
  assert.deepEqual(pngMetadata(Buffer.from('not a PNG')), []);
});
