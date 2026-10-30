"""Clean CC0 firearm field recordings into deterministic browser-ready samples.
Requires numpy, available in ~/engine/.venv. Originals stay in ignored artifacts.
Source: Tabasco, https://opengameart.org/content/gunshot-sounds (CC0 1.0).
"""
import hashlib
import json
import wave
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'artifacts/audio-source'
OUTPUT = ROOT / 'public/assets/sounds'
OUTPUT.mkdir(parents=True, exist_ok=True)
SAMPLE_RATE = 44100


def read(name):
    with wave.open(str(SOURCE / name)) as stream:
        assert stream.getsampwidth() == 2
        samples = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2').astype(np.float64) / 32768
        return samples.reshape(-1, stream.getnchannels()).mean(axis=1), stream.getframerate()


# Audited isolated first blasts. Choosing the globally strongest region can
# select a later rapid burst, and the shotgun's first click is not its blast.
ISOLATED_BLASTS = {'sks.wav': 0.405, 'cz.wav': 0.275, 'mosin.wav': 0.470, 'shotty.wav': 0.245}


def clean(samples, rate):
    # Spectral subtraction uses quiet source frames as the noise estimate.
    size, hop = 1024, 256
    window = np.hanning(size)
    padded = np.pad(samples, (size, size))
    positions = list(range(0, len(padded) - size, hop))
    spectra = np.array([np.fft.rfft(padded[i:i + size] * window) for i in positions])
    power = np.abs(spectra) ** 2
    noise = np.quantile(power, 0.2, axis=0)
    gain = np.sqrt(np.maximum(0.025, 1 - noise * 1.5 / np.maximum(power, 1e-12)))
    frequency = np.fft.rfftfreq(size, 1 / rate)
    band = (1 - np.exp(-(frequency / 110) ** 4)) * np.exp(-(frequency / 14000) ** 8)
    output = np.zeros(len(padded)); weights = np.zeros(len(padded))
    for i, spectrum, mask in zip(positions, spectra, gain):
        output[i:i + size] += np.fft.irfft(spectrum * mask * band) * window
        weights[i:i + size] += window ** 2
    return (output / np.maximum(weights, 1e-9))[size:size + len(samples)]


profiles = {
    'rifle': ('sks.wav', 0.72, 1.03), 'smg': ('cz.wav', 0.46, 1.12),
    'shotgun': ('shotty.wav', 0.78, 0.93), 'sniper': ('mosin.wav', 1.0, 0.93),
    'pistol': ('cz.wav', 0.55, 1.0), 'lmg': ('sks.wav', 0.8, 0.88),
    'dmr': ('mosin.wav', 0.86, 1.04),
    'ak47': ('sks.wav', 0.85, 0.92), 'm4a1': ('sks.wav', 0.64, 1.10),
    'famas': ('sks.wav', 0.52, 1.18), 'mp5': ('cz.wav', 0.40, 1.15),
    'p90': ('cz.wav', 0.32, 1.35), 'ump45': ('cz.wav', 0.58, 0.87),
    'awp': ('mosin.wav', 1.10, 0.88), 'm82': ('mosin.wav', 1.24, 0.76),
    'spas12': ('shotty.wav', 0.90, 0.84), 'deagle': ('cz.wav', 0.72, 0.73),
    'm249': ('sks.wav', 0.77, 1.0), 'm14': ('mosin.wav', 0.80, 1.15),
    'glock18c': ('cz.wav', 0.34, 1.24),
}
prepared = {}
for name in {item[0] for item in profiles.values()}:
    samples, rate = read(name)
    prepared[name] = (clean(samples, rate), rate)

files = []
for weapon, (name, duration, pitch) in profiles.items():
    samples, rate = prepared[name]
    for variant in range(1):
        attack = int(ISOLATED_BLASTS[name] * rate)
        start = max(0, attack - int(rate * 0.009))
        positions = start + np.arange(int(duration * SAMPLE_RATE)) * rate / SAMPLE_RATE * pitch
        clip = np.interp(positions, np.arange(len(samples)), samples, left=0, right=0)
        clip -= clip.mean()
        # Retain one sharp report, not late echoes, bolt/pump clicks or another
        # recorded shot. Pitch is baked in once; playback is always rate 1.
        source_time = (positions - attack) / rate
        clip *= np.exp(-np.maximum(0, source_time - 0.045) / 0.03)
        clip[source_time >= 0.32] = 0
        fade = min(int(SAMPLE_RATE * 0.09), len(clip)); clip[-fade:] *= np.linspace(1, 0, fade) ** 2
        clip[:90] *= np.linspace(0, 1, min(90, len(clip)))
        clip *= 0.9 / max(0.01, np.max(np.abs(clip)))
        file = f'{weapon}-{variant + 1}.wav'
        with wave.open(str(OUTPUT / file), 'wb') as stream:
            stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(SAMPLE_RATE)
            stream.writeframes((np.clip(clip, -0.95, 0.95) * 32767).astype('<i2').tobytes())
        files.append({'file': file, 'recording': name, 'sourceAttack': ISOLATED_BLASTS[name], 'singleShot': True, 'variant': variant + 1, 'seconds': duration, 'sha256': hashlib.sha256((OUTPUT / file).read_bytes()).hexdigest()})
        print(file, 'prepared from', name)
(OUTPUT / 'manifest.json').write_text(json.dumps({'creator': 'Tabasco', 'license': 'CC0-1.0', 'source': 'https://opengameart.org/content/gunshot-sounds', 'archive': 'https://opengameart.org/sites/default/files/sounds.zip', 'processing': 'One audited isolated muzzle blast per weapon, 9ms lead-in, spectral noise reduction, filtering, fixed resampling, exponential echo/mechanical-tail suppression, peak normalization and fade. No random variations or paid API.', 'files': files}, indent=2) + '\n')
