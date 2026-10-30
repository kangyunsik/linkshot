import { mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.toolchain');
const binary = path.join(local, 'go/bin', process.platform === 'win32' ? 'go.exe' : 'go');
try { await access(binary); console.log(`프로젝트 전용 Go 도구가 이미 있습니다: ${binary}`); process.exit(0); } catch { /* Install locally. */ }
const os = { darwin: 'darwin', linux: 'linux' }[process.platform];
const arch = { arm64: 'arm64', x64: 'amd64' }[process.arch];
if (!os || !arch) { console.error('이 자동 설치는 macOS/Linux x64/ARM64 빌드 컴퓨터용입니다. Windows 빌드 컴퓨터에서는 https://go.dev/dl/ 에서 Go를 설치하세요. 친구 컴퓨터에는 Go가 필요 없습니다.'); process.exit(1); }
console.log('Windows 실행 파일 제작을 위해 공식 Go 컴파일러를 이 프로젝트의 .toolchain/에만 설치합니다. 시스템 환경은 변경하지 않습니다.');
const metadata = await fetch('https://go.dev/dl/?mode=json', { signal: AbortSignal.timeout(30_000) });
if (!metadata.ok) throw new Error(`Go 배포 정보: ${metadata.status}`);
const releases = await metadata.json();
const release = releases.find((entry) => entry.stable);
const archive = release?.files.find((file) => file.os === os && file.arch === arch && file.kind === 'archive' && file.filename.endsWith('.tar.gz'));
if (!archive) throw new Error('현재 빌드 컴퓨터에 맞는 Go 배포본을 찾지 못했습니다.');
console.log(`다운로드: ${archive.filename} (${Math.round(archive.size / 1024 / 1024)} MB)`);
const response = await fetch(`https://go.dev/dl/${archive.filename}`, { signal: AbortSignal.timeout(180_000) });
if (!response.ok) throw new Error(`Go 다운로드: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const digest = createHash('sha256').update(bytes).digest('hex');
if (digest !== archive.sha256) throw new Error('Go 배포본 체크섬이 일치하지 않아 설치를 중단했습니다.');
await mkdir(local, { recursive: true });
const target = path.join(local, archive.filename); await writeFile(target, bytes);
execFileSync('tar', ['-xzf', target, '-C', local], { stdio: 'inherit' });
await writeFile(path.join(local, 'source.json'), JSON.stringify({ version: release.version, filename: archive.filename, sha256: digest, source: `https://go.dev/dl/${archive.filename}` }, null, 2));
console.log(execFileSync(binary, ['version'], { encoding: 'utf8' }).trim());
console.log('준비 완료. 이제 npm run package:windows를 실행하세요.');
