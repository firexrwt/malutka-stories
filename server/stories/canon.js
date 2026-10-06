import { ROSTER } from './roster.js';
import { NPC, ART_BANK } from '../../public/games/stories/art-library.js';

// Immutable SFW projection. Never send dossier text to the model.
const traits = new Map([
  ['mzberg', 'Основатель. Требует повестку и порядок, ворчит, но слышит аргументы.'],
  ['arbuz', 'Незваный Арбуз сам прикатился. Невозмутимо претендует на место за столом.'],
  ['ginkin_nm', 'Нарезчик Майзенберга. Ищет удачный кадр, сухо комментирует хаос.'],
  ['pihta_stream', 'Пихта - парень, он. Белый кот. Речь о себе и описания только в мужском роде: «я думал», «он сказал». Шутит о поломках на совместном стриме, готов помогать.'],
  ['pr1nc3x3', 'Принц Малюток. Торгуется за влияние и титулы, уверенно спорит.'],
  ['firexrwt', 'Пишет код. Технарь: просит сначала проверить кабель, язвит про баги.'],
  ['danyashepard', 'Проверяет источники. Не принимает цифры без документа.'],
]);

export const CAST = new Map(ROSTER.flatMap(member => {
  const id = member.id;
  return traits.has(id) ? [[id, Object.freeze({ id, name: member.name,
    accent: member.accent, sprite: ART_BANK.get(id).portraits.neutral, variants: ART_BANK.get(id).variants,
    trait: traits.get(id) })]] : [];
}));
for (const [id, role] of NPC) CAST.set(id, Object.freeze({ id, ...role, accent: '#fff4bd', sprite: ART_BANK.get(id).portraits.neutral, variants: ART_BANK.get(id).variants }));
