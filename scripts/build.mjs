import { cp, mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPS } from '../shared/world.js';
import { SKINS, WEAPONS, FREE_WEAPON_IDS } from '../shared/catalog.js';
import { OUTFITS, CHARACTERS } from '../shared/outfits.js';
import { POINT_RULES, SUPPRESSOR_LEVEL, SUPPRESSOR_KILLS } from '../shared/progression.js';
import { publicationRisk } from './security-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
let onlineServerUrl = '';
let frontendOrigin = '';
if (process.env.FRONTEND_URL) {
  const url = new URL(process.env.FRONTEND_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('FRONTEND_URL must be a public HTTP(S) frontend origin.');
  frontendOrigin = url.origin;
}
if (process.env.ONLINE_SERVER_URL) {
  const url = new URL(process.env.ONLINE_SERVER_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('ONLINE_SERVER_URL must be a public HTTP(S) API base URL without credentials/query parameters.');
  onlineServerUrl = url.href.replace(/\/$/, '');
}
const images = [...new Set([...MAPS.flatMap((map) => [map.image, map.previewImage].filter(Boolean)), ...SKINS.map((skin) => skin.pattern).filter(Boolean), ...OUTFITS.flatMap((outfit) => [outfit.image, outfit.pattern]).filter(Boolean), ...CHARACTERS.map((character) => character.image), 'foundry-panel.png', 'operator-fabric.png', 'operator-armor.png', 'operator-jacket.png', 'quarry-strata.png', 'terrain-concrete.png'])];
for (const image of images) {
  try {
    const bytes = await readFile(path.join(root, 'public/assets', image));
    if (image.endsWith('.svg')) { const svg = bytes.toString('utf8'); if (!svg.startsWith('<svg ') || /<script|\bon\w+\s*=|(?:href|src)\s*=/i.test(svg)) throw new Error('Unsafe SVG preview'); }
    else if (bytes.length < 100 || bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('Invalid PNG');
  } catch { console.error(`빌드에 필요한 이미지가 준비되지 않았습니다: public/assets/${image}\n먼저 npm run assets:generate로 애셋을 준비하세요. GitHub에는 생성된 public/assets도 함께 올려야 합니다.`); process.exit(1); }
}
for (const file of CHARACTERS.flatMap((character) => [character.model, character.hair, character.helmetHair].filter(Boolean))) { const bytes = await readFile(path.join(root, 'public/assets/models', file)); if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid character model: ${file}`); }
const hands = JSON.parse(await readFile(path.join(root, 'public/assets/models/view-hands-manifest.json'), 'utf8'));
if (hands.license !== 'CC0-1.0' || hands.files.length !== CHARACTERS.length) throw new Error('Missing licensed first-person anatomy');
for (const character of CHARACTERS) { const file = `view-hands-${character.id}-v1.glb`, item = hands.files.find((item) => item.file === file), bytes = await readFile(path.join(root, 'public/assets/models', file)); if (!item || item.hands !== 2 || bytes.length !== item.bytes || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid first-person hand model: ${file}`); }
const sounds = JSON.parse(await readFile(path.join(root, 'public/assets/sounds/manifest.json'), 'utf8'));
if (sounds.license !== 'CC0-1.0' || sounds.files.length !== WEAPONS.length) throw new Error('Missing licensed firearm recordings');
for (const { file } of sounds.files) { if (!/^[a-z][a-z0-9]*-1\.wav$/.test(file)) throw new Error('Invalid sound path'); const bytes = await readFile(path.join(root, 'public/assets/sounds', file)); if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`Invalid firearm sample: ${file}`); }
const reloads = JSON.parse(await readFile(path.join(root, 'public/assets/sounds/reload-manifest.json'), 'utf8'));
if (reloads.license !== 'CC0-1.0' || reloads.files.length !== WEAPONS.length) throw new Error('Missing recorded reload sounds');
for (const weapon of WEAPONS) { const item = reloads.files.find((item) => item.weaponId === weapon.id); if (item?.file !== `reload-${weapon.id}.wav` || item.seconds !== weapon.reloadSeconds) throw new Error(`Invalid reload profile: ${weapon.id}`); const bytes = await readFile(path.join(root, 'public/assets/sounds', item.file)); if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`Invalid reload recording: ${item.file}`); }
await mkdir(output, { recursive: true });
// Only retire the known, archived team-map concepts from previous builds.
// Never remove unrelated files from the user's output directory.
for (const world of MAPS.filter(world => world.terrain)) {
  try { await unlink(path.join(output, 'assets', `${world.id}-hero.png`)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await cp(path.join(root, 'public'), output, { recursive: true, filter: (source) => {
  const relative = path.relative(root, source).split(path.sep).join('/');
  if (path.basename(source) === '.DS_Store') return false;
  if (publicationRisk(relative) || relative.split('/').includes('.git')) throw new Error(`개인 설정/저장 파일을 웹사이트에 포함할 수 없습니다: ${relative}`);
  return true;
} });
await cp(path.join(root, 'shared'), path.join(output, 'shared'), { recursive: true });
await mkdir(path.join(output, 'vendor'), { recursive: true });
for (const file of ['three.module.js', 'three.core.js']) await cp(path.join(root, 'node_modules/three/build', file), path.join(output, 'vendor', file));
for (const file of ['loaders/GLTFLoader.js', 'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js']) { await mkdir(path.dirname(path.join(output, 'vendor/addons', file)), { recursive: true }); await cp(path.join(root, 'node_modules/three/examples/jsm', file), path.join(output, 'vendor/addons', file)); }
const lanEnabled = ['true', '1'].includes(process.env.LAN_ENABLED);
await writeFile(path.join(output, 'runtime-config.js'), `// Account/ranked services are optional; LAN uses the same-origin combat proxy.\nexport const APP_MODE = '${lanEnabled ? 'lan' : 'solo'}';\nexport const LAN_PLAY_PATH = '${lanEnabled ? '/lan/play' : '/play'}';\nexport const PROFILE_STORAGE = 'browser';\nexport const ONLINE_SERVER_URL = ${JSON.stringify(onlineServerUrl)};\nexport const FRONTEND_URL = ${JSON.stringify(frontendOrigin)};\n`);
await writeFile(path.join(output, 'economy.json'), JSON.stringify({ version: 1, points: POINT_RULES, outfits: OUTFITS.map(({ id, price }) => ({ id, price })), weapons: WEAPONS.map(({ id, price }) => ({ id, price })), freeWeapons: FREE_WEAPON_IDS, mastery: { suppressorLevel: SUPPRESSOR_LEVEL, suppressorKills: SUPPRESSOR_KILLS } }));
console.log('Vercel용 1인 플레이 빌드 완료: dist/ (게임 서버 불필요)');
