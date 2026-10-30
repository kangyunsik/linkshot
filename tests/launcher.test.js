import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, cp, access } from 'node:fs/promises';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let go = process.env.GO_BINARY || path.join(root, '.toolchain/go/bin', process.platform === 'win32' ? 'go.exe' : 'go');
try { await access(go); } catch { go = 'go'; }
const hasGo = spawnSync(go, ['version'], { encoding: 'utf8' }).status === 0;

test('portable launcher serves embedded files on loopback without Node or external browser automation', { skip: !hasGo, timeout: 90_000 }, async (t) => {
  const stage = path.join(root, 'artifacts/launcher-smoke');
  await mkdir(path.join(stage, 'web/shared'), { recursive: true });
  await writeFile(path.join(stage, 'web/index.html'), '<!doctype html><title>LINKSHOT launcher test</title>Embedded solo build');
  await writeFile(path.join(stage, 'web/shared/test.js'), 'export const embedded = true;');
  await cp(path.join(root, 'scripts/windows-launcher.go'), path.join(stage, 'main.go'));
  const binary = path.join(stage, process.platform === 'win32' ? 'launcher-test.exe' : 'launcher-test');
  execFileSync(go, ['build', '-trimpath', '-o', binary, 'main.go'], { cwd: stage, env: { ...process.env, CGO_ENABLED: '0' }, timeout: 70_000 });
  const child = spawn(binary, ['--no-browser'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode !== null) return; const stopped = new Promise((resolve) => child.once('exit', resolve)); child.kill('SIGINT'); await stopped; });
  const url = await new Promise((resolve, reject) => {
    let text = ''; const timeout = setTimeout(() => reject(new Error('Launcher did not print a URL')), 10_000);
    child.on('error', reject);
    child.stdout.on('data', (chunk) => { text += chunk.toString(); const match = text.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
  });
  const response = await fetch(url); assert.match(await response.text(), /Embedded solo build/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const script = await fetch(`${url}/shared/test.js`); assert.equal(script.status, 200); assert.match(script.headers.get('content-type'), /javascript/); assert.match(await script.text(), /embedded/);
  assert.equal((await fetch(`${url}/api/info`)).status, 404);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  const forbidden = await new Promise((resolve, reject) => { http.get(url, { headers: { Host: 'unexpected.invalid' } }, (response) => { response.resume(); response.once('end', () => resolve(response.statusCode)); }).once('error', reject); });
  assert.equal(forbidden, 403);
});
