# LINKSHOT asset sources

## Human character anatomy and hairstyle

- Author: Quaternius
- Pack: Universal Base Characters, Standard (free version)
- Source: https://quaternius.com/packs/universalbasecharacters.html
- Download: https://quaternius.itch.io/universal-base-characters
- License: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/
- Files: `models/operator-human-v2.glb`, `models/operator-hair-v2.glb`, `models/operator-female-v3.glb`, `models/operator-hair-female-v3.glb`, `models/operator-hair-female-short-v3.glb`
- Original models: Superhero Male/Female FullBody; SimpleParted, Buns and BuzzedFemale hair, from the free Standard archive.
- Changes: self-contained GLB packaging, higher-resolution resized textures, softened skin contrast and normal shading, refined hair/eye materials, runtime clothing materials, tactical equipment and procedural skeletal posing/IK. Only the free Standard assets are included; no paid Source assets are used.
- Original license: `models/LICENSE-Quaternius.txt`
- `operator-male.png` and `operator-female.png` are actual in-engine renders of those characters wearing the generated clothing materials below, not photographs or standalone image-model portraits. Reproduce them with `scripts/render-characters.mjs`; source/model and material licenses remain applicable.

## Operator clothing materials

- `operator-fabric.png`, `operator-armor.png`, `operator-jacket.png`: generated locally with ComfyUI and Animagine XL 4.0 Opt in the user's image engine, then used on the actual in-game skinned character and equipment, not only on shop cards. The jacket image is cropped to its garment panel before UV mapping.
- Model source and license: https://huggingface.co/cagliostrolab/animagine-xl-4.0 — CreativeML Open RAIL++-M.
- Prompts, seeds and image model provenance: `asset-manifest.json`.
- The image engine generates materials; the 3D anatomical base is the separately licensed Quaternius asset above. No claim is made that a 2D image model generated the 3D rig.

## Recorded firearm sounds

- Author/recordist: Tabasco
- Source: https://opengameart.org/content/gunshot-sounds
- Original archive: https://opengameart.org/sites/default/files/sounds.zip
- License: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/
- Original recordings: CZ-52 pistol, SKS rifle, Mosin Nagant rifle, shotgun.
- Changes: one audited isolated muzzle blast per weapon, spectral noise reduction, filtering, fixed mono resampling, exponential suppression of late echoes/mechanical tails, peak normalization and fades. No random sample or pitch variations are used during gameplay.
- SR–1, AWP and M82 additionally use bass-weighted processing and a deterministic dense diffuse 1.65–2.20 second decay. The tail is processed from the single isolated blast, not another recorded shot or bolt click. Fixed resampling is baked into each file; playback always uses rate 1.
- The 20 gameplay sound profiles are artistic edits of the four listed source recordings; they are not claimed to be original recordings of each named real-world weapon.
- Prepared file list and hashes: `sounds/manifest.json`.
- Reproduction tools: `scripts/prepare-character.py`, `scripts/prepare-audio.py` in the source repository. Downloaded archives and working files are not distributed.

## Procedural boot and kill-confirmation effects

- Original synthesis in `public/sound-design.js`: short dry hard-sole heel/toe clacks, impact/chime kill and multikill confirmations, and a headshot accent.
- These effects are created from deterministic noise and oscillators, not external recordings, downloaded voice packs or a speech API. There are no additional third-party audio assets for these effects.

## Recorded reload foley

- Author/recordist: zer0_sol
- Sources: https://opengameart.org/content/handgun-reload-sound-effect and https://opengameart.org/content/shotgun-reload-sound-effects
- Downloads: https://opengameart.org/sites/default/files/reload.wav and https://opengameart.org/sites/default/files/shotgunsounds.zip
- License for both source packs: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/
- Prepared files: `sounds/reload-*.wav`; credits, editing stages, durations and hashes are in `sounds/reload-manifest.json`.
- Changes: actual magazine/slide/shell/pump foley processed with local ComfyUI input headroom and 3-band EQ, mono resampling, twenty separate weapon-specific edits/timelines, fixed spectral/pitch shaping, fades and peak normalization. These are artistic reload profiles, not claimed recordings of each named real-world weapon. No synthesized beep substitutes or random runtime pitch changes are used.
- Reproduce with `scripts/prepare-reloads.py --engine` in the local engine Python environment. Originals, workflows and intermediate FLACs remain in ignored `artifacts/reload-source/`; runtime and static builds require no engine or external audio service.

Three.js and its glTF/skeleton utilities are by the Three.js authors, under the MIT license. The full notice is included as `LICENSE-three.txt`: https://github.com/mrdoob/three.js/blob/dev/LICENSE.
