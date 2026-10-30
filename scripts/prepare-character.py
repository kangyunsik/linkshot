"""Package the official CC0 Quaternius base into compact, self-contained GLBs.

Run with ~/engine/.venv/bin/python after downloading the Standard archive into
artifacts/character-source/universal-base-characters.zip. No paid assets are used.
"""
import io
import json
import struct
import zipfile
from pathlib import Path, PurePosixPath
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'artifacts/character-source/universal-base-characters.zip'
OUTPUT = ROOT / 'public/assets/models'
OUTPUT.mkdir(parents=True, exist_ok=True)


def pack(archive, name, target):
    document = json.loads(archive.read(name))
    folder = str(PurePosixPath(name).parent)
    binary = bytearray()

    def append(data):
        while len(binary) % 4:
            binary.append(0)
        offset = len(binary)
        binary.extend(data)
        return offset

    offsets = [append(archive.read(f'{folder}/{buffer["uri"]}')) for buffer in document['buffers']]
    for view in document['bufferViews']:
        view['byteOffset'] = offsets[view['buffer']] + view.get('byteOffset', 0)
        view['buffer'] = 0
    for image in document.get('images', []):
        filename = image.pop('uri')
        candidates = [f'{folder}/{filename}', f'{folder}/{filename.replace("_png.png", ".png")}']
        if filename == 'T_Superhero_Male_Dark.png':
            candidates.insert(0, 'Universal Base Characters[Standard]/Base Characters/Textures/T_Superhero_Male_Ligh.png')
        source = next((candidate for candidate in candidates if candidate in archive.namelist()), None)
        if not source:
            raise RuntimeError(f'Missing licensed texture: {filename}')
        picture = Image.open(io.BytesIO(archive.read(source)))
        picture.thumbnail((768, 768) if 'Superhero' in filename and 'Normal' not in filename and 'Roughness' not in filename else (512, 512))
        encoded = io.BytesIO()
        if picture.mode in ('RGB', 'L') and 'Normal' not in filename:
            picture.convert('RGB').save(encoded, 'JPEG', quality=88)
            image['mimeType'] = 'image/jpeg'
        else:
            picture.save(encoded, 'PNG', optimize=True)
            image['mimeType'] = 'image/png'
        data = encoded.getvalue()
        image['bufferView'] = len(document['bufferViews'])
        document['bufferViews'].append({'buffer': 0, 'byteOffset': append(data), 'byteLength': len(data)})
    document['buffers'] = [{'byteLength': len(binary)}]
    document['asset'] = {'version': '2.0', 'generator': 'LINKSHOT asset preparation', 'copyright': 'Quaternius, Universal Base Characters Standard, CC0 1.0. Textures resized; gameplay clothing is applied at runtime.'}
    metadata = json.dumps(document, separators=(',', ':')).encode()
    metadata += b' ' * (-len(metadata) % 4)
    binary += b'\0' * (-len(binary) % 4)
    total = 12 + 8 + len(metadata) + 8 + len(binary)
    data = struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(metadata), 0x4E4F534A) + metadata + struct.pack('<II', len(binary), 0x004E4942) + binary
    (OUTPUT / target).write_bytes(data)
    print(target, len(data), 'bytes')


with zipfile.ZipFile(SOURCE) as archive:
    prefix = 'Universal Base Characters[Standard]'
    pack(archive, f'{prefix}/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf', 'operator-human-v2.glb')
    pack(archive, f'{prefix}/Hairstyles/Origin at 0/glTF (Godot)/Hair_SimpleParted.gltf', 'operator-hair-v2.glb')
    license_text = archive.read(f'{prefix}/License_Standard.txt').decode('utf-8')
    (OUTPUT / 'LICENSE-Quaternius.txt').write_text('\n'.join(line.rstrip() for line in license_text.splitlines()) + '\n')
