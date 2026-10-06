import { renderStage, portrait } from './stage.js';
import { appendChatText } from './chat-text.js';
const element = (tag, text, className) => {
  const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node;
};
export function renderPicker(scenes, playable, onStart) {
  const list = document.querySelector('#scene-list'); list.replaceChildren();
  scenes.forEach((scene, i) => {
    const card = element('article', '', 'scene-card'), cast = element('div', '', 'cast-preview');
    scene.cast.forEach(m => cast.append(portrait(m.id)));
    const button = element('button', 'НАЧАТЬ ИСТОРИЮ ↗'); button.type = 'button'; button.disabled = !playable;
    button.addEventListener('click', () => onStart(scene.id));
    card.append(element('div', `0${i + 1} / ${scene.location}`, 'eyebrow'), cast, element('h3', scene.title), element('p', scene.goal), button); list.append(card);
  });
}

export function renderRun(run, scene, onHint, speaker = 'player', onSelect) {
  document.querySelector('#scene-title').textContent = scene.title;
  document.querySelector('#location').textContent = scene.location;
  document.querySelector('#goal').textContent = run.goal;
  document.querySelector('#turns').textContent = `СООБЩЕНИЯ ${run.version}`;
  renderStage(run, scene, speaker, onSelect);
  const facts = document.querySelector('#facts'); facts.replaceChildren();
  let lines;
  const f = run.facts, name = id => (run.cast || scene.cast).find(m => m.id === id)?.name || 'не выбран';
  if (run.scene === 'stream') lines = [f.diagnosed ? 'Поломка найдена' : 'Поломка не проверена',
    f.mic === 'spare_mic' ? 'Канал: запасной микрофон' : `Канал: основной микрофон (${f.repaired ? 'исправен' : 'сломан'})`,
    `Кабель: ${f.cable ? 'подключён' : 'не подключён'}`, `Звук: ${f.tested ? 'проверен' : 'не проверен'}`, `Эфир: ${f.live ? 'идёт' : 'не запущен'}`];
  else if (run.scene === 'meeting') lines = [`Повестка: ${f.agenda ? 'прочитана' : 'не прочитана'}`,
    `Арбуз: ${new Map([['uninvited', 'не приглашён'], ['guest', 'официальный гость'], ['outside', 'за дверью']]).get(f.arbuz)}`,
    `Кандидат: ${name(f.chair)}`, `Поддержка: ${f.support.length} / 2`, `Запись: ${f.recording ? 'ведётся' : 'не начата'}`];
  else lines = [`Поправка: ${f.read ? 'прочитана' : 'не прочитана'}`, `Источник: ${f.verified ? 'проверен' : 'не проверен'}`,
    `Предложение: ${new Map([['control', 'контроль Принцу'], ['retain', 'сохранить доли'], ['title', 'титул вместо акций']]).get(f.proposal)}`,
    'Доли: Майзенберг 40%, Принц 30%, Шепард 30%'];
  lines.forEach(line => facts.append(element('li', line)));
  const objects = document.querySelector('#objects'); objects.replaceChildren();
  const places = new Map([['table', 'на столе'], ['inventory', 'у тебя'], ['channel', 'у звукового канала'], ['desk', 'у пульта']]);
  run.objects.forEach(o => objects.append(element('li', `${o.name}: ${places.get(o.place) || 'в сцене'}`)));
  const history = document.querySelector('#history');
  const atBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 80;
  if (history.dataset.run !== run.id) { history.replaceChildren(); history.dataset.run = run.id; }
  const kept = new Set();
  run.history.forEach((turn, i) => {
    const key = String(run.version - run.history.length + 1 + i); kept.add(key);
    if ([...history.children].some(child => child.dataset.key === key)) return;
    const entry = element('article', '', 'entry'); entry.dataset.key = key; entry.setAttribute('aria-atomic', 'true');
    if (turn.player) { const line = element('p', '', 'player-line'); line.append(element('strong', `${!turn.speaker || turn.speaker === 'player' ? 'ТЫ' : name(turn.speaker)}: `)); appendChatText(line, turn.player); entry.append(line); }
    const prose = element('p'); appendChatText(prose, turn.text, (run.cast || scene.cast).map(m => m.name)); entry.append(prose);
    const reactions = element('div', '', 'reactions');
    turn.reactions.forEach(r => { const line = element('div'); line.append(element('strong', `${name(r.actor)}: `)); appendChatText(line, r.text); reactions.append(line); });
    entry.append(reactions);
    if (turn.events.length) { const detail = element('details', '', 'confirmed'); detail.append(element('summary', 'Подтверждённые действия')); const events = element('ul', '', 'events'); turn.events.forEach(e => events.append(element('li', e))); detail.append(events); entry.append(detail); }
    if (turn.clarification) entry.append(element('p', turn.clarification, 'clarification'));
    history.append(entry);
  });
  for (const child of [...history.children]) if (!kept.has(child.dataset.key)) child.remove();
  if (atBottom) history.scrollTop = history.scrollHeight;
  document.querySelector('#outcome').hidden = run.status === 'active';
  document.querySelector('#outcome-text').textContent = run.status === 'finished' ? 'Эпилог - в последнем сообщении рассказчика.' : '';
  document.querySelector('#action-form').hidden = run.status !== 'active';
  const hints = document.querySelector('#hints'); hints.replaceChildren();
  scene.hints.forEach(hint => { const button = element('button', hint); button.type = 'button'; button.addEventListener('click', () => onHint(hint)); hints.append(button); });
  const last = run.history.at(-1);
  document.querySelector('#trace-text').textContent = JSON.stringify({ input: last.player, speaker: last.speaker || 'player', proposed: last.actions || [],
    verified: last.events, direction: last.visual, clarification: last.clarification,
    state: { facts: run.facts, objects: run.objects }, version: run.version }, null, 2);
}
