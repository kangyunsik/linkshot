// Appearance only. Physics, health, weapons and movement never read outfit properties.
export const CHARACTERS = Object.freeze([
  { id: 'male', name: 'KAEL', label: '남성 오퍼레이터', description: '차분한 눈매와 단정한 사이드 파트의 성인 전투원', image: 'operator-male.png', model: 'operator-human-v2.glb', hair: 'operator-hair-v2.glb', bodyMesh: 'SuperHero_Male' },
  { id: 'female', name: 'LYRA', label: '여성 오퍼레이터', description: '또렷한 눈매와 깔끔하게 묶은 헤어의 성인 전투원', image: 'operator-female.png', model: 'operator-female-v3.glb', hair: 'operator-hair-female-v3.glb', helmetHair: 'operator-hair-female-short-v3.glb', bodyMesh: 'Superhero_Female' },
].map(Object.freeze));
export const DEFAULT_CHARACTER = 'male';
export const getCharacter = (id) => CHARACTERS.find((character) => character.id === id) || CHARACTERS[0];
export const isCharacterId = (id) => CHARACTERS.some((character) => character.id === id);

export const OUTFITS = Object.freeze([
  { id: 'field', name: 'FIELD OPERATIVE', label: '기본 오퍼레이터', concept: '현장 전투원', price: 0, image: 'outfit-field.png', pattern: null, suit: '#53645d', armor: '#65746f', dark: '#243139', visor: '#ffc08a', description: '처음부터 사용할 수 있는 현장형 전투복. 익숙하고 단정한 표준 장비입니다.' },
  { id: 'runner', name: 'VOID RUNNER', label: '보이드 러너', concept: '후드 정찰병', price: 250, image: 'outfit-runner.png', pattern: 'skin-circuit.png', suit: '#34464e', armor: '#47636b', dark: '#192831', visor: '#8affdf', description: '얼굴이 드러나는 어두운 후드와 민트색 장비를 갖춘 인간 정찰병. 기동력 수치는 기본 외형과 같습니다.' },
  { id: 'hazmat', name: 'HAZARD UNIT', label: '해저드 유닛', concept: '산업 방호복', price: 500, image: 'outfit-hazmat.png', pattern: 'outfit-panels.png', suit: '#9c863d', armor: '#d2b656', dark: '#39433c', visor: '#a9e3d9', description: '호흡 필터와 보호 패널이 있는 노란 방호복. 방어력이나 체력 보너스는 없습니다.' },
  { id: 'orbital', name: 'ORBITAL GUARD', label: '오비탈 가드', concept: '우주 전투복', price: 900, image: 'outfit-orbital.png', pattern: 'outfit-panels.png', suit: '#8dabb8', armor: '#dae4e4', dark: '#40576c', visor: '#84dfff', description: '둥근 헬멧과 흰색 장갑판으로 구성된 궤도 수비대 전투복. 피격 범위는 기본 외형과 동일합니다.' },
  { id: 'retrobot', name: 'RETRO SIGNAL', label: '레트로 시그널', concept: '레트로 전투복', price: 1400, image: 'outfit-retrobot.png', pattern: 'outfit-panels.png', suit: '#715c50', armor: '#c77e53', dark: '#2c3e43', visor: '#a3ffe5', description: '주황색 장갑과 녹색 표시등이 있는 복고풍 인간형 전투복. 모든 차이는 외형에만 적용됩니다.' },
].map(Object.freeze));

export const DEFAULT_OUTFIT = 'field';
export const getOutfit = (id) => OUTFITS.find((outfit) => outfit.id === id) || OUTFITS[0];
export const isOutfitId = (id) => OUTFITS.some((outfit) => outfit.id === id);
