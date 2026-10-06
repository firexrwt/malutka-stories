import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApi } from '../public/games/stories/api.js';
import { placeFeedback, showFeedbackError, showLatestReply } from '../public/games/stories/feedback.js';

test('one feedback region follows the visible screen and sits immediately beside story input', async () => {
  const html = await readFile(new URL('../public/games/stories/index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/id="error"/g) || []).length, 1);
  assert.equal((html.match(/id="status"/g) || []).length, 1);
  assert.match(html, /id="play-feedback"><\/div>\s*<form id="action-form"/);
  assert.ok(html.indexOf('id="play-feedback"') > html.indexOf('id="cast-editor"'));
  const nodes = new Map(['play', 'feedback', 'connection-feedback', 'play-feedback'].map(id => [id, { hidden: false,
    append(node) { node.parentElement = this; this.calls = (this.calls || 0) + 1; } }]));
  const doc = { getElementById: id => nodes.get(id) }, feedback = nodes.get('feedback');
  nodes.get('play').hidden = true; placeFeedback(doc); assert.equal(feedback.parentElement, nodes.get('connection-feedback'));
  nodes.get('play').hidden = false; placeFeedback(doc); assert.equal(feedback.parentElement, nodes.get('play-feedback'));
  placeFeedback(doc); assert.equal(nodes.get('play-feedback').calls, 1);
  const main = await readFile(new URL('../public/games/stories/main.js', import.meta.url), 'utf8');
  assert.match(main, /placeFeedback\(document\)/); assert.match(main, /showFeedbackError\(document, error\)/);
});

test('a failed turn shows text safely and brings its message into view', () => {
  const node = { hidden: true, set innerHTML(_) { throw new Error('unsafe'); }, scrollIntoView(options) { this.scrolled = options; } };
  showFeedbackError({ getElementById: () => node }, new Error('<img src=x> Не удалось продолжить.'));
  assert.equal(node.hidden, false); assert.equal(node.textContent, '<img src=x> Не удалось продолжить.');
  assert.deepEqual(node.scrolled, { block: 'nearest' });
});

test('a submitted response becomes visible even when the user had read older history', async () => {
  const history = { scrollTop: 0, scrollHeight: 2048 }; showLatestReply({ getElementById: () => history });
  assert.equal(history.scrollTop, history.scrollHeight);
  const main = await readFile(new URL('../public/games/stories/main.js', import.meta.url), 'utf8');
  assert.equal((main.match(/showLatestReply\(document\)/g) || []).length, 3);
  assert.match(main, /api\.request\('turn', pending\)[^\n]*showLatestReply\(document\)/);
});

test('network, timeout and malformed responses report a readable retry without changing caller input', async () => {
  const input = { text: 'Привет.', speaker: 'pr1nc3x3', requestId: 'fixture-request-123', version: 4, runId: 'fixture-run' };
  for (const [name, message] of [['TypeError', /Нет связи с локальным сервером/], ['TimeoutError', /ChatGPT не успел ответить/], ['AbortError', /ChatGPT не успел ответить/]]) {
    const api = createApi(async () => { throw Object.assign(new Error('fixture'), { name }); });
    await assert.rejects(api.request('turn', input), message);
    assert.equal(input.text, 'Привет.'); assert.equal(input.version, 4);
  }
  await assert.rejects(createApi(async () => new Response('not json')).request('turn', input), /Сервис не ответил/);
});

test('successful API responses refresh CSRF and server errors preserve their typed code', async () => {
  const requests = [];
  const api = createApi(async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify(requests.length === 1 ?
    { csrf: 'fixture-csrf' } : { error: 'inconsistent', message: 'Попробуй ещё раз.' }), { status: requests.length === 1 ? 200 : 502 }); });
  await api.request('session');
  await assert.rejects(api.request('turn', { text: 'Привет.' }), error => error.code === 'inconsistent' && error.message === 'Попробуй ещё раз.');
  assert.equal(requests[1].options.headers['x-story-csrf'], 'fixture-csrf');
  assert.equal(requests[1].options.credentials, 'same-origin');
});
