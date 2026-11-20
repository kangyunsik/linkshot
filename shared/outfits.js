// Appearance only. Physics, health, weapons and movement never read outfit properties.
export const OPERATOR_RIGS = Object.freeze({
  male: Object.freeze({ model: 'operator-human-v2.glb', hair: 'operator-hair-v2.glb', bodyMesh: 'SuperHero_Male', hands: 'view-hands-male-v1.glb' }),
  female: Object.freeze({ model: 'operator-female-v3.glb', hair: 'operator-hair-female-v3.glb', bodyMesh: 'Superhero_Female', hands: 'view-hands-female-v1.glb' }),
});

export const CHARACTERS = Object.freeze([
  { id: 'male', rig: 'male', name: 'KAEL', label: '카엘', description: '단정한 사이드 파트와 올리브색 기본 전투복.', image: 'operator-male.png', accent: '#b8caac', skinTint: '#fff9f4', hairColor: '#574337' },
  { id: 'female', rig: 'female', name: 'LYRA', label: '라이라', description: '양쪽으로 묶은 헤어와 빈티지 와인색 재킷.', image: 'operator-female.png', accent: '#d9a897', skinTint: '#fff9f4', hairColor: '#47302a', field: Object.freeze({ suit: '#67505a', panel: '#53434f', pants: '#363840', dark: '#26262e', accent: '#ad7b79', cut: 'coach' }) },
  { id: 'nari', rig: 'female', name: 'NARI', label: '나리', description: '옆으로 흐르는 밤색 단발. 슬레이트 재킷에 민트색 봉제선.', image: 'operator-nari.png', accent: '#83d6c4', skinTint: '#f4d3bc', hairColor: '#4e3127', field: Object.freeze({ suit: '#48555d', panel: '#3f4d56', pants: '#353942', dark: '#262c33', accent: '#73bfb1', cut: 'scout' }) },
  { id: 'rhea', rig: 'female', name: 'RHEA', label: '레아', description: '플럼색 포니테일. 크림색 봄버와 라일락 어깨 배색.', image: 'operator-rhea.png', accent: '#c6aedf', skinTint: '#d2a58e', hairColor: '#583850', field: Object.freeze({ suit: '#b3a391', panel: '#826f98', pants: '#34353e', dark: '#302a35', accent: '#b5a0ca', cut: 'bomber' }) },
  { id: 'jin', rig: 'male', name: 'JIN', label: '진', description: '인디고빛 가르마. 코발트 라인을 넣은 차콜 유틸리티 재킷.', image: 'operator-jin.png', accent: '#8baef1', skinTint: '#f9e3d7', hairColor: '#2f3143', field: Object.freeze({ suit: '#3c4352', panel: '#333a49', pants: '#343742', dark: '#242833', accent: '#668bca', cut: 'utility' }) },
].map(Object.freeze));
export const DEFAULT_CHARACTER = 'male';
export const getCharacter = (id) => CHARACTERS.find((character) => character.id === id) || CHARACTERS[0];
export const isCharacterId = (id) => CHARACTERS.some((character) => character.id === id);

export const PREMIUM_OUTFIT_PRICE = 20_000;
export const OUTFITS = Object.freeze([
  { id: 'field', name: 'FIELD ISSUE', label: '필드 이슈', concept: '오퍼레이터 기본 복장', price: 0, image: 'outfit-field.png', suit: '#505b4d', panel: '#455446', pants: '#393e38', dark: '#282f2b', accent: '#b5ae88', cut: 'utility', description: '각 오퍼레이터의 시그니처 재킷과 카고 팬츠가 기본으로 제공됩니다.' },
  { id: 'runner', name: 'NIGHT RUNNER', label: '나이트 러너', concept: '립스톱 정찰 재킷', price: PREMIUM_OUTFIT_PRICE, image: 'outfit-runner.png', suit: '#293c43', panel: '#354d52', pants: '#30383d', dark: '#232d32', accent: '#75ad9f', cut: 'scout', description: '짙은 청록 립스톱과 비스듬한 지퍼. 가볍게 걸치는 정찰 재킷입니다.' },
  // Old identifiers are purchase receipts, not design names. Keep them stable.
  { id: 'hazmat', name: 'DOCKYARD', label: '도크야드', concept: '캔버스 워크 재킷', price: PREMIUM_OUTFIT_PRICE, image: 'outfit-hazmat.png', suit: '#8a6c50', panel: '#6e5540', pants: '#414641', dark: '#34322d', accent: '#c2a276', cut: 'work', gloves: true, description: '워싱한 브라운 캔버스에 이중 봉제선과 각진 플랩 포켓을 더했습니다.' },
  { id: 'orbital', name: 'CITYLINE', label: '시티라인', concept: '도시형 트랙 재킷', price: PREMIUM_OUTFIT_PRICE, image: 'outfit-orbital.png', suit: '#4c6178', panel: '#687e8f', pants: '#353c4b', dark: '#263040', accent: '#a4bbce', cut: 'track', description: '스톰 블루 원단과 더블 라인, 차콜 카고를 조합한 도시형 재킷입니다.' },
  { id: 'retrobot', name: 'HERITAGE', label: '헤리티지', concept: '빈티지 코치 재킷', price: PREMIUM_OUTFIT_PRICE, image: 'outfit-retrobot.png', suit: '#724c49', panel: '#573e41', pants: '#3b3538', dark: '#2e282a', accent: '#c39576', cut: 'coach', description: '브릭 와인색 원단에 낮은 칼라와 무광 스냅을 단 빈티지 코치 재킷입니다.' },
].map(Object.freeze));

export const DEFAULT_OUTFIT = 'field';
export const getOutfit = (id) => OUTFITS.find((outfit) => outfit.id === id) || OUTFITS[0];
export const isOutfitId = (id) => OUTFITS.some((outfit) => outfit.id === id);
export const operatorPalette = (outfit, character) => outfit.id === DEFAULT_OUTFIT ? character.field || outfit : outfit;
