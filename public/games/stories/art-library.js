// One static art library shared by director validation, narrator and renderer.
export const VARIANTS = ['neutral', 'doubt', 'confident', 'panic', 'amused', 'speaking'];
export const BACKGROUNDS = ['studio', 'meeting', 'board', 'hallway'];
export const NPC = new Map([
  ['generic_courier', { name: 'КУРЬЕР', trait: 'Вымышленный курьер: торопится, воспринимает хаос как обычный рабочий день.' }],
  ['generic_admin', { name: 'АДМИНИСТРАТОР', trait: 'Вымышленная администратор: спокойно требует заявку даже на абсурдные просьбы.' }],
  ['generic_security', { name: 'ОХРАННИК', trait: 'Вымышленный охранник: слишком серьёзно относится к пропускам и порядку.' }],
  ['generic_reporter', { name: 'РЕПОРТЁР', trait: 'Вымышленная репортёр: задаёт неудобные вопросы и ищет сенсацию.' }],
  ['generic_producer', { name: 'ПРОДЮСЕР', trait: 'Вымышленный продюсер: продаёт любую аварию как смелую творческую идею.' }],
  ['generic_technician', { name: 'ДЕЖУРНЫЙ ТЕХНИК', trait: 'Вымышленная техник: уточняет симптомы, иронизирует над поспешными выводами.' }],
]);
export const APPEARANCES = new Map([
  ['generic_courier', { presentation: 'male', description: 'Молодой мужчина, тёмные волосы, оранжевая куртка.' }],
  ['generic_admin', { presentation: 'female', description: 'Женщина с каре и очками, жилет и светлая рубашка.' }],
  ['generic_security', { presentation: 'male', description: 'Крепкий мужчина, строгая одежда охранника.' }],
  ['generic_reporter', { presentation: 'female', description: 'Молодая женщина, образ любопытной репортёрки.' }],
  ['generic_producer', { presentation: 'male', description: 'Мужчина, выразительный образ продюсера.' }],
  ['generic_technician', { presentation: 'female', description: 'Женщина, рабочий образ техника.' }],
]);
const main = ['mzberg', 'arbuz', 'ginkin_nm', 'pihta_stream', 'pr1nc3x3', 'firexrwt', 'danyashepard'];
export const ART_BANK = new Map([...main, ...NPC.keys()].map(id => {
  const variants = NPC.has(id) ? ['neutral', 'doubt', 'speaking'] : VARIANTS;
  return [id, { variants, portraits: Object.fromEntries(variants.map(variant => [variant, `/games/stories/assets/${id}-${variant}-v2.webp`])) }];
}));
export const backgroundAsset = id => BACKGROUNDS.includes(id) ? `/games/stories/assets/background-${id}-v1.webp` : null;
