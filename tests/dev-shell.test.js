import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)), scripts = ['spring.sh', 'online.sh', 'fe.sh'];
const supported = process.platform !== 'win32';
async function fixture({ nodeMajor } = {}) {
  const base = path.join(root, 'artifacts/dev-shell-tests'); await mkdir(base, { recursive: true }); const dir = await mkdtemp(path.join(base, 'project with spaces-'));
  for (const file of [...scripts, 'scripts/shell-common.sh', 'scripts/create-online-env.mjs']) { await mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await cp(path.join(root, file), path.join(dir, file)); }
  for (const name of ['three', 'ws']) { await mkdir(path.join(dir, 'node_modules', name), { recursive: true }); await writeFile(path.join(dir, 'node_modules', name, 'package.json'), '{}'); }
  await mkdir(path.join(dir, 'online-server')); const bin = path.join(dir, 'bin'), javaHome = path.join(dir, 'jdk 21'); await mkdir(bin); await mkdir(path.join(javaHome, 'bin'), { recursive: true });
  if (nodeMajor === undefined) await symlink(process.execPath, path.join(bin, 'node'));
  else { await writeFile(path.join(bin, 'node'), `#!/bin/sh\nprintf '%s\\n' '${nodeMajor}'\n`); await chmod(path.join(bin, 'node'), 0o755); }
  await writeFile(path.join(javaHome, 'bin/java'), '#!/bin/sh\nprintf "    java.specification.version = 21\\n" >&2\n'); await chmod(path.join(javaHome, 'bin/java'), 0o755);
  await writeFile(path.join(bin, 'mvn'), '#!/bin/sh\nexit 0\n'); await chmod(path.join(bin, 'mvn'), 0o755);
  await writeFile(path.join(bin, 'npm'), `#!/usr/bin/env node
import fs from 'node:fs'; import cp from 'node:child_process';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SHELL_TEST_LOG, JSON.stringify({ args, cwd: process.cwd(), javaHome: process.env.JAVA_HOME, onlineUrl: process.env.ONLINE_SERVER_URL }) + '\\n');
if (args[1] === 'online:config') { const child = cp.spawnSync(process.execPath, ['scripts/create-online-env.mjs'], { stdio: 'inherit' }); process.exit(child.status ?? 1); }
if (args[1] === 'build' && process.env.SHELL_TEST_FAIL_BUILD) process.exit(23);
`); await chmod(path.join(bin, 'npm'), 0o755);
  const log = path.join(dir, 'calls.jsonl');
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, JAVA_HOME: javaHome, SHELL_TEST_LOG: log }; delete env.ONLINE_API_URL; delete env.ONLINE_SERVER_URL; delete env.SHELL_TEST_FAIL_BUILD;
  return { dir, javaHome, env, run: (script, extra = {}) => spawnSync('sh', [path.join(dir, script)], { cwd: base, env: { ...env, ...extra }, encoding: 'utf8', timeout: 15_000 }), calls: async () => (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse) };
}

test('all three Unix entrypoints are executable and pass POSIX shell syntax checks', { skip: !supported }, async () => {
  for (const file of scripts) await access(path.join(root, file), constants.X_OK);
  for (const file of [...scripts, 'scripts/shell-common.sh']) { const result = spawnSync('sh', ['-n', path.join(root, file)], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); }
});

test('Spring and combat launchers find their root through spaces, select Java 21 and share a preserved private configuration', { skip: !supported }, async () => {
  const f = await fixture(); const spring = f.run('spring.sh'); assert.equal(spring.status, 0, spring.stderr);
  const config = await readFile(path.join(f.dir, 'online-server/.env'), 'utf8'); assert.match(config, /ENGINE_SECRET=.+/); assert.equal(spring.stdout.includes(config.match(/ENGINE_SECRET=(.+)/)[1]), false);
  const online = f.run('online.sh'); assert.equal(online.status, 0, online.stderr); assert.equal(await readFile(path.join(f.dir, 'online-server/.env'), 'utf8'), config);
  const calls = await f.calls(); assert.deepEqual(calls.map((call) => call.args), [['run', 'online:config'], ['run', 'online:dev'], ['run', 'online:config'], ['run', 'online:engine']]); assert.ok(calls.every((call) => call.cwd === f.dir)); assert.equal(calls[1].javaHome, f.javaHome);
});

test('FE launcher builds before preview, reads only the public API URL and honors explicit overrides', { skip: !supported }, async () => {
  const f = await fixture(), config = 'ONLINE_API_URL=http://127.0.0.1:8181\nENGINE_SECRET=example_private_engine_marker\n'; await writeFile(path.join(f.dir, 'online-server/.env'), config);
  const result = f.run('fe.sh'); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.includes('example_private_engine_marker'), false);
  let calls = await f.calls(); assert.deepEqual(calls.map((call) => call.args), [['run', 'build'], ['run', 'preview']]); assert.ok(calls.every((call) => call.onlineUrl === 'http://127.0.0.1:8181'));
  assert.equal(f.run('fe.sh', { ONLINE_SERVER_URL: 'http://127.0.0.1:8282' }).status, 0); calls = await f.calls(); assert.ok(calls.slice(2).every((call) => call.onlineUrl === 'http://127.0.0.1:8282')); assert.equal(await readFile(path.join(f.dir, 'online-server/.env'), 'utf8'), config);
});

test('FE launcher defaults to the local API and never starts preview after a failed build', { skip: !supported }, async () => {
  const f = await fixture(), result = f.run('fe.sh', { SHELL_TEST_FAIL_BUILD: '1' }); assert.equal(result.status, 23);
  const calls = await f.calls(); assert.deepEqual(calls.map((call) => call.args), [['run', 'build']]); assert.equal(calls[0].onlineUrl, 'http://127.0.0.1:8080');
});

test('an old Node version fails before creating configuration or starting a service', { skip: !supported }, async () => {
  const f = await fixture({ nodeMajor: 20 });
  for (const script of scripts) { const result = f.run(script); assert.equal(result.status, 1); assert.match(result.stderr, /Node\.js 22/); }
  await assert.rejects(access(path.join(f.dir, 'online-server/.env')), { code: 'ENOENT' }); await assert.rejects(f.calls(), { code: 'ENOENT' });
});

test('Java detection uses the specification version independently of vendor banner formatting', { skip: !supported }, async () => {
  const f = await fixture(), java = path.join(f.javaHome, 'bin/java');
  for (const version of ['21', '26', '1.8']) {
    await writeFile(java, `#!/bin/sh\nprintf 'Vendor runtime banner\\n    java.specification.version = ${version}\\n' >&2\n`);
    const result = spawnSync('sh', ['-c', '. "$1"; linkshot_java_version "$2"', 'sh', path.join(f.dir, 'scripts/shell-common.sh'), java], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), version);
  }
});
