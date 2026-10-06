import { SCENES } from './scenes.js';
import { validPlan } from './protocol.js';
import { streamRule } from './rules/stream.js';
import { meetingRule } from './rules/meeting.js';
import { boardRule } from './rules/board.js';
import { NPC } from '../../public/games/stories/art-library.js';
import { runCast, secondary, canIntroduce } from './participants.js';

const rules = new Map([['stream', streamRule], ['meeting', meetingRule], ['board', boardRule]]);
export function execute(run, rawPlan) {
  const plan = validPlan(rawPlan);
  if (!plan) throw new Error('invalid_plan');
  const next = structuredClone(run), events = [];
  if (next.status !== 'active') throw new Error('finished');
  if (plan.clarification) return { next, events, clarification: plan.clarification };
  for (const action of plan.actions) {
    if (next.status !== 'active') { events.push('Сцена завершена. Следующее действие не выполнено.'); continue; }
    if (action.by !== 'player' && !runCast(next).some(m => m.id === action.by)) { events.push('Отказ: исполнитель отсутствует в сцене.'); continue; }
    if (secondary(next, action.by) && (action.type !== 'say' || action.actor !== action.by)) { events.push('Второстепенный участник может говорить только за себя; оборудование, акции и голоса не изменились.'); continue; }
    if (action.type === 'introduce') {
      if (!canIntroduce(next, action.actor)) events.push('Этот новый участник не может войти: доступно не более двух второстепенных персонажей.');
      else { next.guests.push(action.actor); events.push(`В сцену вошёл вымышленный участник: ${NPC.get(action.actor).name}. Предметы и оборудование не изменились.`); }
      continue;
    }
    if (action.actor && !runCast(next).some(m => m.id === action.actor)) { events.push('Отказ: такого участника в сцене нет.'); continue; }
    if (action.actor && secondary(next, action.actor) && action.type !== 'say') { events.push('Второстепенный участник может говорить, но не распоряжается оборудованием, акциями или голосами.'); continue; }
    const object = action.target && next.objects.find(o => o.id === action.target);
    if (action.target && !object) { events.push('Отказ: такого предмета в сцене нет. Инвентарь не изменился.'); continue; }
    if (action.type === 'take') {
      if (!object.portable || object.place !== 'table') events.push('Отказ: предмет нельзя взять со стола.');
      else { object.place = 'inventory'; events.push(`Предмет «${object.name}» теперь в инвентаре.`); }
      continue;
    }
    if (action.type === 'say') { events.push('Реплика произнесена. Сама по себе она не меняет предметы, голоса или оборудование.'); continue; }
    if (action.type === 'finish') { events.push('Текущий эпизод завершён. История продолжается с его последствиями.'); continue; }
    const result = rules.get(next.scene)(next, action);
    events.push(result ?? (action.type === 'inspect' ? `${object.name}: ${object.place === 'inventory' ? 'в инвентаре' : 'в сцене'}.` : 'Отказ: это действие не поддерживается в данной сцене.'));
  }
  next.turn++;
  return { next, events, clarification: '' };
}

export function view(run) {
  if (!run) return null;
  const { receipts, ...data } = run;
  return { ...data, cast: runCast(run), goal: SCENES.get(run.scene).goal };
}
