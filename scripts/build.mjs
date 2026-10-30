import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPS } from '../shared/world.js';
import { SKINS } from '../shared/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const images = [...new Set([...MAPS.map((map) => map.image), ...SKINS.map((skin) => skin.pattern).filter(Boolean), 'foundry-panel.png'])];
for (const image of images) {
  try {
    const bytes = await readFile(path.join(root, 'public/assets', image));
    if (bytes.length < 100 || bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('Invalid PNG');
  } catch { console.error(`빌드에 필요한 이미지가 준비되지 않았습니다: public/assets/${image}\n먼저 npm run assets:generate로 애셋을 준비하세요. GitHub에는 생성된 public/assets도 함께 올려야 합니다.`); process.exit(1); }
}
await mkdir(output, { recursive: true });
await cp(path.join(root, 'public'), output, { recursive: true });
await cp(path.join(root, 'shared'), path.join(output, 'shared'), { recursive: true });
await mkdir(path.join(output, 'vendor'), { recursive: true });
for (const file of ['three.module.js', 'three.core.js']) await cp(path.join(root, 'node_modules/three/build', file), path.join(output, 'vendor', file));
await writeFile(path.join(output, 'runtime-config.js'), "// Static hosting: no API, WebSocket server, or paid service required.\nexport const APP_MODE = 'solo';\n");
console.log('Vercel용 1인 플레이 빌드 완료: dist/ (게임 서버 불필요)');
