import { createApi } from './api.js';
import { renderPicker, renderRun } from './render.js';
import { createCastControls } from './cast-controls.js';
import { readPending, savePending as persistPending, turnRequest } from './recovery.js';
import { placeFeedback, showFeedbackError, showLatestReply } from './feedback.js';

const $ = id => document.getElementById(id), api = createApi();
let session = null, busy = false, picking = true, pending = null;
try { pending = readPending(sessionStorage); } catch { /* Browser storage is optional. */ }
const roles = createCastControls({ onSelect: () => { render(); $('action').focus(); }, onAdd: addCharacter });

function savePending(value) {
  pending = value;
  try { persistPending(sessionStorage, value); } catch { /* Optional recovery only. */ }
}
const playable = () => session?.mode === 'test' || (session?.mode === 'chatgpt' && session.account?.planAllowed && !!session.model);
function controls() {
  placeFeedback(document);
  $('play').setAttribute('aria-busy', String(busy));
  for (const node of document.querySelectorAll('button, select, textarea, input')) node.disabled = busy;
  if (!playable()) {
    for (const node of document.querySelectorAll('.scene-card button, #action-form button, #action')) node.disabled = true;
  }
  $('submit').disabled ||= pending?.kind === 'character';
  $('submit').textContent = busy ? 'ОБДУМЫВАЕМ…' : pending?.kind === 'turn' ? 'ПОВТОРИТЬ ХОД ↗' : 'ПРОДОЛЖИТЬ ↗';
  roles.block(busy || !playable() || session?.run?.status !== 'active', pending?.kind);
  $('character-name').required = $('character-mode').value === 'custom' && !(pending?.kind === 'character' && pending.selection.mode === 'random');
  if (session?.run?.cast.length >= (session?.maxCast || 8)) $('character-add').disabled = $('character-random').disabled = true;
}
function showError(error) { showFeedbackError(document, error); }
async function task(work, waiting = 'Подключаемся…') {
  if (busy) return;
  const priorFocus = document.activeElement;
  busy = true; $('error').hidden = true; $('status').textContent = waiting; controls();
  let focus;
  try { focus = await work(); } catch (error) { showError(error); $('status').textContent = ''; }
  finally { busy = false; controls(); }
  (focus || priorFocus)?.focus();
}
function render() {
  $('local-help').hidden = session.mode !== 'unavailable';
  $('auth').hidden = session.mode !== 'chatgpt';
  $('mode').textContent = session.mode === 'test' ? 'ТЕСТОВЫЙ РЕЖИМ. Модель не подключена: действия разбираются по ограниченным правилам, реплики заранее написаны.' :
    session.mode === 'chatgpt' ? 'Локальная демка. Войди со своим аккаунтом ChatGPT и отдельно разреши запросы по подписке.' : 'На общем сайте вход через ChatGPT пока недоступен. Демка работает локально.';
  if (session.mode === 'chatgpt') {
    if (session.account?.planAllowed) $('mode').textContent = session.model ?
      'ChatGPT подключён. Выбери завязку и начни историю.' : 'Вход выполнен. Для запуска историй нужно загрузить модели.';
    $('account').textContent = session.account ? `Аккаунт: ${session.account.email || 'ChatGPT'}. ${session.account.planAllowed ? 'Использование подписки разрешено.' : 'Запросы по подписке не разрешены.'}` : 'Вход ещё не выполнен.';
    $('logout').hidden = !session.account;
    $('consent').checked = !!session.account?.planAllowed;
    $('model-label').hidden = !session.models?.length;
    $('models-retry').hidden = !session.account?.planAllowed;
    const select = $('model-select'); select.replaceChildren();
    (session.models || []).forEach(model => { const option = document.createElement('option'); option.value = model.slug; option.textContent = model.name; select.append(option); });
    select.value = session.model || '';
  }
  renderPicker(session.scenes, playable(), start);
  const run = session.run;
  $('picker').hidden = !!run && !picking;
  $('play').hidden = !run || picking;
  if (run && !picking) {
    roles.render(session, pending?.kind === 'turn' ? pending.speaker : null);
    renderRun(run, session.scenes.find(s => s.id === run.scene), text => { if (pending?.kind === 'turn') savePending(null); $('action').value = text; controls(); $('action').focus(); }, roles.speaker, roles.select);
    $('cast-editor').hidden = run.status !== 'active';
  }
  controls();
}
async function load() {
  session = await api.request('session');
  picking = !session.run;
  if (pending && pending.runId !== session.run?.id) savePending(null);
  if (pending?.kind === 'turn') $('action').value = pending.text;
  render();
  if (pending?.kind === 'turn' && session.run) roles.select(pending.speaker);
  if (pending?.kind === 'character') roles.restore(pending.selection);
  if (session.mode === 'chatgpt' && session.account?.planAllowed && !session.models.length) {
    try { session = await api.request('models', {}); render(); } catch (error) { showError(error); }
  }
  $('status').textContent = '';
}
function start(scene) {
  task(async () => {
    session = await api.request('start', { scene }); savePending(null); picking = false; $('action').value = '';
    render(); showLatestReply(document); $('status').textContent = 'История началась.'; return $('scene-title');
  }, 'Рассказчик придумывает завязку и ставит первый кадр…');
}
$('action-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!session?.run || !playable()) return;
  task(async () => {
    const text = $('action').value.trim();
    if (!text) throw new Error('Опиши своё действие.');
    savePending(turnRequest(pending, text, session.run, roles.speaker, () => crypto.randomUUID()));
    try {
      session = await api.request('turn', pending); savePending(null); $('action').value = ''; render(); showLatestReply(document);
      const last = session.run.history.at(-1);
      $('status').textContent = last.clarification || session.run.outcome || 'Рассказчик ответил. Кадр обновлён.';
      return session.run.status === 'active' ? $('action') : $('restart');
    } catch (error) {
      if (['unsafe', 'version', 'run', 'finished', 'input', 'idempotency', 'speaker'].includes(error.code)) {
        savePending(null);
        if (['version', 'speaker'].includes(error.code)) { session = await api.request('session'); render(); }
      }
      throw error;
    }
  }, session.mode === 'test' ? 'Тестовое продолжение…' : 'ChatGPT продолжает историю и ставит кадр. Это может занять до двух минут…');
});
$('action').addEventListener('input', () => {
  if (pending?.kind === 'turn' && $('action').value.trim() !== pending.text) { savePending(null); controls(); }
});
function addCharacter(selection) {
  if (!session?.run || !playable()) return;
  task(async () => {
    if (pending?.kind !== 'character') savePending({ kind: 'character', selection, runId: session.run.id, version: session.run.version, requestId: crypto.randomUUID() });
    try {
      session = await api.request('characters', pending); savePending(null); render(); showLatestReply(document);
      roles.select(session.addedActor); $('cast-editor').open = false;
      $('status').textContent = session.run.outcome || 'Персонаж вошёл в сцену. Теперь пишешь от его лица.';
      return session.run.status === 'active' ? $('action') : $('restart');
    } catch (error) {
      if (['unsafe', 'version', 'run', 'finished', 'character_input', 'character_duplicate', 'cast_limit', 'idempotency'].includes(error.code)) {
        savePending(null);
        if (error.code === 'version') { session = await api.request('session'); render(); }
      }
      throw error;
    }
  }, selection.mode === 'ready' ? 'Добавляем героя в сцену…' : session.mode === 'test' ? 'Создаём тестового персонажа…' : 'ChatGPT придумывает персонажа и подбирает внешность…');
}
$('new').addEventListener('click', () => { picking = true; savePending(null); render(); $('choose-title').scrollIntoView({ block: 'start' }); document.querySelector('.scene-card button')?.focus(); });
$('restart').addEventListener('click', () => start(session.run.scene));
$('signin').addEventListener('click', () => task(async () => {
  const result = await api.request('auth/start', { usePlan: $('consent').checked });
  const url = new URL(result.url);
  if (url.origin !== 'https://auth.openai.com' || url.pathname !== '/api/accounts/authorize') throw new Error('Неподтверждённый адрес входа.');
  location.assign(url.href);
}, 'Открываем официальный вход ChatGPT…'));
$('logout').addEventListener('click', () => task(async () => {
  session = await api.request('logout', {}); savePending(null); picking = true; render();
  $('status').textContent = session.revocationWarning ? 'Локальный вход завершён. Отзыв доступа в ChatGPT не подтверждён; проверь подключённые приложения в аккаунте.' : 'Вход завершён, локальное прохождение очищено.';
}));
$('models-retry').addEventListener('click', () => task(async () => { session = await api.request('models', {}); render(); $('status').textContent = 'Каталог моделей обновлён.'; }));
$('model-select').addEventListener('change', () => {
  const model = $('model-select').value;
  task(async () => { session = await api.request('model', { model }); render(); $('status').textContent = 'Модель выбрана.'; });
});
task(load);
