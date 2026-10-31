"""Extract licensed anatomical hands from the already prepared CC0 operators.

Run with the local engine's Python/Pillow environment. No model download,
image-generation service or original archive is required at build/runtime.
"""
import copy
import hashlib
import io
import json
import re
import struct
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / 'public/assets/models'
DTYPES = {5121: 'u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}
WIDTHS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
files = []

for sex, source in [('male', 'operator-human-v2.glb'), ('female', 'operator-female-v3.glb')]:
    raw = (MODELS / source).read_bytes()
    json_size = struct.unpack_from('<I', raw, 12)[0]
    old = json.loads(raw[20:20 + json_size])
    binary = raw[28 + json_size:]

    def values(index):
        accessor = old['accessors'][index]
        view = old['bufferViews'][accessor['bufferView']]
        dtype = np.dtype(DTYPES[accessor['componentType']])
        width = WIDTHS[accessor['type']]
        offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        return np.ndarray((accessor['count'], width), dtype=dtype, buffer=binary, offset=offset, strides=(view.get('byteStride', dtype.itemsize * width), dtype.itemsize)).copy()

    body = next(node for node in old['nodes'] if re.search(r'superhero', node.get('name', ''), re.I) and 'mesh' in node)
    body_index = old['nodes'].index(body)
    body_parent = next((i for i, node in enumerate(old['nodes']) if body_index in node.get('children', [])), None)
    primitive = old['meshes'][body['mesh']]['primitives'][0]
    attrs = primitive['attributes']
    indices = values(primitive['indices']).reshape(-1, 3)
    joint_names = [old['nodes'][node]['name'] for node in old['skins'][body['skin']]['joints']]
    joints, weights = values(attrs['JOINTS_0']), values(attrs['WEIGHTS_0'])
    dominant = joints[np.arange(len(joints)), weights.argmax(axis=1)]
    doc = {'asset': {'version': '2.0', 'generator': 'LINKSHOT anatomical view-hand preparation', 'copyright': 'Quaternius Universal Base Characters Standard, CC0 1.0. Hand topology and original skin maps extracted and resized for first-person use.'},
           'scene': 0, 'scenes': copy.deepcopy(old['scenes']), 'nodes': copy.deepcopy(old['nodes']), 'skins': copy.deepcopy(old['skins']),
           'meshes': [], 'accessors': [], 'bufferViews': [], 'buffers': [], 'materials': copy.deepcopy(old.get('materials', [])), 'textures': copy.deepcopy(old.get('textures', [])), 'samplers': copy.deepcopy(old.get('samplers', [])), 'images': []}
    for node in doc['nodes']:
        node.pop('mesh', None)
        node.pop('skin', None)
    # Eyes and hair textures were packaged with the original full-body file;
    # retain only the material/maps actually referenced by the hands.
    doc['materials'] = [copy.deepcopy(old['materials'][primitive['material']])]
    texture_ids = []

    def material_textures(item, remap=None):
        if isinstance(item, dict):
            if 'index' in item:
                if remap is None:
                    texture_ids.append(item['index'])
                else:
                    item['index'] = remap[item['index']]
            for child in item.values():
                material_textures(child, remap)
        elif isinstance(item, list):
            for child in item:
                material_textures(child, remap)

    material_textures(doc['materials'])
    texture_ids = sorted(set(texture_ids))
    doc['textures'] = [copy.deepcopy(old['textures'][index]) for index in texture_ids]
    material_textures(doc['materials'], {old_id: new_id for new_id, old_id in enumerate(texture_ids)})
    image_ids = sorted({texture['source'] for texture in doc['textures']})
    for texture in doc['textures']:
        texture['source'] = image_ids.index(texture['source'])
    data = bytearray()

    def append(chunk, target=None):
        data.extend(b'\0' * (-len(data) % 4))
        view = {'buffer': 0, 'byteOffset': len(data), 'byteLength': len(chunk)}
        if target:
            view['target'] = target
        doc['bufferViews'].append(view)
        data.extend(chunk)
        return len(doc['bufferViews']) - 1

    def accessor(array, kind, component=5126, target=34962):
        array = np.asarray(array, dtype=DTYPES[component])
        item = {'bufferView': append(array.tobytes(), target), 'componentType': component, 'count': len(array), 'type': kind}
        if kind == 'VEC3':
            item['min'], item['max'] = array.min(axis=0).tolist(), array.max(axis=0).tolist()
        doc['accessors'].append(item)
        return len(doc['accessors']) - 1

    for skin in doc['skins']:
        skin['inverseBindMatrices'] = accessor(values(skin['inverseBindMatrices']), 'MAT4', target=None)

    for side in ['l', 'r']:
        keep = np.array([bool(re.fullmatch(fr'(?:hand|index_\d+|middle_\d+|pinky_\d+|ring_\d+|thumb_\d+)(?:_leaf)?_{side}', joint_names[joint])) for joint in dominant])
        triangles = indices[(keep[indices].sum(axis=1) >= 2)]
        used = np.unique(triangles)
        remap = np.full(len(dominant), -1, dtype=np.int32)
        remap[used] = np.arange(len(used))
        attributes = {}
        for key in ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']:
            original = old['accessors'][attrs[key]]
            attributes[key] = accessor(values(attrs[key])[used], original['type'], original['componentType'])
        mesh = {'name': f'ViewHand_{side.upper()}', 'primitives': [{'attributes': attributes, 'indices': accessor(remap[triangles].reshape(-1, 1), 'SCALAR', 5123, 34963), 'material': 0}]}
        doc['meshes'].append(mesh)
        node = {key: copy.deepcopy(value) for key, value in body.items() if key not in ['children', 'mesh', 'skin', 'name']}
        node.update({'name': mesh['name'], 'mesh': len(doc['meshes']) - 1, 'skin': body['skin']})
        doc['nodes'].append(node)
        if body_parent is None:
            doc['scenes'][doc['scene']]['nodes'].append(len(doc['nodes']) - 1)
        else:
            doc['nodes'][body_parent].setdefault('children', []).append(len(doc['nodes']) - 1)

    # Keep the real skin, normal and roughness maps, not flat skin-coloured
    # finger capsules. Decode/re-encode strips inherited image metadata.
    normal_sources = {item['normalTexture']['index'] for item in doc['materials'] if 'normalTexture' in item}
    normal_images = {doc['textures'][index]['source'] for index in normal_sources}
    for i, image_id in enumerate(image_ids):
        image = old['images'][image_id]
        view = old['bufferViews'][image['bufferView']]
        image_bytes = binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
        picture = Image.open(io.BytesIO(image_bytes))
        picture.thumbnail((512, 512) if i in normal_images else (1024, 1024))
        encoded = io.BytesIO()
        if i in normal_images:
            picture.save(encoded, 'PNG', optimize=True)
            mime = 'image/png'
        else:
            picture.convert('RGB').save(encoded, 'JPEG', quality=92)
            mime = 'image/jpeg'
        doc['images'].append({'bufferView': append(encoded.getvalue()), 'mimeType': mime})

    data.extend(b'\0' * (-len(data) % 4))
    doc['buffers'] = [{'byteLength': len(data)}]
    metadata = json.dumps(doc, separators=(',', ':')).encode()
    metadata += b' ' * (-len(metadata) % 4)
    total = 12 + 8 + len(metadata) + 8 + len(data)
    packed = struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(metadata), 0x4E4F534A) + metadata + struct.pack('<II', len(data), 0x004E4942) + data
    name = f'view-hands-{sex}-v1.glb'
    (MODELS / name).write_bytes(packed)
    files.append({'file': name, 'source': source, 'bytes': len(packed), 'sha256': hashlib.sha256(packed).hexdigest(), 'hands': 2, 'triangles': sum(doc['accessors'][mesh['primitives'][0]['indices']]['count'] // 3 for mesh in doc['meshes'])})
    print(name, len(packed), 'bytes', files[-1]['triangles'], 'triangles')

(MODELS / 'view-hands-manifest.json').write_text(json.dumps({'license': 'CC0-1.0', 'creator': 'Quaternius', 'source': 'Universal Base Characters Standard', 'sourceUrl': 'https://quaternius.com/packs/universalbasecharacters.html', 'processing': 'Anatomical hand topology, original finger rigs and skin/normal maps extracted from the prepared licensed male/female operators; unused body geometry removed, images resized and metadata stripped. Weapon-specific posing, gloves and sleeves are authored at runtime.', 'files': files}, indent=2) + '\n')
