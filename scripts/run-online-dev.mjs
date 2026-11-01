import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), backend = path.join(root, 'online-server');
const mvn = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
const build = spawn(mvn, ['-q', 'test-compile', 'dependency:build-classpath', '-DincludeScope=test', '-Dmdep.outputFile=target/dev-classpath.txt'], { cwd: backend, stdio: 'inherit' });
let child = build;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
const built = await new Promise((resolve) => { build.on('error', () => resolve(1)); build.on('exit', (code) => resolve(code)); });
if (built !== 0) process.exit(built || 1);
const dependencies = (await readFile(path.join(backend, 'target/dev-classpath.txt'), 'utf8')).trim();
const classpath = [path.join(backend, 'target/test-classes'), path.join(backend, 'target/classes'), dependencies].join(path.delimiter);
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
const server = spawn(java, ['-Djava.io.tmpdir=' + path.join(backend, 'target'), '-cp', classpath, 'com.linkshot.online.DevelopmentServer'], { cwd: backend, stdio: 'inherit' });
child = server;
server.on('exit', (code) => process.exit(code || 0)); server.on('error', () => { console.error('Java 21 is required for the local online API.'); process.exitCode = 1; });
