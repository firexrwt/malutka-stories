import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createProvider } from '../server/stories/provider.js';
import { createService } from '../server/stories/service.js';
import { SCENES } from '../server/stories/scenes.js';
import { initialDirection } from '../public/games/stories/director.js';

const sse = value => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] } })}\n\n`);
async function fixture(line = 'Я думал, Принц сейчас запоёт.') {
  const calls = []; let failure = null, abort = null;
  let saved = [];
  const storage = { load: async () => structuredClone(saved), save: async value => { saved = structuredClone(value); } };
  const provider = createProvider({ mode: 'chatgpt', credentials: async () => 'fixture-token', fetcher: async (_url, options) => {
    const request = JSON.parse(options.body), payload = JSON.parse(request.input[0].content); calls.push(payload);
    assert.ok(request.instructions.startsWith('Ты ведёшь'), 'every real story request goes straight to the storyteller');
    assert.equal('facts' in payload, false); assert.equal('actions' in payload, false);
    if (abort) abort.abort();
    if (failure) return failure;
    const visual = initialDirection(SCENES.get('stream')); if (payload.player) visual.caption = payload.player;
    return sse({ lines: [{ actor: 'pihta_stream', text: line }],
      reactions: [], memory: payload.player || 'Начало разговора.', visual });
  } });
  const service = await createService({ storage, provider }), session = await service.create();
  session.model = 'fixture'; session.models = [{ slug: 'fixture', name: 'fixture' }];
  await service.start(session, 'stream');
  return { service, session, calls, restart: () => createService({ storage, provider }), fail: response => { failure = response; }, abort: controller => { abort = controller; } };
}
const body = (s, text) => ({ text, speaker: 'firexrwt', requestId: randomUUID(), runId: s.run.id, version: s.run.version });

test('written actions and absurd banter each continue in one model call with original text and role', async () => {
  const f = await fixture();
  for (const text of [
    'Да господи, просто подрубите резервный микрофон для начала *Подключил новый микрофон и тестирую звук* Во, все, норм работает',
    'Раз, два, три, четыре, пять, Принц идет свой звук искать',
    '*Достал золотой микрофон из кармана и включил эфир* Поехали!',
  ]) {
    f.session.lastRequest = 0; const b = body(f.session, text), count = f.calls.length;
    await f.service.turn(f.session, b);
    assert.equal(f.calls.length, count + 1);
    assert.equal(f.calls.at(-1).player, text); assert.equal(f.calls.at(-1).speaker.id, 'firexrwt');
    assert.equal(f.session.run.history.at(-1).player, text);
    assert.equal(f.session.run.history.at(-1).speaker, 'firexrwt');
    assert.equal(f.session.run.memory, text);
    assert.equal(f.session.run.version, b.version + 1);
    assert.match(f.calls.at(-1).cast.find(m => m.id === 'pihta_stream').trait, /Пихта - парень, он/);
    await f.service.turn(f.session, b);
    assert.equal(f.calls.length, count + 1, 'saved request replay does not duplicate inference');
  }
  assert.ok(f.calls.at(-1).history.some(h => h.player.includes('Принц идет')));
});

test('auth, refusal, damaged transport and abort still preserve the last saved story', async () => {
  const refusal = new Response(`data: ${JSON.stringify({ type: 'response.refusal.done' })}\n\n`);
  for (const [failure, code] of [[new Response('', { status: 401 }), 'provider_http'], [refusal, 'provider_refused'],
    [new Response('data: invalid-json\n\n'), 'provider_format'], [new Response(''), 'provider_incomplete']]) {
    const f = await fixture(), prior = structuredClone(f.session.run);
    f.fail(failure); f.session.lastRequest = 0;
    await assert.rejects(f.service.turn(f.session, body(f.session, 'Продолжаю историю')), { code });
    assert.deepEqual(f.session.run, prior); assert.equal(f.calls.length, 2);
  }
  const f = await fixture(), controller = new AbortController(), prior = structuredClone(f.session.run);
  f.abort(controller); f.session.lastRequest = 0;
  await assert.rejects(f.service.turn(f.session, body(f.session, 'Продолжаю историю'), controller.signal), { name: 'AbortError' });
  assert.deepEqual(f.session.run, prior); assert.equal(f.calls.length, 2);
});

test('restart retains arbitrary story words in input, output, memory and caption without a hidden lexical gate', async () => {
  const f = await fixture('Я не собирался обсуждать слово секс.'), text = 'Это слово секс, а не сцена. Продолжаем разговор.';
  f.session.lastRequest = 0; const b = body(f.session, text);
  await f.service.turn(f.session, b);
  const prior = structuredClone(f.session.run), restored = await f.restart(), s = restored.get(f.session.sid);
  assert.ok(s, 'a structurally valid saved story survives restart regardless of vocabulary');
  assert.deepEqual(s.run, prior);
  await restored.turn(s, b); assert.equal(f.calls.length, 2, 'replay receipt survives restart');
  s.lastRequest = 0; await restored.turn(s, body(s, 'Ладно, идём дальше.'));
  assert.equal(s.run.version, b.version + 2);
  assert.equal(f.calls.at(-1).memory, text);
});
