"""Prepare CC0 recorded reload foley; optionally process it with local ComfyUI.
Run with ~/engine/.venv/bin/python scripts/prepare-reloads.py --engine.
Downloaded originals, engine workflows and intermediate FLACs stay in artifacts.
"""
import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import urllib.request
import uuid
import wave
import zipfile
from pathlib import Path
import av
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'artifacts/reload-source'
OUTPUT = ROOT / 'public/assets/sounds'
RATE = 44100
FILES = {'pistol': 'pistol-original.wav', 'rack': 'Rack.mp3', 'first': 'First Shell.mp3', 'chamber': 'Shell in Chamber.mp3', 'shell': 'Subsequent Shells.mp3'}
CREDITS = [
    {'creator': 'zer0_sol', 'license': 'CC0-1.0', 'source': 'https://opengameart.org/content/handgun-reload-sound-effect', 'download': 'https://opengameart.org/sites/default/files/reload.wav'},
    {'creator': 'zer0_sol', 'license': 'CC0-1.0', 'source': 'https://opengameart.org/content/shotgun-reload-sound-effects', 'download': 'https://opengameart.org/sites/default/files/shotgunsounds.zip'},
]


def download_sources():
    SOURCE.mkdir(parents=True, exist_ok=True)
    for filename, credit in [('pistol-original.wav', CREDITS[0]), ('shotgunsounds.zip', CREDITS[1])]:
        target = SOURCE / filename
        if not target.exists():
            request = urllib.request.Request(credit['download'], headers={'User-Agent': 'LINKSHOT asset preparation'})
            target.write_bytes(urllib.request.urlopen(request, timeout=45).read())
    with zipfile.ZipFile(SOURCE / 'shotgunsounds.zip') as archive:
        for filename in FILES.values():
            if filename.endswith('.mp3'):
                (SOURCE / filename).write_bytes(archive.read(f'ShotgunSounds/{filename}'))


def read_audio(path):
    arrays = []
    with av.open(str(path)) as container:
        resampler = av.AudioResampler(format='fltp', layout='mono', rate=RATE)
        for frame in container.decode(audio=0):
            arrays.extend(item.to_ndarray()[0] for item in resampler.resample(frame))
        arrays.extend(item.to_ndarray()[0] for item in resampler.resample(None))
    return np.concatenate(arrays).astype(np.float64)


async def process_engine():
    import aiohttp
    engine = Path(os.environ.get('ART_ENGINE_DIR', str(Path.home() / 'engine')))
    url = os.environ.get('COMFY_URL', 'http://127.0.0.1:18188').rstrip('/')
    folder = engine / 'input/linkshot-reload-foley'; folder.mkdir(parents=True, exist_ok=True)
    prompt, outputs = {}, {}
    for i, (name, filename) in enumerate(FILES.items()):
        (folder / filename).write_bytes((SOURCE / filename).read_bytes())
        load, level, equalize, save = [str(i * 4 + j) for j in [1, 2, 3, 4]]
        prompt[load] = {'class_type': 'LoadAudio', 'inputs': {'audio': f'linkshot-reload-foley/{filename}'}}
        prompt[level] = {'class_type': 'AudioAdjustVolume', 'inputs': {'audio': [load, 0], 'volume': -6}}
        prompt[equalize] = {'class_type': 'AudioEqualizer3Band', 'inputs': {'audio': [level, 0], 'low_gain_dB': -5.0, 'low_freq': 120, 'mid_gain_dB': 2.0, 'mid_freq': 1700, 'mid_q': 0.8, 'high_gain_dB': -2.0, 'high_freq': 7000}}
        prompt[save] = {'class_type': 'SaveAudio', 'inputs': {'audio': [equalize, 0], 'filename_prefix': f'audio/linkshot_reload_{name}'}}
        outputs[save] = name
    (SOURCE / 'engine-workflow.json').write_text(json.dumps(prompt, indent=2) + '\n')
    client_id = str(uuid.uuid4())
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=180)) as session:
        async with session.ws_connect(f'{url}/ws?clientId={client_id}') as socket:
            response = await session.post(f'{url}/prompt', json={'prompt': prompt, 'client_id': client_id})
            result = await response.json()
            if response.status != 200: raise RuntimeError(str(result))
            prompt_id = result['prompt_id']
            async for message in socket:
                if message.type != aiohttp.WSMsgType.TEXT: continue
                event = json.loads(message.data); data = event.get('data', {})
                if data.get('prompt_id') != prompt_id: continue
                if event['type'] == 'execution_error': raise RuntimeError(str(data))
                if event['type'] == 'executing' and data.get('node') is None: break
        response = await session.get(f'{url}/history/{prompt_id}'); history = (await response.json())[prompt_id]
        for node, name in outputs.items():
            record = history['outputs'][node]['audio'][0]
            response = await session.get(f'{url}/view', params={key: record[key] for key in ['filename', 'subfolder', 'type']})
            response.raise_for_status(); (SOURCE / f'{name}-engine.flac').write_bytes(await response.read()); print('Engine EQ prepared', name)
    (SOURCE / 'engine-processing.json').write_text(json.dumps({'engine': 'ComfyUI AudioEqualizer3Band', 'inputGainDB': -6, 'lowGainDB': -5, 'midGainDB': 2, 'highGainDB': -2}) + '\n')


def prepare():
    originals = {name: read_audio(SOURCE / f'{name}-engine.flac' if (SOURCE / f'{name}-engine.flac').exists() else SOURCE / filename) for name, filename in FILES.items()}
    cuts = {'release': ('pistol', 0.095, 0.26), 'insert': ('pistol', 0.59, 0.78), 'pull': ('pistol', 1.09, 1.18), 'lock': ('pistol', 1.195, 1.30), 'back': ('rack', 0.62, 0.805), 'forward': ('rack', 0.82, 1.045), 'handle': ('first', 0.35, 0.59), 'seat': ('shell', 0.88, 1.015), 'seat2': ('shell', 1.11, 1.285), 'feed': ('chamber', 0.50, 0.855), 'close': ('chamber', 1.09, 1.34)}
    parts = {}
    for name, (source, start, end) in cuts.items():
        clip = originals[source][int(start * RATE):int(end * RATE)].copy(); clip -= clip.mean()
        fade = min(int(RATE * 0.004), len(clip) // 4); clip[:fade] *= np.linspace(0, 1, fade); clip[-fade:] *= np.linspace(1, 0, fade)
        clip *= 0.85 / max(0.001, np.max(np.abs(clip))); parts[name] = clip
    # Each weapon has its own edit, not one common reload with a random pitch.
    # All times are measured from the immediate server reload start.
    profiles = {
        'rifle': (1.00, [('release', .02, .55), ('insert', .83, 1), ('back', 1.35, .65), ('lock', 1.59, .85)]),
        'pistol': (1.08, [('release', .02, .65), ('insert', .49, .9), ('pull', .84, .75), ('lock', .99, .9)]),
        'smg': (1.15, [('release', .02, .6), ('insert', .70, 1), ('pull', 1.10, .75), ('lock', 1.30, .9)]),
        'lmg': (.88, [('feed', .02, .75), ('release', .48, .6), ('insert', 1.52, 1), ('seat', 2.02, .4), ('seat2', 2.18, .4), ('seat', 2.34, .4), ('forward', 2.65, .9), ('pull', 3.02, .8), ('lock', 3.20, 1)]),
        'dmr': (.97, [('release', .02, .7), ('insert', 1.06, 1), ('pull', 1.61, .8), ('lock', 1.87, .95)]),
        'ak47': (.91, [('release', .02, .7), ('insert', 1.04, 1), ('release', 1.31, .3), ('back', 1.76, .8), ('lock', 2.08, 1)]),
        'm4a1': (1.04, [('release', .02, .6), ('insert', .9, 1), ('release', 1.22, .28), ('pull', 1.56, .7), ('lock', 1.73, 1)]),
        'famas': (1.13, [('release', .02, .55), ('insert', 1.10, .95), ('feed', 1.72, .65), ('lock', 2.15, 1)]),
        'mp5': (1.18, [('release', .02, .55), ('insert', .75, 1), ('pull', 1.06, .65), ('forward', 1.37, .95)]),
        'p90': (1.12, [('release', .02, .55), ('feed', .92, .75), ('insert', 1.42, 1), ('pull', 2.00, .7), ('lock', 2.23, .95)]),
        'ump45': (.96, [('release', .02, .65), ('insert', .96, 1), ('back', 1.52, .8), ('lock', 1.91, .95)]),
        'sniper': (.90, [('release', .02, .5), ('insert', 1.32, .85), ('back', 2.02, .8), ('forward', 2.34, 1)]),
        'awp': (.83, [('back', .02, .7), ('release', .38, .5), ('insert', 1.55, .9), ('back', 2.30, .8), ('forward', 2.65, 1)]),
        'm82': (.80, [('release', .02, .8), ('insert', 1.72, 1), ('feed', 2.62, .8), ('lock', 3.20, 1)]),
        'deagle': (.85, [('release', .02, .7), ('insert', .96, 1), ('pull', 1.48, .9), ('lock', 1.72, 1)]),
        'm249': (.82, [('feed', .02, .8), ('release', .6, .6), ('insert', 1.85, 1), ('seat', 2.30, .45), ('seat2', 2.48, .4), ('seat', 2.68, .4), ('forward', 3.14, 1), ('back', 3.69, .85), ('lock', 4.02, 1)]),
        'm14': (.93, [('release', .02, .6), ('insert', 1.18, 1), ('back', 1.86, .8), ('lock', 2.28, .95)]),
        'glock18c': (1.22, [('release', .02, .6), ('insert', .82, 1), ('pull', 1.26, .8), ('lock', 1.47, .95)]),
    }
    for weapon, duration, pitch in [('shotgun', 2.4, 1.04), ('spas12', 3.0, .92)]:
        stages = [('back', .02, .65), ('handle', .17, .35)]
        stages += [('seat' if i % 2 == 0 else 'seat2', .36 + i * (duration - .90) / 7, .55) for i in range(8)]
        stages += [('forward', duration - .29, 1)]
        profiles[weapon] = (pitch, stages)
    catalog = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', "import { WEAPONS } from './shared/catalog.js'; console.log(JSON.stringify(WEAPONS));"], cwd=ROOT))
    files = []; OUTPUT.mkdir(parents=True, exist_ok=True)
    for weapon in catalog:
        name, duration = weapon['id'], weapon['reloadSeconds']; pitch, stages = profiles[name]
        output = np.zeros(round(duration * RATE))
        for part, at, gain in stages:
            clip = parts[part]; positions = np.arange(round(len(clip) / pitch)) * pitch
            clip = np.interp(positions, np.arange(len(clip)), clip)
            start = round(at * RATE); count = min(len(clip), len(output) - start)
            if count > 0: output[start:start + count] += clip[:count] * gain
        frequency = np.fft.rfftfreq(len(output), 1 / RATE)
        heavy = weapon['type'] in ('LMG', 'SNIPER') or name in ('ak47', 'deagle')
        equalizer = (1 + (0.55 if heavy else .12) / (1 + (frequency / 600) ** 2)) * (1 - np.exp(-(frequency / 65) ** 4)) / np.sqrt(1 + (frequency / (6500 if heavy else 9000)) ** 8)
        output = np.fft.irfft(np.fft.rfft(output) * equalizer, len(output)); output -= output.mean()
        fade = round(RATE * .012); output[:100] *= np.linspace(0, 1, 100); output[-fade:] *= np.linspace(1, 0, fade)
        output *= .82 / max(.001, np.max(np.abs(output)))
        filename = f'reload-{name}.wav'
        with wave.open(str(OUTPUT / filename), 'wb') as stream:
            stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(RATE); stream.writeframes((np.clip(output, -.9, .9) * 32767).astype('<i2').tobytes())
        files.append({'file': filename, 'weaponId': name, 'seconds': duration, 'fixedPitch': pitch, 'stages': [{'part': part, 'at': at} for part, at, gain in stages], 'sha256': hashlib.sha256((OUTPUT / filename).read_bytes()).hexdigest()})
        print('Prepared', filename)
    processed = all((SOURCE / f'{name}-engine.flac').exists() for name in FILES)
    processing = 'Recorded magazine/slide/shell/pump foley, ' + ('local ComfyUI headroom and 3-band EQ, ' if processed else 'local spectral EQ, ') + 'individually edited weapon timelines, fixed resampling, spectral shaping, fades and safe peak normalization. No electronic placeholder or runtime pitch randomization.'
    (OUTPUT / 'reload-manifest.json').write_text(json.dumps({'license': 'CC0-1.0', 'sources': CREDITS, 'processing': processing, 'engineProcessed': processed, 'files': files}, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--engine', action='store_true'); parser.add_argument('--sources-only', action='store_true'); args = parser.parse_args()
    download_sources()
    if args.engine: asyncio.run(process_engine())
    for name, filename in FILES.items():
        path = SOURCE / f'{name}-engine.flac'; samples = read_audio(path if path.exists() else SOURCE / filename)
        print(name, round(len(samples) / RATE, 3), 'seconds')
    if not args.sources_only: prepare()


if __name__ == '__main__': main()
