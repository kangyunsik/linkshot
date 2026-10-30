import { mkdir, cp, readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv.includes('--arm64') ? 'arm64' : 'amd64';
const label = platform === 'amd64' ? 'x64' : 'arm64';
const localGo = path.join(root, '.toolchain/go/bin', process.platform === 'win32' ? 'go.exe' : 'go');
let go = process.env.GO_BINARY || 'go';
try { await access(localGo); go = process.env.GO_BINARY || localGo; } catch { /* Try PATH. */ }
if (spawnSync(go, ['version'], { encoding: 'utf8' }).status !== 0) { console.error('패키징용 Go 컴파일러가 필요합니다. npm run setup:packaging을 먼저 실행하세요. 친구의 Windows에는 아무 개발 도구도 필요하지 않습니다.'); process.exit(1); }
const stage = path.join(root, 'artifacts/windows-stage');
const output = path.join(root, 'release');
await mkdir(stage, { recursive: true }); await mkdir(output, { recursive: true });
await cp(path.join(root, 'dist'), path.join(stage, 'web'), { recursive: true });
await cp(path.join(root, 'scripts/windows-launcher.go'), path.join(stage, 'main.go'));
const executable = path.join(output, `LINKSHOT-windows-${label}.exe`);
console.log(`Windows ${label} 단독 실행 파일 제작 중 (브라우저 자동 실행 + 정적 웹서버 내장)...`);
execFileSync(go, ['build', '-trimpath', '-ldflags=-s -w', '-o', executable, 'main.go'], { cwd: stage, env: { ...process.env, GOOS: 'windows', GOARCH: platform, CGO_ENABLED: '0' }, stdio: 'inherit' });
const bytes = await readFile(executable);
const instructions = Buffer.from(`LINKSHOT · 링크샷 — 1인 플레이 / Windows ${label}

[실행 방법]
1. ZIP 파일을 완전히 압축 해제합니다.
2. LINKSHOT.exe를 더블클릭합니다.
3. Edge/Chrome 등 기본 브라우저가 자동으로 열립니다.
4. 전장, 시작 무기, 스킨을 고르고 '연습전 시작'을 누릅니다.
5. '교전 시작'을 누르면 마우스가 잠기고 게임이 시작됩니다.

설치, 관리자 권한, Node.js, npm, Python, 인터넷 연결이 필요 없습니다.
현대적인 데스크톱 브라우저와 WebGL 그래픽 지원은 필요합니다.
브라우저가 자동으로 열리지 않으면 실행 창에 나온 http://127.0.0.1 주소를 직접 여세요.
게임 중에는 작은 실행 창을 열어 두세요. 종료할 때는 실행 창을 닫습니다.
누적 전적, 포인트, 구매 외형은 현재 Windows 사용자 설정 폴더의 LINKSHOT/profile.json에 자동 저장됩니다.
브라우저 데이터를 지우거나 새 ZIP으로 교체해도 이 저장 파일은 유지됩니다.

[조작]
WASD 이동 / 마우스 조준 / 좌클릭 사격 / 우클릭 정조준
1~7 또는 마우스 휠 무기 교체 / R 재장전
C 또는 Ctrl 누르기: 앉기 (브라우저에서는 C 권장)
Shift 달리기 / Space 점프 / Tab 점수판 / Esc 메뉴 / F 전체 화면
반자동 무기는 클릭할 때마다 한 발씩 발사합니다.
무기에 따라 이동속도가 달라지며 앉거나 정조준하는 동안에는 달릴 수 없습니다.
모든 전장의 계단식 발판에 걸어서 올라가거나 Space로 점프할 수 있습니다.
피격 시 조준점 주위의 빨간 표시가 공격 방향을 잠깐 알려줍니다.
메인 화면에서 누적 킬/데스/KD와 보유 포인트를 확인할 수 있습니다.
라운드 완료 시 완주 50 + 킬당 20 + 승리 100 LP를 받습니다. 중도 이탈에는 종료 보상이 없습니다.
외형 상점에서 포인트로 캐릭터를 구매할 수 있으며 체력, 속도, 피격 범위는 변하지 않습니다.

[참고]
이 파일은 디지털 서명되지 않은 개인 테스트용 빌드입니다.
Windows SmartScreen 또는 보안 소프트웨어의 확인/차단이 있을 수 있습니다.
출처와 SHA-256을 확인하고, 조직/컴퓨터의 보안 정책을 따르세요.
개발 도구 설치나 방화벽 해제는 필요하지 않습니다. 서버는 이 컴퓨터의 127.0.0.1에만 열립니다.
LAN 대전이 아닌 1인 플레이 전용입니다.
이름/MAC/IP를 수집하지 않는 기기별 자동 ID 방식이며, 계정 로그인이나 클라우드 동기화는 없습니다.
`.replace(/\n/g, '\r\n'), 'utf8');

// Small ZIP writer using Node's standard library; no system zip/7-Zip dependency.
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
const localEntries = [], directory = []; let offset = 0;
const folder = `LINKSHOT-Windows-${label}`;
const entries = [[`${folder}/LINKSHOT.exe`, bytes], [`${folder}/먼저 읽어주세요.txt`, instructions], [`${folder}/THIRD_PARTY_NOTICES.txt`, await readFile(path.join(root, 'public/THIRD_PARTY_NOTICES.txt'))]];
for (const [name, data] of entries) {
  const filename = Buffer.from(name, 'utf8'), compressed = deflateRawSync(data, { level: 9 }), crc = crc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(33, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
  localEntries.push(local, filename, compressed); directory.push(central, filename); offset += local.length + filename.length + compressed.length;
}
const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
const zipName = `LINKSHOT-Windows-${label}.zip`;
await writeFile(path.join(output, zipName), Buffer.concat([...localEntries, central, end]));
await writeFile(path.join(output, `${zipName}.sha256`), `${createHash('sha256').update(await readFile(path.join(output, zipName))).digest('hex')}  ${zipName}\n`);
console.log(`완료: release/${zipName}\n친구에게 ZIP만 보내세요. 압축 해제 후 LINKSHOT.exe를 더블클릭하면 됩니다.\n이 Mac에서 교차 빌드했으며, 실제 Windows에서의 실행 확인은 별도로 필요합니다.`);
