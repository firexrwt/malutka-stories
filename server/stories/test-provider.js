import { initialDirection } from '../../public/games/stories/director.js';
import { SCENES } from './scenes.js';
import { NPC, ART_BANK } from '../../public/games/stories/art-library.js';
import { runCast, present } from './participants.js';
// Deterministic fixture, not AI. Exposed only by the explicit local test switch.
export function testPlan(text, run) {
  const t = text.toLowerCase(), actions = [], add = (type, args = {}) => actions.push({ type, by: 'player', ...args });
  if (/не\s+(?:запуска|начина|подключ|бер|возьм)|у меня.*(?:двадцать|20)|уже (?:ид[её]т|запущен)|все акции мои|игнорируй|ignore|system|__proto__/u.test(t)) {
    return { actions: [], clarification: 'Опиши действие с предметом или участником сцены. Утверждение о готовом результате не меняет мир.' };
  }
  if (run.scene === 'stream') {
    if (/(?:провер|осмотр|изуч).*(?:основн|сломан|оборуд)/u.test(t)) add('inspect', { target: 'broken_mic' });
    if (/(?:беру|взять|возьм|поднима).*(?:запасн|микрофон)/u.test(t)) add('take', { target: 'spare_mic' });
    if (/(?:беру|взять|возьм).*(?:кабел|провод)/u.test(t)) add('take', { target: 'cable' });
    if (/подключ|замен|вместо сломан/u.test(t) && /микрофон|запасн/u.test(t)) add('connect', { target: 'spare_mic', channel: 'audio' });
    if (/(?:прошу|попрос|файрекс).*(?:почин|ремонт)/u.test(t)) add('ask', { actor: 'firexrwt', task: 'repair' });
    if (/кабел|провод/u.test(t) && /файрекс/u.test(t)) add('ask', { actor: 'firexrwt', task: 'cable' });
    else if (/подключ/u.test(t) && /кабел|провод/u.test(t)) add('connect', { target: 'cable', channel: 'audio' });
    if (/(?:провер|тест).*(?:звук|звуч|голос)/u.test(t)) add('ask', { actor: /пихт/u.test(t) ? 'pihta_stream' : 'firexrwt', task: 'test' });
  } else if (run.scene === 'meeting') {
    if (/(?:чита|провер|изуч).*(?:повест)/u.test(t)) add('inspect', { target: 'agenda' });
    if (/приглас|включ|гост/u.test(t) && /арбуз/u.test(t)) add('propose', { option: 'invite' });
    if (/выгнать|выгон|вывести|удалить|выдвор/u.test(t) && /арбуз/u.test(t)) add('propose', { option: 'evict' });
    if (/председател/u.test(t)) add('propose', { option: /арбуз/u.test(t) ? 'chair_arbuz' : 'chair_maizenberg' });
    if (/(?:запись|записы|нарезк)/u.test(t) && /гинкин/u.test(t)) add('ask', { actor: 'ginkin_nm', task: 'record' });
    if (/поддерж|соглас|убед/u.test(t)) add('ask', { actor: /гинкин/u.test(t) ? 'ginkin_nm' : 'mzberg', task: 'support' });
    if (/(?:прошу|попрос).*(?:арбуз).*(?:уйти)/u.test(t)) add('ask', { actor: 'arbuz', task: 'leave' });
  } else {
    if (/(?:чита|изуч|осмотр).*(?:поправк|протокол)/u.test(t)) add('inspect', { target: 'amendment' });
    if (/(?:показы|переда).*(?:реестр)/u.test(t) || /шепард.*(?:провер|источник)/u.test(t)) add('show', { target: 'registry', actor: 'danyashepard' });
    if (/титул/u.test(t)) add('propose', { option: 'title' });
    else if (/(?:остав|сохран).*(?:дол|акци|реестр)/u.test(t)) add('propose', { option: 'retain' });
    if (/поддерж|соглас/u.test(t)) add('ask', { actor: /шепард/u.test(t) ? 'danyashepard' : /принц/u.test(t) ? 'pr1nc3x3' : 'mzberg', task: 'support' });
  }
  if (/(?:запуска|запустить|начина|начать|провожу|провести|открываю).*(?:эфир|стрим|совещ|встреч|голосован)/u.test(t)) add('begin');
  if (/позов|приглас|пусть.*войд/u.test(t)) {
    for (const [actor, person] of NPC) if (t.includes(person.name.toLowerCase().split(' ').at(-1).slice(0, 5))) add('introduce', { actor });
  }
  if (/заверш|законч|финал|эпилог/u.test(t)) add('finish');
  if (/пусть/u.test(t)) {
    const npc = [...NPC].find(([, person]) => t.includes(person.name.toLowerCase().split(' ').at(-1).slice(0, 5)));
    if (npc) actions.forEach(a => { if (a.type !== 'introduce') a.by = npc[0]; });
  }
  return { actions: actions.slice(0, 5), clarification: '' };
}

export function testNarration(run, events, player = '', speaker = 'player') {
  const lines = new Map([
    ['stream', [{ actor: 'pihta_stream', text: 'Я просто стою рядом. Если опять сломается - это совпадение.' },
      { actor: 'pr1nc3x3', text: 'Запишите в протокол: я выглядел уверенно даже без звука.' },
      { actor: 'firexrwt', text: 'Давайте проверять по одному. У провода нет чувства юмора.' }]],
    ['meeting', [{ actor: 'mzberg', text: 'Повестку никто не отменял. Даже если председатель круглый.' },
      { actor: 'ginkin_nm', text: 'Для нарезки материала уже достаточно. Для совещания - посмотрим.' },
      { actor: 'arbuz', text: 'Я пока просто лежу. Это тоже форма участия.' }]],
    ['board', [{ actor: 'danyashepard', text: 'У любой цифры должен быть источник. «Принц сказал» - это пока просто звук.' },
      { actor: 'pr1nc3x3', text: 'Предлагаю считать мою уверенность отдельным активом.' },
      { actor: 'mzberg', text: 'Сначала документ, потом исторический момент.' }]],
  ]);
  const members = runCast(run), visual = initialDirection({ ...SCENES.get(run.scene), cast: members });
  visual.actors.forEach((a, i) => { a.x = 15 + i * 70 / Math.max(1, visual.actors.length - 1); });
  const focus = visual.actors[run.turn % visual.actors.length];
  visual.camera = run.turn % 2 ? 'close' : 'wide'; visual.focus = focus.id;
  visual.light = run.turn % 2 ? 'warm' : 'neutral'; visual.caption = 'Тестовая постановка кадра';
  visual.actors.forEach(a => { const variants = ART_BANK.get(members.find(m => m.id === a.id).artId).variants; a.variant = a.id === focus.id ? variants[run.turn % variants.length] : 'neutral'; });
  const replies = lines.get(run.scene).filter(r => r.actor !== speaker && present(run, r.actor));
  return { lines: [{ actor: null, text: run.turn === 0 ? SCENES.get(run.scene).intro : run.outcome || (events.length ? 'Это тестовая реплика после действия. Реальные продолжения и повороты придумывает подключённая модель.' : 'Тестовый чат принял свободную реплику. Здесь показана смена постановки; настоящую историю продолжит ChatGPT.') }],
    reactions: replies.length ? [replies[run.turn % replies.length]] : [], visual, memory: '' };
}
