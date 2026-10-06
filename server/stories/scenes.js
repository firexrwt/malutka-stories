import { CAST } from './canon.js';
import { initialDirection } from '../../public/games/stories/director.js';

const scenes = [
  {
    id: 'meeting', title: 'Арбуз. Его опять не звали', location: 'Переговорная',
    cast: ['mzberg', 'ginkin_nm', 'arbuz'],
    intro: 'Майзенберг собрал совещание. Гинкин уже выбирает, какой момент вырезать из контекста. Дверь открывается: Арбуз сам прикатился. Ты отвечаешь за повестку. Начать встречу пока не удалось.',
    goal: 'Совещание, на которое никто не приглашал Арбуза. Ты ведёшь разговор и решаешь, во что он превратится.',
    objects: [{ id: 'agenda', name: 'Повестка', place: 'table', portable: true }],
    facts: { agenda: false, arbuz: 'uninvited', chair: null, support: [], recording: false },
    hints: ['Читаю повестку', 'Предлагаю Арбуза председателем', 'Прошу Гинкина поддержать Арбуза'],
  },
  {
    id: 'stream', title: 'Пять минут до совместного стрима', location: 'Студия',
    cast: ['pihta_stream', 'pr1nc3x3', 'firexrwt'],
    intro: 'До совместного стрима пять минут. Пихта смотрит на индикатор звука. Принц объявляет, что это индикатор просто не оценил его голос. Файрекс предлагает начать с проводов. На столе запасной микрофон и кабель; основной микрофон сломан.',
    goal: 'Звук сломан перед эфиром. Можно чинить, спорить с Принцем или превратить аварию в новую историю.',
    objects: [
      { id: 'spare_mic', name: 'Запасной микрофон', place: 'table', portable: true },
      { id: 'cable', name: 'Кабель', place: 'table', portable: true },
      { id: 'broken_mic', name: 'Основной микрофон', place: 'channel', portable: false },
      { id: 'console', name: 'Пульт', place: 'desk', portable: false },
    ],
    facts: { diagnosed: false, mic: 'broken_mic', cable: false, repaired: false, tested: false, live: false },
    hints: ['Проверяю основной микрофон', 'Беру запасной микрофон и подключаю вместо сломанного', 'Прошу Файрекса подключить кабель'],
  },
  {
    id: 'board', title: 'Внеочередной совет директоров', location: 'Зал совета',
    cast: ['pr1nc3x3', 'mzberg', 'danyashepard'],
    intro: 'Принц принёс поправку: 80% голосов председателю, а председатель - внезапно Принц. Майзенберг стучит по столу повесткой. Шепард просит первоисточник. Ты секретарь: протокол и исходный реестр лежат перед тобой. Все цифры в этой сцене вымышленные.',
    goal: 'Принц требует контроль над компанией. Документы, разговоры и последствия остаются за тобой.',
    objects: [
      { id: 'amendment', name: 'Подозрительная поправка', place: 'table', portable: true },
      { id: 'registry', name: 'Исходный реестр', place: 'table', portable: true },
    ],
    facts: { read: false, verified: false, proposal: 'control', support: [], shares: { mzberg: 40, pr1nc3x3: 30, danyashepard: 30 } },
    hints: ['Читаю поправку', 'Показываю Шепарду исходный реестр', 'Предлагаю Принцу титул вместо акций'],
  },
];

export const SCENES = new Map(scenes.map(scene => [scene.id, Object.freeze(scene)]));
export const catalog = () => scenes.map(({ id, title, location, cast, goal, intro, hints }) =>
  ({ id, title, location, goal, intro, hints, cast: cast.map(id => CAST.get(id)) }));

export function startScene(id, runId) {
  const scene = SCENES.get(id);
  if (!scene) return null;
  return { id: runId, seed: runId, scene: id, turn: 0, version: 0, guests: [], status: 'active', goalStatus: 'pending', outcome: null, memory: '',
    facts: structuredClone(scene.facts), objects: structuredClone(scene.objects),
    history: [{ player: '', text: scene.intro, reactions: [], visual: initialDirection(scene), events: [], clarification: '' }], receipts: [] };
}
