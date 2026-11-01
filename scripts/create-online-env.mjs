import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const file = new URL('../online-server/.env', import.meta.url);
const privateIPv4 = (host) => { const [a, b] = host.split('.').map(Number); return isIP(host) === 4 && (a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168); };
const port = (value, fallback) => { const number = Number(value || fallback); if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error('개발 서버 포트는 1–65535 범위여야 합니다.'); return number; };

export function networkSettings(mode, config = {}, selectedHost = '', interfaces = networkInterfaces()) {
  if (!['--lan', '--local'].includes(mode)) throw new Error('사용법: online:config -- [--lan [서버의 사설 IPv4] | --local]');
  const lan = mode === '--lan';
  const host = lan ? selectedHost || config.LAN_HOST || Object.entries(interfaces).sort(([a], [b]) => Number(b === 'en0') - Number(a === 'en0')).flatMap(([, entries]) => entries.filter((entry) => !entry.internal && entry.family === 'IPv4' && privateIPv4(entry.address)).map((entry) => entry.address))[0] : '127.0.0.1';
  if (lan && (!host || !privateIPv4(host))) throw new Error('같은 LAN에서 접근할 서버의 사설 IPv4를 --lan 다음에 지정해 주세요.');
  const api = port(config.ONLINE_PORT, 8080), engine = port(config.ENGINE_PORT, 8090), frontend = port(config.PREVIEW_PORT, 4173);
  return { ONLINE_BIND: lan ? '0.0.0.0' : '127.0.0.1', ENGINE_BIND: lan ? '0.0.0.0' : '127.0.0.1', ONLINE_PORT: String(api), ENGINE_PORT: String(engine), PREVIEW_PORT: String(frontend), ONLINE_API_URL: `http://127.0.0.1:${api}`, ONLINE_SERVER_URL: `http://${host}:${api}`, ENGINE_PUBLIC_URL: `ws://${host}:${engine}/play`, FRONTEND_URL: `http://${host}:${frontend}`, FRONTEND_ORIGINS: `http://${host}:${frontend}` };
}

export function updateNetworkSettings(text, settings) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n', remaining = new Map(Object.entries(settings));
  const lines = text.split(/\r?\n/).map((line) => { const key = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=/)?.[1]; if (!Object.hasOwn(settings, key)) return line; remaining.delete(key); return `${key}=${settings[key]}`; });
  if (lines.at(-1) === '') lines.pop();
  return [...lines, ...[...remaining].map(([key, value]) => `${key}=${value}`)].join(newline) + newline;
}

async function main() {
  const [mode, host, ...extra] = process.argv.slice(2);
  if (extra.length || mode && !['--lan', '--local'].includes(mode) || mode === '--local' && host) throw new Error('사용법: online:config -- [--lan [서버의 사설 IPv4] | --local]');
  let current = ''; try { current = await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const settings = mode ? networkSettings(mode, { ...parseEnv(current), ...process.env }, host) : null;
  const values = `# Private local development configuration. Never commit this file.\nDATABASE_PASSWORD=${randomBytes(32).toString('base64url')}\nENGINE_SECRET=${randomBytes(48).toString('base64url')}\nONLINE_API_URL=http://127.0.0.1:8080\nENGINE_PUBLIC_URL=ws://127.0.0.1:8090/play\nFRONTEND_ORIGINS=http://127.0.0.1:4173\n`;
  try { await writeFile(file, values, { flag: 'wx', mode: 0o600 }); console.log('Created private online-server/.env. No values were printed.'); }
  catch (error) { if (error.code !== 'EEXIST') throw error; console.log('Existing online-server/.env was preserved.'); }
  if (!settings) return;
  const temporary = new URL(`.env.${randomUUID()}.tmp`, new URL('.', file));
  try { await writeFile(temporary, updateNetworkSettings(await readFile(file, 'utf8'), settings), { flag: 'wx', mode: 0o600 }); await rename(temporary, file); }
  finally { await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
  console.log(`${mode === '--lan' ? 'LAN 개발 모드' : '이 PC 전용 모드'}: ${settings.FRONTEND_URL} · 비밀키/기존 DB는 유지됩니다. 실행 중인 세 서버는 다시 시작해 주세요.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
