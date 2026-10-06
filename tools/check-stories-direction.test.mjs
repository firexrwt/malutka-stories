import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { startScene, SCENES } from '../server/stories/scenes.js';
import { initialDirection, validDirection } from '../public/games/stories/director.js';
import { createService } from '../server/stories/service.js';
import { createProvider } from '../server/stories/provider.js';
import { createStorage } from '../server/stories/storage.js';
import { execute } from '../server/stories/engine.js';
import { validSavedRun } from '../server/stories/saved-state.js';

const sse = value => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] } })}\n\n`);
const body = (s, text) => ({ text, requestId: randomUUID(), runId: s.run.id, version: s.run.version });
test('director accepts only cast, existing props and bounded declarative composition', () => {
  const scene = SCENES.get('stream'), base = initialDirection(scene), check = v => validDirection(v, scene.cast, scene.objects.map(o => o.id));
  assert.ok(check(base));
  for (const v of [{ ...base, camera: 'javascript:alert(1)' }, { ...base, props: ['golden_key'] },
    { ...base, actors: [{ ...base.actors[0], id: '__proto__' }] }, { ...base, actors: [{ ...base.actors[0], x: Infinity }] },
    { ...base, actors: [{ ...base.actors[0], facing: 'url(evil)' }] }, { ...base, focus: 'ghost' }, { ...base, camera: 'close', focus: null },
    { ...base, actors: [base.actors[0]], focus: base.actors[1].id }, { ...base, background: 'https://evil/' },
    { ...base, background: undefined }, { ...base, actors: [{ ...base.actors[0], variant: undefined }] },
    { ...base, actors: [{ ...base.actors[0], variant: 'eval' }] }]) assert.equal(check(v), null);
  const cast = [...scene.cast, 'generic_courier'];
  const npc = { ...base, actors: [{ id: 'generic_courier', x: 50, y: 78, facing: 'front', variant: 'doubt' }], focus: null };
  assert.ok(validDirection(npc, cast, scene.objects.map(o => o.id)));
  npc.actors[0].variant = 'confident';
  assert.equal(validDirection(npc, cast, scene.objects.map(o => o.id)), null, 'an NPC cannot select a main-character-only portrait');
});
test('regression detects a deliberately broken cast boundary without changing product files', async () => {
  const source = await readFile(new URL('../public/games/stories/director.js', import.meta.url), 'utf8');
  const broken = source.replace('  if (!plain(value)', "  members.set('mzberg', 'mzberg');\n  if (!plain(value)").replace('./art-library.js', new URL('../public/games/stories/art-library.js', import.meta.url).href); assert.notEqual(broken, source);
  const mutant = await import(`data:text/javascript;base64,${Buffer.from(broken).toString('base64')}`);
  const scene = SCENES.get('stream'), v = initialDirection(scene); v.actors[0].id = 'mzberg'; v.props = [];
  assert.equal(validDirection(v, scene.cast, []), null);
  assert.notEqual(mutant.validDirection(v, scene.cast, []), null, 'the same bad actor crosses the deliberately broken boundary');
});
test('procedural provider generates opening, free chat, memory and changed direction without a semantic judge', async () => {
  let serial = 0; const seen = [];
  const provider = createProvider({ mode: 'chatgpt', credentials: async () => 'fixture-token', fetcher: async (_url, options) => {
    const request = JSON.parse(options.body), payload = JSON.parse(request.input[0].content); seen.push(payload);
    assert.ok(request.instructions.startsWith('Ты ведёшь'));
    const visual = initialDirection(SCENES.get('stream')); visual.camera = payload.player ? 'close' : 'wide'; visual.focus = 'pr1nc3x3';
    return sse({ lines: [{ actor: 'pr1nc3x3', text: `Придумал продолжение ${++serial}: ${payload.player || 'что скажет микрофон на пресс-конференции?'}` }], reactions: [], memory: 'Микрофон стал поводом для пресс-конференции.', visual });
  } });
  const svc = await createService({ storage: await createStorage(null), provider }), s = await svc.create();
  s.model = 'fixture'; s.models = [{ slug: 'fixture', name: 'fixture' }];
  await svc.start(s, 'stream'); assert.match(s.run.history[0].text, /пресс-конференции/); assert.equal(s.run.history[0].visual.camera, 'wide');
  const b = body(s, 'Пусть Принц даст микрофону слово.'), facts = structuredClone(s.run.facts); s.lastRequest = 0;
  await svc.turn(s, b); assert.equal(s.run.history.at(-1).visual.camera, 'close'); assert.match(s.run.history.at(-1).text, /Пусть Принц/);
  assert.deepEqual(s.run.facts, facts); assert.match(s.run.memory, /пресс-конференции/);
  s.lastRequest = 0;
  await svc.turn(s, body(s, 'Эфир уже идёт.'));
  assert.equal(s.run.history.at(-1).player, 'Эфир уже идёт.');
  assert.equal(seen.length, 3);
  assert.ok(seen.some(v => v.player === b.text && v.memory.includes('пресс-конференции')));
});
test('secondary cast is bounded, persistent and cannot acquire votes, equipment or canonical authority', async () => {
  for (const scene of ['stream', 'meeting', 'board']) {
    const base = startScene(scene, randomUUID());
    const plan = actions => ({ actions: actions.map(a => ({ by: 'player', ...a })), clarification: '' });
    const joined = execute(base, plan([{ type: 'introduce', actor: 'generic_technician' }, { type: 'introduce', actor: 'generic_reporter' }])).next;
    assert.equal(joined.guests.length, 2); assert.deepEqual(joined.facts, base.facts); assert.deepEqual(joined.objects, base.objects);
    const denied = execute(joined, plan([{ type: 'introduce', actor: 'generic_security' }, { type: 'ask', actor: 'generic_technician', task: 'repair' },
      { type: 'ask', actor: 'generic_reporter', task: 'support' }])).next;
    assert.deepEqual(denied.guests, joined.guests); assert.deepEqual(denied.facts, base.facts);
    assert.deepEqual(denied.objects, base.objects); assert.equal(base.guests.length, 0, 'copy transaction does not leak into the prior run');
    assert.equal(execute(base, plan([{ type: 'introduce', actor: '__proto__' }])).next.guests.length, 0);
    const mic = execute(joined, plan([{ type: 'take', by: 'generic_technician', target: 'spare_mic' },
      { type: 'connect', by: 'generic_technician', target: 'spare_mic', channel: 'audio' }, { type: 'begin', by: 'generic_reporter' }])).next;
    assert.deepEqual(mic.facts, joined.facts); assert.deepEqual(mic.objects, joined.objects);
  }
  const svc = await createService({ storage: await createStorage(null), provider: createProvider({ mode: 'test' }) }), s = await svc.create();
  await svc.start(s, 'stream'); s.lastRequest = 0; await svc.turn(s, body(s, 'Позови дежурного техника.'));
  assert.deepEqual(s.run.guests, ['generic_technician']); assert.equal(validSavedRun(s.run), true);
  assert.ok(s.run.history.at(-1).visual.actors.some(a => a.id === 'generic_technician'));
  s.lastRequest = 0; const prior = structuredClone(s.run);
  await svc.turn(s, body(s, 'Пусть дежурный техник возьмет запасной микрофон и подключит его вместо сломанного.'));
  assert.deepEqual(s.run.facts, prior.facts); assert.deepEqual(s.run.objects, prior.objects);
  assert.equal(validSavedRun({ ...s.run, guests: ['unknown'] }), false);
  assert.equal(validSavedRun({ ...s.run, guests: ['generic_technician', 'generic_technician'] }), false);
});
test('episode ending remains continuable through session rotation at the old turn boundary', async () => {
  const svc = await createService({ storage: await createStorage(null), provider: createProvider({ mode: 'test' }) });
  const s = await svc.create(); await svc.start(s, 'stream'); const id = s.run.id;
  await svc.rotate(s); assert.equal(s.run.id, id);
  s.run.version = 31; s.lastRequest = 0;
  await svc.turn(s, body(s, 'Заверши историю финалом.'));
  assert.equal(s.run.status, 'active'); assert.equal(s.run.outcome, null);
  assert.match(s.run.history.at(-1).events[0], /История продолжается/);
  assert.equal(s.run.history.at(-1).events.some(e => /Лимит демки/u.test(e)), false);
});
