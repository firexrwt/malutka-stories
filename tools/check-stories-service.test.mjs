import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { createStorage } from '../server/stories/storage.js';
import { createService, SESSION_TTL } from '../server/stories/service.js';
import { createProvider } from '../server/stories/provider.js';
import { createStories } from '../server/stories/index.js';
import { consumeResponse } from '../server/stories/responses.js';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { requestSignal } from '../server/stories/http.js';
import { validSavedRun } from '../server/stories/saved-state.js';
import { LIMITS } from '../server/stories/limits.js';

const make = async provider => createService({ storage: await createStorage(null), provider: provider || createProvider({ mode: 'test' }) });
const body = (s, text, id = randomUUID()) => ({ text, requestId: id, runId: s.run.id, version: s.run.version });
const turn = (svc, s, b) => { s.lastRequest = 0; return svc.turn(s, b, AbortSignal.timeout(2000)); };
test('retry is idempotent even with an old version, and altered reuse fails', async () => {
  const svc = await make(), s = await svc.create(); await svc.start(s, 'stream');
  const b = body(s, 'Беру запасной микрофон и подключаю вместо сломанного');
  const first = await turn(svc, s, b), replay = await turn(svc, s, b);
  assert.equal(first.run.turn, 1); assert.equal(replay.run.turn, 1); assert.equal(replay.replay, true);
  assert.equal(s.run.receipts.length, 1);
  await assert.rejects(turn(svc, s, { ...b, text: 'Запускаю эфир' }), /другое действие/);
  await assert.rejects(turn(svc, s, { ...b, requestId: randomUUID() }), /другой вкладке/);
});

test('story continues beyond the former cutoff with bounded receipts, history and durable replay', async () => {
  let saved;
  const storage = { load: async () => saved ? [structuredClone(saved)] : [], save: async rows => { saved = structuredClone(rows[0]); } };
  const provider = createProvider({ mode: 'test' }), svc = await createService({ storage, provider }), s = await svc.create();
  await svc.start(s, 'stream'); const first = body(s, 'Привет.'); await turn(svc, s, first);
  for (let i = 1; i < 70; i++) await turn(svc, s, body(s, 'Привет.'));
  assert.equal(s.run.version, 70); assert.equal(s.run.status, 'active'); assert.equal(s.run.outcome, null);
  assert.equal(s.run.history.length, 12); assert.equal(s.run.receipts.length, LIMITS.receipts); assert.equal(validSavedRun(s.run), true);
  const prior = structuredClone(s.run);
  await assert.rejects(turn(svc, s, first), /другой вкладке/); assert.deepEqual(s.run, prior);
  const last = body(s, 'Да алё, блядь!'); await turn(svc, s, last);
  const restored = await createService({ storage, provider }), current = restored.get(s.sid);
  assert.equal(current.run.version, 71); assert.equal((await turn(restored, current, last)).replay, true);
  await turn(restored, current, body(current, 'А дальше что?')); assert.equal(current.run.version, 72);
  assert.equal(validSavedRun({ ...current.run, version: Number.MAX_SAFE_INTEGER + 1 }), false);
});

test('legacy completed runs resume the same story without dropping history or receipts', async () => {
  const provider = createProvider({ mode: 'test' }), base = await make(provider), initial = await base.create();
  await base.start(initial, 'stream'); await turn(base, initial, body(initial, 'Привет.'));
  for (const outcome of ['Лимит демки достигнут. История завершена.', 'Ты завершил историю.']) {
    const old = structuredClone(initial); old.run.status = 'finished'; old.run.outcome = outcome;
    let migrated;
    const svc = await createService({ provider, storage: { load: async () => [old], save: async rows => { migrated = structuredClone(rows[0]); } } });
    const s = svc.get(old.sid); assert.equal(s.run.id, initial.run.id); assert.equal(s.run.status, 'active'); assert.equal(s.run.outcome, null);
    assert.deepEqual(s.run.history, initial.run.history); assert.deepEqual(s.run.receipts, initial.run.receipts);
    assert.equal(migrated.run.status, 'active');
    await turn(svc, s, body(s, 'Продолжаем.')); assert.equal(s.run.version, 2);
  }
});

test('successful story activity renews persisted idle expiry while abandoned sessions still expire', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000000 });
  let saved;
  const storage = { load: async () => saved ? [structuredClone(saved)] : [], save: async rows => { saved = structuredClone(rows[0]); } };
  const provider = createProvider({ mode: 'test' }), svc = await createService({ storage, provider }), s = await svc.create();
  await svc.start(s, 'stream'); const originalExpiry = s.expiresAt;
  t.mock.timers.tick(SESSION_TTL - 1000); await turn(svc, s, body(s, 'Продолжаем.'));
  assert.ok(s.expiresAt > originalExpiry); assert.equal(saved.expiresAt, s.expiresAt);
  t.mock.timers.tick(2000); assert.equal(svc.get(s.sid), s);
  const restored = await createService({ storage, provider }); assert.equal(restored.get(s.sid).run.version, 1);
  t.mock.timers.tick(SESSION_TTL); assert.equal(restored.get(s.sid), null);
});
test('foreign session cannot open or mutate another run', async () => {
  const svc = await make(), a = await svc.create(), b = await svc.create();
  await svc.start(a, 'stream');
  assert.equal(svc.info(b).run, null);
  await assert.rejects(turn(svc, b, body(a, 'Запускаю эфир')), /недоступно/);
  assert.equal(a.run.version, 0);
  assert.equal(JSON.stringify(svc.info(a)).includes(a.sid), false, 'session capability never returned in JSON');
});
test('provider failure and save failure both roll back before allowing a retry', async () => {
  const base = createProvider({ mode: 'test' }); let fail = false;
  const svc = await make({ ...base, async narrate(...args) { if (fail) throw new Error('fixture provider outage'); return base.narrate(...args); } });
  const s = await svc.create(); await svc.start(s, 'stream'); const b = body(s, 'Беру запасной микрофон и подключаю вместо сломанного');
  fail = true;
  await assert.rejects(turn(svc, s, b), /outage/);
  assert.equal(s.run.version, 0); assert.equal(s.run.facts.mic, 'broken_mic');
  fail = false; await turn(svc, s, b); assert.equal(s.run.turn, 1);
  let writesFail = false;
  const store = { load: async () => [], save: async () => { if (writesFail) throw new Error('disk full'); } };
  const persisted = await createService({ storage: store, provider: base }); const p = await persisted.create(); await persisted.start(p, 'stream');
  const request = body(p, 'Беру запасной микрофон'); writesFail = true;
  await assert.rejects(turn(persisted, p, request), /disk full/); assert.equal(p.run.version, 0);
  writesFail = false; await turn(persisted, p, request); assert.equal(p.run.version, 1);
});
test('free prose is saved without requiring a supported engine command', async () => {
  const svc = await make(), s = await svc.create(); await svc.start(s, 'meeting');
  await turn(svc, s, body(s, 'Что написал, то и продолжай. *Сижу и смеюсь*'));
  assert.equal(s.run.history.at(-1).player, 'Что написал, то и продолжай. *Сижу и смеюсь*');
  assert.equal(s.run.version, 1);
});
test('global and per-session concurrency limits reject overlap without duplicate work', async () => {
  let release; const blocked = new Promise(r => { release = r; }), base = createProvider({ mode: 'test' });
  const svc = await make({ ...base, async plan(...args) { await blocked; return base.plan(...args); } });
  const sessions = await Promise.all([svc.create(), svc.create(), svc.create()]);
  for (const s of sessions) await svc.start(s, 'stream');
  const a = turn(svc, sessions[0], body(sessions[0], 'Проверяю основной микрофон'));
  await assert.rejects(turn(svc, sessions[0], body(sessions[0], 'Беру кабель')), /ещё выполняется/);
  const b = turn(svc, sessions[1], body(sessions[1], 'Проверяю основной микрофон'));
  await assert.rejects(turn(svc, sessions[2], body(sessions[2], 'Проверяю основной микрофон')), /занят/);
  release(); await Promise.all([a, b]); assert.equal(sessions[0].run.turn, 1);
});
async function call(route, path, { method = 'GET', data, cookie = '', origin = 'http://127.0.0.1:3116', csrf = '', host = '127.0.0.1:3116' } = {}) {
  const req = Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []);
  Object.assign(req, { url: path, method, headers: { host, origin, cookie, 'content-type': 'application/json', 'x-story-csrf': csrf } });
  let status, raw = '', headers = {};
  const res = { setHeader(k, v) { headers[k] = v; }, writeHead(s, h) { status = s; headers = { ...headers, ...h }; }, end(body = '') { raw = body; } };
  await route(req, res); return { status, data: raw ? JSON.parse(raw) : null, cookie: headers['set-cookie']?.split(';')[0], headers };
}
test('HTTP API enforces Host, Origin, CSRF, cookies and public-web disabled mode', async () => {
  const route = await createStories({ host: '127.0.0.1', port: 3116, directory: null, env: { MALUTKA_STORIES_LOCAL: '1', MALUTKA_STORIES_TEST: '1' } });
  const boot = await call(route, '/api/stories/session'); assert.equal(boot.status, 200);
  assert.equal((await call(route, '/api/stories/session', { origin: 'https://evil.example' })).status, 403);
  assert.match(boot.headers['set-cookie'], /HttpOnly; SameSite=Lax/);
  for (const override of [{ csrf: 'wrong' }, { origin: 'https://evil.example' }, { host: 'evil.example:3116' }, { cookie: '' }]) {
    const r = await call(route, '/api/stories/start', { method: 'POST', data: { scene: 'stream' }, csrf: boot.data.csrf, cookie: boot.cookie, ...override });
    assert.equal(r.status, 403);
  }
  const a = await call(route, '/api/stories/start', { method: 'POST', data: { scene: 'stream' }, csrf: boot.data.csrf, cookie: boot.cookie });
  assert.equal(a.status, 200);
  assert.equal(a.cookie, boot.cookie); assert.match(a.headers['set-cookie'], /Max-Age=28800/);
  const foreign = await call(route, '/api/stories/session'); assert.equal(foreign.data.run, null);
  const tamper = await call(route, '/api/stories/turn', { method: 'POST', data: { runId: a.data.run.id, version: 0, requestId: randomUUID(), text: 'Запускаю эфир' }, csrf: foreign.data.csrf, cookie: foreign.cookie });
  assert.equal(tamper.status, 404);
  const publicRoute = await createStories({ host: '0.0.0.0', port: 3006, env: { NODE_ENV: 'production' } });
  const disabled = await call(publicRoute, '/api/stories/session'); assert.equal(disabled.data.mode, 'unavailable'); assert.equal(disabled.cookie, undefined);
  assert.equal((await call(publicRoute, '/api/stories/auth/start', { method: 'POST', data: { usePlan: true } })).status, 503);
  await assert.rejects(createStories({ host: '0.0.0.0', port: 3116, env: { MALUTKA_STORIES_LOCAL: '1' } }), /local-only/);
});
test('test fixtures cannot appear in ChatGPT mode, and each mode resumes only its own saved session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'malutka-stories-mode-'));
  const options = { host: '127.0.0.1', port: 3116, directory };
  const testEnv = { MALUTKA_STORIES_LOCAL: '1', MALUTKA_STORIES_TEST: '1' };
  const fixtureRoute = await createStories({ ...options, env: testEnv });
  const fixture = await call(fixtureRoute, '/api/stories/session');
  const opening = await call(fixtureRoute, '/api/stories/start', { method: 'POST', data: { scene: 'meeting' },
    cookie: fixture.cookie, csrf: fixture.data.csrf });
  assert.equal(opening.data.mode, 'test'); assert.ok(opening.data.run);
  const realRoute = await createStories({ ...options, env: { MALUTKA_STORIES_LOCAL: '1' } });
  const real = await call(realRoute, '/api/stories/session', { cookie: fixture.cookie });
  assert.equal(real.data.mode, 'chatgpt'); assert.equal(real.data.run, null);
  assert.equal(real.data.account, null); assert.notEqual(real.cookie, fixture.cookie);
  const resumedRoute = await createStories({ ...options, env: testEnv });
  const resumed = await call(resumedRoute, '/api/stories/session', { cookie: fixture.cookie });
  assert.equal(resumed.data.run.id, opening.data.run.id);
  const foreign = await call(resumedRoute, '/api/stories/session', { cookie: real.cookie });
  assert.equal(foreign.data.run, null); assert.equal(foreign.data.account, null);
});
test('SSE requires response.completed, handles fragmentation, refuses errors and incomplete output', async () => {
  const payload = { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"text":"Привет"}' }] }] } };
  const data = Buffer.from(`data: ${JSON.stringify(payload)}\r\n\r\n`);
  const chunks = [...data].map(b => Uint8Array.of(b));
  const stream = new ReadableStream({ start(c) { chunks.forEach(b => c.enqueue(b)); c.close(); } });
  assert.deepEqual(await consumeResponse(new Response(stream)), { text: 'Привет' });
  await assert.rejects(consumeResponse(new Response('data: {"type":"response.output_text.delta","delta":"fake","output_index":0,"content_index":0}\n\n')), /оборвался/);
  await assert.rejects(consumeResponse(new Response('data: {"type":"response.failed"}\n\n')), /не завершил/);
  await assert.rejects(consumeResponse(new Response('', { status: 429 })), /Лимит/);
});

test('durable run, idempotency receipts and host identity survive a service restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'malutka-stories-test-'));
  const storage = await createStorage(dir), svc = await createService({ storage, provider: createProvider({ mode: 'test' }) });
  const s = await svc.create(); await svc.start(s, 'stream'); const b = body(s, 'Беру запасной микрофон');
  await turn(svc, s, b);
  assert.equal((await stat(join(dir, 'sessions.json'))).mode & 0o077, 0);
  const reopened = await createStorage(dir), restored = await createService({ storage: reopened, provider: createProvider({ mode: 'test' }) });
  assert.equal(reopened.hostId, storage.hostId);
  const saved = restored.get(s.sid); assert.ok(saved); assert.equal(saved.run.version, 1);
  assert.equal((await turn(restored, saved, b)).replay, true); assert.equal(saved.run.turn, 1);
});
test('invalid stored shape cannot crash all scenes or be accepted as a run', async () => {
  const svc = await createService({ storage: { load: async () => ({}), save: async () => {} }, provider: createProvider({ mode: 'test' }) });
  assert.ok(await svc.create());
  const good = await svc.create(), corrupt = { ...good, run: { scene: 'stream' } };
  const restored = await createService({ storage: { load: async () => [corrupt, good], save: async () => {} }, provider: createProvider({ mode: 'test' }) });
  assert.equal(restored.get(corrupt.sid), good);
});
test('cross-session save rollback cannot leak an uncommitted turn into the next snapshot', async () => {
  let first = true, snapshots = [];
  const store = { load: async () => [], save: async s => {
    if (s.some(v => v.run?.version === 1) && first) { first = false; throw new Error('first save fails'); }
    snapshots.push(structuredClone(s));
  } };
  const svc = await createService({ storage: store, provider: createProvider({ mode: 'test' }) }), a = await svc.create(), b = await svc.create();
  await svc.start(a, 'stream'); await svc.start(b, 'stream');
  const results = await Promise.allSettled([turn(svc, a, body(a, 'Беру запасной микрофон')), turn(svc, b, body(b, 'Беру запасной микрофон'))]);
  assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'fulfilled');
  assert.equal(a.run.version, 0); assert.equal(b.run.version, 1);
  assert.equal(snapshots.at(-1).find(s => s.sid === a.sid).run.version, 0);
});
test('client disconnect aborts inference and cannot commit even if a provider ignores cancellation', async () => {
  const req = new EventEmitter(), res = new EventEmitter(); res.writableEnded = false;
  const signal = requestSignal(req, res, 2000), base = createProvider({ mode: 'test' });
  const provider = { ...base, plan: async (...args) => { res.emit('close'); return base.plan(...args); } };
  const svc = await make(provider), s = await svc.create(); await svc.start(s, 'stream');
  s.lastRequest = 0;
  await assert.rejects(svc.turn(s, body(s, 'Беру запасной микрофон'), signal), /Client disconnected/);
  assert.equal(signal.aborted, true); assert.equal(s.run.version, 0); assert.equal(s.run.receipts.length, 0);
  assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0);
  const controller = new AbortController();
  const abandoned = await make({ ...base, narrate: async (...args) => { controller.abort(new Error('abandoned opening')); return base.narrate(...args); } });
  const owner = await abandoned.create(); await assert.rejects(abandoned.start(owner, 'stream', controller.signal), /abandoned opening/);
  assert.equal(owner.run, null);
});
test('expired sessions are durably erased, including expired snapshots loaded on startup', async () => {
  let snapshot = [];
  const storage = { load: async () => snapshot, save: async value => { snapshot = structuredClone(value); } };
  const provider = createProvider({ mode: 'test' }), svc = await createService({ storage, provider });
  const s = await svc.create(); s.expiresAt = Date.now() - 1;
  assert.equal(svc.get(s.sid), null); await svc.persist(); assert.deepEqual(snapshot, []);
  snapshot = [s]; await createService({ storage, provider });
  assert.deepEqual(snapshot, []);
});
