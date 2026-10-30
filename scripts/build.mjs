import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPS } from '../shared/world.js';
import { SKINS, WEAPONS } from '../shared/catalog.js';
import { OUTFITS } from '../shared/outfits.js';
import { POINT_RULES } from '../shared/progression.js';
import { publicationRisk } from './security-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const images = [...new Set([...MAPS.map((map) => map.image), ...SKINS.map((skin) => skin.pattern).filter(Boolean), ...OUTFITS.flatMap((outfit) => [outfit.image, outfit.pattern]).filter(Boolean), 'foundry-panel.png', 'operator-fabric.png', 'operator-armor.png', 'operator-jacket.png'])];
for (const image of images) {
  try {
    const bytes = await readFile(path.join(root, 'public/assets', image));
    if (bytes.length < 100 || bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('Invalid PNG');
  } catch { console.error(`빌드에 필요한 이미지가 준비되지 않았습니다: public/assets/${image}\n먼저 npm run assets:generate로 애셋을 준비하세요. GitHub에는 생성된 public/assets도 함께 올려야 합니다.`); process.exit(1); }
}
for (const file of ['operator-human-v2.glb', 'operator-hair-v2.glb']) { const bytes = await readFile(path.join(root, 'public/assets/models', file)); if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`Invalid character model: ${file}`); }
const sounds = JSON.parse(await readFile(path.join(root, 'public/assets/sounds/manifest.json'), 'utf8'));
if (sounds.license !== 'CC0-1.0' || sounds.files.length !== WEAPONS.length) throw new Error('Missing licensed firearm recordings');
for (const { file } of sounds.files) { if (!/^[a-z][a-z0-9]*-1\.wav$/.test(file)) throw new Error('Invalid sound path'); const bytes = await readFile(path.join(root, 'public/assets/sounds', file)); if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`Invalid firearm sample: ${file}`); }
await mkdir(output, { recursive: true });
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
await writeFile(path.join(output, 'runtime-config.js'), "// Static hosting: no API, WebSocket server, or paid service required.\nexport const APP_MODE = 'solo';\nexport const PROFILE_STORAGE = 'browser';\n");
await writeFile(path.join(output, 'economy.json'), JSON.stringify({ version: 1, points: POINT_RULES, outfits: OUTFITS.map(({ id, price }) => ({ id, price })) }));
console.log('Vercel용 1인 플레이 빌드 완료: dist/ (게임 서버 불필요)');
