import { mkdir, readFile, writeFile, access, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const executeFile = promisify(execFile);

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
  ...[
    ['circuit', 'dark charcoal teal futuristic circuit board surface pattern, thin mint cyan geometric circuit traces, microchip paths, intricate etched lines, subtle metallic finish, seamless flat surface, no perspective'],
    ['forge', 'dark gunmetal and burnt orange forged steel surface pattern, angular copper molten cracks, geometric armor camouflage, scratched metal, intricate abstract industrial pattern, seamless flat surface, no perspective'],
    ['camo', 'white gray black digital camouflage pattern texture, irregular angular geometric polygon patches, arctic military camouflage, flat graphic pattern, matte painted surface, seamless all over pattern, no perspective'],
  ].map(([id, pattern], i) => ({ file: `skin-${id}.png`, width: 768, height: 768, seed: 7092600 + i, prompt: `masterpiece, best quality, no humans, ${pattern}, game weapon skin texture, top down orthographic material swatch, flat even lighting, full frame abstract pattern` })),
  ...[
    ['field', 'military, soldier, olive green jacket, tactical vest, cargo pants, boots, orange trim, fingerless gloves, headset, goggles on forehead, uncovered head, practical field uniform'],
    ['runner', 'scout, (hood down:1.4), uncovered head, dark gray hooded jacket with hood resting behind neck, mint green trim, tactical vest, cargo pants, boots, fingerless gloves, futuristic reconnaissance uniform'],
    ['hazmat', 'hazmat specialist, yellow protective jacket, yellow cargo pants, dark gloves, boots, clear face shield raised above forehead, respirator hanging below chin, compact oxygen backpack, practical industrial workwear'],
    ['orbital', 'astronaut, (transparent glass helmet:1.2), (face visible through glass:1.4), white and pale blue spacesuit, gloves, boots, compact life support backpack, blue chest control panel'],
    ['retrobot', 'human pilot, orange armored vest over dark gray fabric uniform, orange shoulder guards, cargo pants, boots, fingerless gloves, headset, goggles on forehead, uncovered head, green equipment lights, retro futuristic pilot clothing'],
  ].map(([id, character], i) => ({
    file: `outfit-${id}.png`, width: 768, height: 1024, seed: 7093700 + i,
    prompt: `masterpiece, best quality, very aesthetic, rating:general, 1boy, adult man, solo, (human:1.3), (uncovered human face:1.5), (visible eyes nose and mouth:1.4), short black hair, brown eyes, looking at viewer, full body, standing, ${character}, fully clothed, natural human anatomy, original character, game character concept illustration, entire body including boots, centered, plain dark blue gray background, soft studio lighting, detailed fabric`,
    negative: 'worst quality, low quality, blurry, text, logo, watermark, signature, multiple people, crowd, cropped feet, close up, nude, naked, bikini, revealing clothes, blood, gore, weapon in hands, firearm, sword, robot, android, mannequin, blocky body, square head, mechanical face, (covered face:1.5), (faceless:1.5), full-face helmet, opaque visor, black face, mask over face, closed helmet, silhouette',
  })),
  { file: 'outfit-panels.png', width: 768, height: 768, seed: 7092800, prompt: 'masterpiece, best quality, no humans, neutral light gray futuristic polymer armor material texture, tiny geometric panel seams, fine matte microtexture, subtle fabric weave, clean abstract technical surface, even soft lighting, flat orthographic material swatch, seamless full frame pattern, no perspective' },
  { file: 'operator-fabric.png', width: 768, height: 768, seed: 7094100, prompt: 'masterpiece, best quality, no humans, seamless neutral medium gray ripstop military uniform fabric texture, fine woven textile fibers, small subtle square ripstop grid, realistic matte cotton nylon cloth surface, monochrome gray material swatch, full frame flat orthographic view, uniform diffuse studio lighting, no objects, no folds, no symbols' },
  { file: 'operator-armor.png', width: 768, height: 768, seed: 7094101, prompt: 'masterpiece, best quality, no humans, seamless neutral medium gray ballistic vest cordura fabric texture, fine technical woven textile surface, subtle scuffed polymer microtexture, realistic tactical protective equipment material swatch, monochrome gray, flat orthographic full frame, uniform diffuse studio lighting, no objects, no symbols, no large panels' },
  { file: 'operator-jacket.png', width: 768, height: 768, crop: [210, 250, 560, 640], seed: 7094102, prompt: 'masterpiece, best quality, no humans, front view tactical combat jacket chest panel fabric texture, neutral light gray military field jacket, cordura fabric, sewn cargo pockets, practical stitching, zipper in center, small webbing straps, natural cloth folds, matte woven textile, realistic game clothing diffuse texture, flat orthographic studio lighting, square full frame material, no head, no hands, no body, no text, no insignia' },
];
const negative = 'worst quality, low quality, lowres, blurry, text, logo, watermark, signature, people, person, character, face, organic, plants, oversaturated';
const selectedOutfits = process.argv.find((arg) => arg.startsWith('--outfit='))?.slice('--outfit='.length).split(',');
const selectedAsset = process.argv.find((arg) => arg.startsWith('--asset='))?.slice('--asset='.length);
if (selectedAsset && !assets.some((asset) => asset.file === selectedAsset)) throw new Error('Unknown asset filename');
if (selectedOutfits?.some((id) => !assets.some((asset) => asset.file === `outfit-${id}.png` && id !== 'panels'))) throw new Error('알 수 없는 외형입니다. --outfit=field,runner,hazmat,orbital,retrobot 중 선택하세요.');

async function api(route, options = {}) {
  const response = await fetch(`${base}${route}`, { ...options, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`ComfyUI ${route}: ${response.status} ${await response.text()}`);
  return response.json();
}

await mkdir(path.join(root, 'public/assets'), { recursive: true });
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
  if (selectedAsset && asset.file !== selectedAsset) continue;
  if (process.argv.includes('--materials') && !asset.file.startsWith('operator-')) continue;
  if (selectedOutfits && !selectedOutfits.some((id) => asset.file === `outfit-${id}.png`)) continue;
  if (process.argv.includes('--outfits') && !/^outfit-(?:field|runner|hazmat|orbital|retrobot)\.png$/.test(asset.file)) continue;
  const target = path.join(root, 'public/assets', asset.file);
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
  if (asset.crop) await executeFile(path.join(engine, '.venv/bin/python'), ['-c', 'from PIL import Image; import json,sys; p=sys.argv[1]; Image.open(p).crop(tuple(json.loads(sys.argv[2]))).resize((768,768),Image.Resampling.LANCZOS).save(p)', staged, JSON.stringify(asset.crop)]);
  await rename(staged, target);
  console.log(`저장 완료: public/assets/${asset.file}`);
}

await writeFile(path.join(root, 'public/assets/asset-manifest.json'), JSON.stringify({
  engine: 'ComfyUI (local, ~/engine)', checkpoint, modelLicense: 'CreativeML Open RAIL++-M',
  modelSource: 'https://huggingface.co/cagliostrolab/animagine-xl-4.0',
  note: 'Locally generated images; no paid API or external image service used. Procedural meshes, UI and sounds are authored in this project.',
  assets: assets.map(({ file, prompt, seed, width, height, crop }) => ({ file, prompt, seed, width, height, ...(crop ? { crop } : {}) })),
}, null, 2));
console.log('모든 로컬 이미지 애셋이 준비되었습니다.');
