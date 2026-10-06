import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createService } from '../server/stories/service.js';
import { createProvider } from '../server/stories/provider.js';
import { createStorage } from '../server/stories/storage.js';
import { startScene } from '../server/stories/scenes.js';
import { CAST } from '../server/stories/canon.js';
import { validSavedRun } from '../server/stories/saved-state.js';
import { runCast, joinCharacter, availableSpeaker, validSelection } from '../server/stories/participants.js';
import { validDirection } from '../public/games/stories/director.js';
import { readPending, savePending, sameTurn, turnRequest } from '../public/games/stories/recovery.js';
import { digest } from '../server/stories/mutations.js';
import { testNarration } from '../server/stories/test-provider.js';

const body = (s, data) => ({ ...data, runId: s.run.id, version: s.run.version, requestId: randomUUID() });
const invoke = (svc, s, method, data) => { s.lastRequest = 0; return svc[method](s, data, AbortSignal.timeout(2000)); };
const make = async provider => {
  const svc = await createService({ storage: await createStorage(null), provider: provider || createProvider({ mode: 'test' }) });
  const s = await svc.create(); await svc.start(s, 'stream'); return { svc, s };
};
const custom = (name, artId = 'generic_admin') => ({ kind: 'custom', id: `custom_${randomUUID().replaceAll('-', '')}`, name, artId, trait: 'Любит шутить и задавать вопросы.' });

test('selected speaker is recorded, propagated to inference, and bound into retry identity', async () => {
  const base = createProvider({ mode: 'test' }), seen = [];
  const provider = { ...base, plan: async (...args) => { seen.push(args.at(-1)); return base.plan(...args); },
    narrate: async (...args) => { seen.push(args.at(-1)); return base.narrate(...args); } };
  const { svc, s } = await make(provider), b = body(s, { text: 'Проверяю основной микрофон', speaker: 'pihta_stream' });
  await invoke(svc, s, 'turn', b);
  assert.equal(s.run.history.at(-1).speaker, 'pihta_stream');
  assert.equal(s.run.history.at(-1).actions[0].by, 'pihta_stream');
  assert.deepEqual(seen.slice(-2), ['pihta_stream', 'pihta_stream']);
  assert.ok(s.run.history.at(-1).reactions.every(r => r.actor !== 'pihta_stream'));
  assert.equal((await invoke(svc, s, 'turn', b)).replay, true);
  await assert.rejects(invoke(svc, s, 'turn', { ...b, speaker: 'pr1nc3x3' }), /другое действие/);
  await assert.rejects(invoke(svc, s, 'turn', body(s, { text: 'Привет.', speaker: '__proto__' })), /нет в сцене/);
  assert.equal(s.run.version, 1);
});

test('ready, custom and random additions are atomic, visible and persistent; identical art does not merge identities', async () => {
  const { svc, s } = await make(), add = selection => invoke(svc, s, 'addCharacter', body(s, { selection }));
  const a = await add({ mode: 'custom', name: 'Лена', description: 'Любит спорить о кино.', presentation: 'female' });
  const lena = a.run.cast.find(m => m.id === a.addedActor);
  assert.equal(lena.name, 'Лена'); assert.equal(lena.artId, 'generic_admin');
  assert.ok(a.run.history.at(-1).visual.actors.some(actor => actor.id === lena.id));
  const b = await add({ mode: 'custom', name: 'Анна', description: '', presentation: 'female' });
  assert.notEqual(b.addedActor, lena.id); assert.equal(b.run.cast.find(m => m.id === b.addedActor).artId, lena.artId);
  await add({ mode: 'random', presentation: 'male' });
  const ready = await add({ mode: 'ready', ready: 'mzberg' });
  assert.equal(ready.addedActor, 'mzberg'); assert.equal(ready.run.cast.find(m => m.id === 'mzberg').name, CAST.get('mzberg').name);
  assert.equal(validSavedRun(s.run), true);
  const persisted = structuredClone(s), restored = await createService({ storage: { load: async () => [persisted], save: async () => {} }, provider: createProvider({ mode: 'test' }) });
  assert.equal(restored.get(s.sid).run.history.at(-1).text, s.run.history.at(-1).text);
  assert.deepEqual(restored.info(restored.get(s.sid)).run.cast, ready.run.cast);
  assert.equal(validDirection(ready.run.history.at(-1).visual, ready.run.cast, ready.run.objects.map(o => o.id))?.actors.length, 5);
});

test('addition retry replays once and cannot be reused as a turn or a different character', async () => {
  const { svc, s } = await make(), b = body(s, { selection: { mode: 'ready', ready: 'mzberg' } });
  const a = await invoke(svc, s, 'addCharacter', b), replay = await invoke(svc, s, 'addCharacter', b);
  assert.equal(replay.replay, true); assert.equal(replay.addedActor, a.addedActor); assert.equal(s.run.version, 1);
  await assert.rejects(invoke(svc, s, 'addCharacter', { ...b, selection: { mode: 'ready', ready: 'arbuz' } }), /другое действие/);
  await assert.rejects(invoke(svc, s, 'turn', { ...b, text: JSON.stringify(b.selection) }), /другое действие/);
});

test('tagged turn identity rejects structural speaker collisions and still replays legacy self input', async () => {
  const { svc, s } = await make(), b = body(s, { text: JSON.stringify({ text: 'Привет', speaker: 'pihta_stream' }), speaker: 'player' });
  await invoke(svc, s, 'turn', b);
  await assert.rejects(invoke(svc, s, 'turn', { ...b, text: 'Привет', speaker: 'pihta_stream' }), /другое действие/);
  const old = body(s, { text: 'Привет.' }); await invoke(svc, s, 'turn', old);
  s.run.receipts.at(-1).digest = digest(old.text); delete s.run.receipts.at(-1).digestVersion; delete s.run.receipts.at(-1).kind;
  assert.equal((await invoke(svc, s, 'turn', old)).replay, true);
  await assert.rejects(invoke(svc, s, 'turn', { ...old, speaker: 'pihta_stream' }), /другое действие/);
});

test('frozen pending replays an expelled speaker and addition at the old quota keeps the story open', async () => {
  const svc = await createService({ storage: await createStorage(null), provider: createProvider({ mode: 'test' }) });
  const s = await svc.create(); await svc.start(s, 'meeting');
  await invoke(svc, s, 'turn', body(s, { text: 'Читаю повестку' }));
  const b = { kind: 'turn', ...body(s, { text: 'Предлагаю выгнать Арбуза', speaker: 'arbuz' }) };
  await invoke(svc, s, 'turn', b); assert.equal(s.run.facts.arbuz, 'outside');
  const retry = turnRequest(b, b.text, s.run, 'player', () => { throw new Error('must not create a new request'); });
  assert.equal(retry, b); assert.equal((await invoke(svc, s, 'turn', retry)).replay, true);
  const { svc: final, s: f } = await make(); f.run.version = 31;
  f.run.receipts = Array.from({ length: 31 }, () => ({ id: randomUUID(), digest: '0'.repeat(64) }));
  const result = await invoke(final, f, 'addCharacter', body(f, { selection: { mode: 'ready', ready: 'mzberg' } }));
  assert.equal(result.run.version, 32); assert.equal(result.run.status, 'active'); assert.equal(result.run.outcome, null);
  assert.equal(validSavedRun(f.run), true);
});

test('identity, appearance, cast limits and scene authority remain distinct', async () => {
  const run = startScene('stream', randomUUID()), lena = custom('Лена');
  const joined = joinCharacter(run, lena), members = runCast(joined), visual = structuredClone(run.history[0].visual);
  visual.props = [];
  visual.actors = [{ id: lena.id, x: 50, y: 78, facing: 'front', variant: 'speaking' }]; visual.focus = lena.id;
  assert.ok(validDirection(visual, members, []));
  visual.actors[0].variant = 'confident'; assert.equal(validDirection(visual, members, []), null);
  assert.equal(joinCharacter(run, { ...lena, artId: 'firexrwt' }), null);
  assert.equal(joinCharacter(run, { ...lena, name: CAST.get('pihta_stream').name }), null);
  assert.equal(joinCharacter(joined, custom('ЛЕНА')), null);
  assert.equal(joinCharacter(joinCharacter(run, custom('Лена А')), custom('Лена  А')), null);
  assert.equal(joinCharacter(run, { kind: 'ready', id: 'pihta_stream' }), null);
  const { svc, s } = await make();
  const added = await invoke(svc, s, 'addCharacter', body(s, { selection: { mode: 'custom', name: 'Лена', description: '', presentation: 'female' } }));
  await invoke(svc, s, 'turn', body(s, { text: 'Беру запасной микрофон и подключаю его', speaker: added.addedActor }));
  assert.equal(s.run.facts.mic, 'broken_mic'); assert.equal(s.run.history.at(-1).actions[0].by, added.addedActor);
  assert.ok(s.run.history.at(-1).events.every(e => /Второстепенный/u.test(e)));
  for (const name of ['Оля', 'Игорь', 'Женя', 'Саша']) await invoke(svc, s, 'addCharacter', body(s, { selection: { mode: 'custom', name, description: '', presentation: 'auto' } }));
  assert.equal(runCast(s.run).length, 8);
  await assert.rejects(invoke(svc, s, 'addCharacter', body(s, { selection: { mode: 'random', presentation: 'auto' } })), /восемь/);
});

test('failed or cancelled character creation and storage failure leave the entire prior run unchanged', async () => {
  const base = createProvider({ mode: 'test' }); let fail = true;
  const { svc, s } = await make({ ...base, character: async (...args) => { if (fail) throw new Error('character provider failed'); return base.character(...args); } });
  const prior = structuredClone(s.run), b = body(s, { selection: { mode: 'random', presentation: 'auto' } });
  await assert.rejects(invoke(svc, s, 'addCharacter', b), /provider failed/); assert.deepEqual(s.run, prior);
  fail = false; await invoke(svc, s, 'addCharacter', b); assert.equal(s.run.version, 1);
  let writesFail = false;
  const saved = await createService({ storage: { load: async () => [], save: async () => { if (writesFail) throw new Error('disk full'); } }, provider: base });
  const p = await saved.create(); await saved.start(p, 'stream'); const before = structuredClone(p.run);
  writesFail = true; await assert.rejects(invoke(saved, p, 'addCharacter', body(p, { selection: { mode: 'ready', ready: 'mzberg' } })), /disk full/);
  assert.deepEqual(p.run, before);
  const controller = new AbortController(), ignored = await make({ ...base, character: async (...args) => { controller.abort(); return base.character(...args); } });
  const intact = structuredClone(ignored.s.run); ignored.s.lastRequest = 0;
  await assert.rejects(ignored.svc.addCharacter(ignored.s, body(ignored.s, { selection: { mode: 'random', presentation: 'auto' } }), controller.signal), /abort/i);
  assert.deepEqual(ignored.s.run, intact);
});

test('appearance generator chooses from contextual bank and rejects mismatched presentation or unsafe output', async () => {
  const payloads = [], s = { models: [{ slug: 'fixture' }], model: 'fixture' }, run = startScene('stream', randomUUID());
  let artId = 'generic_reporter', unsafe = false;
  const provider = createProvider({ mode: 'chatgpt', credentials: async () => 'fixture', fetcher: async (_url, options) => {
    const request = JSON.parse(options.body), payload = JSON.parse(request.input[0].content); payloads.push(payload);
    const data = request.instructions.startsWith('You are an independent') ? { safe: !unsafe } : { name: 'Лена', trait: 'Любит спорить о кино.', artId };
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }] } })}\n\n`);
  } });
  const selection = { mode: 'custom', name: 'Лена', description: 'Любит кино.', presentation: 'female' };
  const result = await provider.character(s, run, selection, runCast(run)); assert.equal(result.artId, 'generic_reporter');
  assert.ok(payloads.some(p => p.requested?.name === 'Лена' && p.appearances.every(a => a.presentation === 'female') && p.cast.some(m => m.name === CAST.get('pihta_stream').name)));
  artId = 'generic_courier'; await assert.rejects(provider.character(s, run, selection, runCast(run)), /подобрать персонажа/);
  artId = 'firexrwt'; await assert.rejects(provider.character(s, run, selection, runCast(run)), /подобрать персонажа/);
  artId = 'generic_admin'; unsafe = true; await assert.rejects(provider.character(s, run, selection, runCast(run)), /безопасные/);
  for (const name of ['', '<script>', '*Лена*', 'ТЫ', 'A\nB', 'AРБУЗ', 'ΑРБУЗ']) assert.equal(validSelection({ ...selection, name }), null);
  for (const name of ['Лена', 'Lena', 'Жан-Пьер', 'Mary Jane']) assert.ok(validSelection({ ...selection, name }));
});

test('narrator strips duplicate speech for selected role without requesting a review', async () => {
  const run = startScene('stream', randomUUID()), s = { models: [{ slug: 'fixture' }], model: 'fixture' };
  let extra = 'lines', reviews = 0;
  const provider = createProvider({ mode: 'chatgpt', credentials: async () => 'fixture', fetcher: async (_url, options) => {
    const request = JSON.parse(options.body);
    let data;
    if (request.instructions.startsWith('You are an independent')) {
      reviews++; const generated = JSON.parse(request.input[0].content).generated;
      assert.doesNotMatch(generated.text, /Я решила запустить эфир/);
      assert.ok(generated.reactions.every(r => r.actor !== 'pihta_stream'));
      data = { safe: true, coherent: true };
    }
    else {
      data = testNarration(run, [], 'Привет.', 'pihta_stream');
      if (extra) data[extra].push({ actor: 'pihta_stream', text: 'Я решила запустить эфир.' });
    }
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }] } })}\n\n`);
  } });
  for (extra of ['lines', 'reactions']) assert.ok((await provider.narrate(s, run, [], '', undefined, 'Привет.', [], 'pihta_stream')).text);
  assert.equal(reviews, 0);
  extra = null;
  assert.ok((await provider.narrate(s, run, [], '', undefined, 'Привет.', [], 'pihta_stream')).text);
  assert.equal(reviews, 0);
});

test('legacy history remains readable, expelled Arbuz cannot author new input, and speaker recovery is frozen', async () => {
  const legacy = startScene('meeting', randomUUID()); assert.equal(validSavedRun(legacy), true);
  assert.equal(availableSpeaker(legacy, 'arbuz'), true); legacy.facts.arbuz = 'outside'; assert.equal(availableSpeaker(legacy, 'arbuz'), false);
  const pending = { kind: 'turn', text: 'Привет.', speaker: 'pihta_stream', runId: randomUUID(), version: 1, requestId: randomUUID() };
  let raw; const storage = { getItem: () => raw, setItem: (_, value) => { raw = value; }, removeItem: () => { raw = null; } };
  savePending(storage, pending); const saved = readPending(storage); assert.deepEqual(saved, pending);
  assert.equal(sameTurn(saved, saved.text, saved.runId, 'pihta_stream'), true);
  assert.equal(sameTurn(saved, saved.text, saved.runId, 'pr1nc3x3'), false);
  savePending(storage, { ...pending, speaker: undefined, kind: undefined }); assert.equal(readPending(storage).speaker, 'player');
  savePending(storage, { kind: 'character', selection: { mode: 'random', presentation: 'female' }, runId: pending.runId, version: 1, requestId: pending.requestId });
  assert.equal(readPending(storage).selection.presentation, 'female');
  raw = 'x'.repeat(2501); assert.equal(readPending(storage), null);
  const source = await readFile(new URL('../server/stories/protocol.js', import.meta.url), 'utf8');
  const broken = source.replace('`${names.get(line.actor)}: ${line.text.trim()}`', 'line.text.trim()'); assert.notEqual(source, broken);
  const mutant = await import(`data:text/javascript;base64,${Buffer.from(broken).toString('base64')}`);
  assert.throws(() => assert.match(mutant.validScript({ lines: [{ actor: 'pihta_stream', text: 'Привет.' }], reactions: [] }, [CAST.get('pihta_stream')]).text, /:/), assert.AssertionError);
});
