import { mkdir, readFile, writeFile, access, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = process.env.ART_ENGINE_DIR || path.join(homedir(), 'engine');
let base = process.env.COMFY_URL;
if (!base) {
  try {
    base = JSON.parse(await readFile(path.join(engine, 'server-process.json'), 'utf8')).url;
  } catch {
    base = 'http://127.0.0.1:18188';
  }
}
const assets = [
  {
    file: 'foundry-hero.png', width: 1152, height: 768, seed: 7092431,
    prompt: 'masterpiece, best quality, very aesthetic, scenery, no humans, industrial science fiction military training arena, brutalist concrete architecture, monumental dark steel industrial foundry, tall red orange steel gantry on the right, cyan blue overcast sky, warm orange light, cinematic atmospheric perspective, dramatic wide angle establishing shot, game environment concept art, hard surface, small orange warning lights, dark charcoal foreground, futuristic shipping containers, highly detailed background, moody, composition with open space on the left, anime background art',
  },
  {
    file: 'foundry-panel.png', width: 768, height: 768, seed: 7092432,
    prompt: 'masterpiece, best quality, very aesthetic, no humans, industrial sci-fi metal wall panel texture, front view, flat orthographic view, dark desaturated blue gray steel panels, recessed vents, worn scratched steel, orange hazard stripe on the bottom, industrial surface, hard surface, sharp detail, game environment texture, symmetrical square composition, flat even lighting',
  },
  ...[
    ['longrail', 'an extremely long abandoned futuristic freight railway yard, two parallel rails leading to a distant vanishing point, blue steel cargo train carriages, glowing amber signal lights, stormy indigo evening sky, cinematic science fiction industrial environment'],
    ['drydock', 'a very wide futuristic dry dock cargo harbor, immense gantry cranes, rows of weathered orange and blue shipping containers, turquoise sea visible beyond seawalls, soft golden morning light, expansive military arena environment'],
    ['blocknine', 'abandoned futuristic city block at blue hour, concrete buildings and intersecting narrow alleys, violet and cyan light in windows, wet asphalt reflecting light, dramatic urban tactical arena, dense geometric city architecture'],
    ['whiteout', 'a futuristic arctic research outpost in a vast snowy plain, white modular laboratories, icy blue cargo crates, glacier mountains, pale cyan overcast sky, cold bright light, snow drifts, crisp science fiction military environment'],
    ['redline', 'an extremely long desert freight highway between red sandstone cliffs, rust colored industrial depots and low concrete barriers, sand and dust, warm copper sunset, distant mesas, abandoned tactical arena, cinematic wide desert landscape'],
  ].map(([id, scene], i) => ({ file: `${id}-hero.png`, width: 1152, height: 768, seed: 7092500 + i, prompt: `masterpiece, best quality, very aesthetic, scenery, no humans, ${scene}, wide angle establishing shot, highly detailed background, game environment concept art, moody cinematic composition, anime background art` })),
  {
    file: 'overgrowth-hero.png', width: 1152, height: 768, seed: 7092510,
    prompt: 'masterpiece, best quality, very aesthetic, scenery, no humans, abandoned monumental botanical conservatory, enormous weathered glass barrel vault and oxidized green steel arches, giant tropical tree and twisted roots growing through terracotta planters, lush green ferns, elevated narrow maintenance footbridge with stairs, pale warm sunlight through broken glass, moss covered tiled floor, derelict botanical laboratory wings, readable open walking paths, cinematic wide angle establishing shot, highly detailed game environment concept art, anime background art',
    negative: 'worst quality, low quality, blurry, text, logo, watermark, signature, people, character, firearm, dense fog, dark silhouette, jungle hiding every path, oversaturated',
  },
  {
    file: 'nightmarket-hero.png', width: 1152, height: 768, seed: 7092511,
    prompt: 'masterpiece, best quality, very aesthetic, scenery, no humans, closed Korean night street market at blue hour, narrow Seoul market street lined with small Korean food stalls, striped red and teal canvas awnings, warm amber hanging lanterns, colorful rectangular neon shop signs, two storey brick restaurants with open upper windows, stainless steel food counters and wooden produce crates, wet dark paving with soft colored reflections, overhead electrical cables, wide central market lane and side alleys, clear bright readable foreground, cinematic wide angle establishing shot, highly detailed game environment concept art, anime background art',
    negative: 'worst quality, low quality, blurry, watermark, signature, people, crowd, cars blocking street, pitch black, dark silhouette, heavy fog, oversaturated, futuristic megacity, skyscraper canyon',
  },
  ...[
    ['faultline', 'a massive abandoned open-pit stone quarry arena, terraced ochre rock faces, broad smooth access ramps descending into a central excavation basin, a large fixed rock drilling machine, rugged limestone cover, a low excavated side tunnel, northern elevated rocky ridge, dusty pale golden daylight, readable wide tactical routes, no stairs or conventional buildings'],
    ['sump', 'a monumental dry underground circular concrete reservoir, wide raised annular maintenance walkway around a lower central drainage basin, large cylindrical concrete piers, four broad sloping access ramps, green oxidized pipes and central pump baffles, dim teal ambient light and warm maintenance lights, readable traversable dry floor, no windows or staircases'],
    ['relay', 'an open-air circular communications relay facility, three separated antenna plazas connected by broad gently sloping paths, low mint gray relay cabinets and ceramic equipment cover, north elevated dish antenna platform and south maintenance deck, weathered pale concrete and turquoise technical trim, clear sky, readable open tactical routes, no conventional buildings or stairs'],
    ['bastion', 'a cooperative coastal defense installation with a bright mint green generator core at the rear, three broad rocky approach lanes converging toward layered low defensive cover, a small raised support deck reached by smooth wide ramps, warm amber lamps and cool blue sea haze, fixed concrete berms and steel service equipment, dramatic readable defensive arena, no conventional buildings or stairs'],
  ].map(([id, scene], i) => ({ file: `${id}-hero.png`, width: 1152, height: 768, seed: 7092600 + i, teamMapAsset: true, documentationAsset: true, prompt: `masterpiece, best quality, very aesthetic, scenery, no humans, ${scene}, wide angle establishing shot, highly detailed game environment concept art, anime background art, original environment, empty arena`, negative: 'worst quality, low quality, blurry, text, logo, watermark, signature, people, soldiers, character, firearm, dense fog, pitch black, buildings with windows, staircase, shipping container maze' })),
  { file: 'quarry-strata.png', width: 768, height: 768, seed: 7092610, teamMapAsset: true, prompt: 'masterpiece, best quality, no humans, seamless neutral beige gray limestone quarry rock material, thin horizontal sedimentary strata, subtle chipped cut stone microtexture, matte mineral surface, evenly lit flat orthographic material swatch, full frame, no shadows, no perspective, no objects' },
  { file: 'terrain-concrete.png', width: 768, height: 768, seed: 7092611, teamMapAsset: true, prompt: 'masterpiece, best quality, no humans, seamless neutral light gray weathered concrete material texture, fine aggregate and subtle damp mineral speckling, restrained industrial floor surface, matte finish, even diffuse lighting, flat orthographic material swatch, full frame, no cracks forming objects, no markings, no shadows, no perspective' },
  ...[
    ['circuit', 'dark charcoal teal futuristic circuit board surface pattern, thin mint cyan geometric circuit traces, microchip paths, intricate etched lines, subtle metallic finish, seamless flat surface, no perspective'],
    ['forge', 'dark gunmetal and burnt orange forged steel surface pattern, angular copper molten cracks, geometric armor camouflage, scratched metal, intricate abstract industrial pattern, seamless flat surface, no perspective'],
    ['camo', 'white gray black digital camouflage pattern texture, irregular angular geometric polygon patches, arctic military camouflage, flat graphic pattern, matte painted surface, seamless all over pattern, no perspective'],
  ].map(([id, pattern], i) => ({ file: `skin-${id}.png`, width: 768, height: 768, seed: 7092600 + i, prompt: `masterpiece, best quality, no humans, ${pattern}, game weapon skin texture, top down orthographic material swatch, flat even lighting, full frame abstract pattern` })),
  { file: 'operator-armor.png', width: 768, height: 768, seed: 7094101, prompt: 'masterpiece, best quality, no humans, seamless neutral medium gray ballistic vest cordura fabric texture, fine technical woven textile surface, subtle scuffed polymer microtexture, realistic tactical protective equipment material swatch, monochrome gray, flat orthographic full frame, uniform diffuse studio lighting, no objects, no symbols, no large panels' },
];
const negative = 'worst quality, low quality, lowres, blurry, text, logo, watermark, signature, people, person, character, face, organic, plants, oversaturated';
const selectedAsset = process.argv.find((arg) => arg.startsWith('--asset='))?.slice('--asset='.length);
if (selectedAsset && !assets.some((asset) => asset.file === selectedAsset)) throw new Error('Unknown asset filename');
if (process.argv.some(arg => arg === '--outfits' || arg.startsWith('--outfit='))) throw new Error('외형 카드는 npm run assets:characters로 실제 게임 모델에서 렌더링합니다.');

async function api(route, options = {}) {
  const response = await fetch(`${base}${route}`, { ...options, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`ComfyUI ${route}: ${response.status} ${await response.text()}`);
  return response.json();
}

await mkdir(path.join(root, 'public/assets'), { recursive: true });
await mkdir(path.join(root, 'docs/maps/concepts'), { recursive: true });
await mkdir(path.join(root, 'artifacts/workflows'), { recursive: true });
await mkdir(path.join(root, 'artifacts/asset-staging'), { recursive: true });
try {
  await api('/system_stats');
} catch (error) {
  console.error(`로컬 이미지 엔진에 연결할 수 없습니다: ${base}\n~/engine의 ComfyUI 서버를 실행하거나 COMFY_URL을 지정하세요.\n${error.message}`);
  process.exit(1);
}

const checkpointInfo = await api('/object_info/CheckpointLoaderSimple');
const checkpoints = checkpointInfo.CheckpointLoaderSimple.input.required.ckpt_name[0];
const checkpoint = checkpoints.find((name) => name.includes('animagine-xl-4.0-opt')) || checkpoints[0];
if (!checkpoint) throw new Error('ComfyUI에 체크포인트가 없습니다.');

for (const asset of assets) {
  if (process.argv.includes('--team-maps') && !asset.teamMapAsset) continue;
  if (selectedAsset && asset.file !== selectedAsset) continue;
  if (process.argv.includes('--maps') && !asset.file.endsWith('-hero.png')) continue;
  if (process.argv.includes('--materials') && !asset.file.startsWith('operator-')) continue;
  const target = path.join(root, asset.documentationAsset ? 'docs/maps/concepts' : 'public/assets', asset.file);
  if (!process.argv.includes('--force')) {
    try { await access(target); console.log(`기존 애셋 유지: ${asset.file}`); continue; } catch { /* Generate missing assets. */ }
  }
  const workflow = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: asset.prompt } },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: asset.negative || negative } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: asset.width, height: asset.height, batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], seed: asset.seed, steps: 24, cfg: 6, sampler_name: 'euler_ancestral', scheduler: 'normal', denoise: 1 } },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    // PreviewImage keeps this project out of another project's configured output directory.
    '7': { class_type: 'PreviewImage', inputs: { images: ['6', 0] } },
  };
  await writeFile(path.join(root, 'artifacts/workflows', `${asset.file}.json`), JSON.stringify(workflow, null, 2));
  const queued = await api('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: 'linkshot-assets' }) });
  console.log(`생성 중: ${asset.file} (${queued.prompt_id})`);
  let image;
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    await delay(2500);
    const history = (await api(`/history/${queued.prompt_id}`))[queued.prompt_id];
    if (history?.status?.status_str === 'error') throw new Error(JSON.stringify(history.status));
    image = history?.outputs?.['7']?.images?.[0];
    if (image) break;
  }
  if (!image) throw new Error(`이미지 생성 시간 초과: ${asset.file}. 엔진의 작업은 취소하지 않았습니다.`);
  const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type });
  const response = await fetch(`${base}/view?${query}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`이미지를 가져오지 못했습니다: ${response.status}`);
  const staged = path.join(root, 'artifacts/asset-staging', asset.file);
  await writeFile(staged, Buffer.from(await response.arrayBuffer()));
  await rename(staged, target);
  console.log(`저장 완료: ${path.relative(root, target)}`);
}

const provenance = {
  engine: 'ComfyUI (local, ~/engine)', checkpoint, modelLicense: 'CreativeML Open RAIL++-M',
  modelSource: 'https://huggingface.co/cagliostrolab/animagine-xl-4.0',
  note: 'Locally generated images; no paid API or external image service used. Procedural meshes, UI and sounds are authored in this project.',
};
const describe = ({ file, prompt, seed, width, height }) => ({ file, prompt, seed, width, height });
await writeFile(path.join(root, 'public/assets/asset-manifest.json'), JSON.stringify({ ...provenance, assets: assets.filter(asset => !asset.documentationAsset).map(describe) }, null, 2));
await writeFile(path.join(root, 'docs/maps/concepts/asset-manifest.json'), JSON.stringify({ ...provenance, assets: assets.filter(asset => asset.documentationAsset).map(describe) }, null, 2));
console.log('모든 로컬 이미지 애셋이 준비되었습니다.');
