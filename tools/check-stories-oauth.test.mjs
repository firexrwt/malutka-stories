import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { createOAuth } from '../server/stories/oauth.js';
import { verifyIdToken, sameSecret, ISSUER, RESOURCE } from '../server/stories/oidc.js';
import { createProvider } from '../server/stories/provider.js';
import { startScene } from '../server/stories/scenes.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256', use: 'sig' };
const jwt = (claims, header = {}) => {
  const input = [Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture', ...header })).toString('base64url'),
    Buffer.from(JSON.stringify({ iss: ISSUER, aud: 'oaiapp_fixture', sub: 'subject', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...claims })).toString('base64url')].join('.');
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
};
const discovery = { issuer: ISSUER, authorization_endpoint: `${ISSUER}/api/accounts/authorize`, token_endpoint: `${ISSUER}/api/accounts/oauth/token`,
  jwks_uri: `${ISSUER}/.well-known/jwks.json`, revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke` };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const sse = value => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] } })}\n\n`);
const session = () => ({ sid: randomBytes(32).toString('base64url'), auth: null, usePlan: false, model: '', models: [] });

test('OIDC verifies signature, issuer, audience, nonce, timestamps, algorithm and subject', () => {
  const expected = { clientId: 'oaiapp_fixture', nonce: 'nonce' };
  assert.deepEqual(verifyIdToken(jwt({ nonce: 'nonce' }), [jwk], expected), { sub: 'subject', email: '' });
  for (const claims of [{ iss: 'https://evil.test' }, { aud: 'oaiapp_other' }, { nonce: 'wrong' }, { exp: 1 }, { sub: '' },
    { iat: Date.now() / 1000 + 100 }, { nbf: Date.now() / 1000 + 100 }, { aud: ['oaiapp_fixture', 'other'] }]) {
    assert.equal(verifyIdToken(jwt({ nonce: 'nonce', ...claims }), [jwk], expected), null, JSON.stringify(claims));
  }
  assert.equal(verifyIdToken(jwt({ nonce: 'nonce' }, { alg: 'none' }), [jwk], expected), null);
  const token = jwt({ nonce: 'nonce' }); assert.equal(verifyIdToken(token.slice(0, -10) + 'invalid000', [jwk], expected), null);
  assert.equal(verifyIdToken(token, [jwk], { ...expected, subject: 'other' }), null);
  assert.equal(sameSecret('é', 'a'), false);
});

function fixture({ identityOnly = false, scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', refreshFails = false, revokeFails = false, catalog } = {}) {
  let nonce, saves = 0, exchanges = 0, revoked = 0; const requests = [];
  const fetcher = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('openid-configuration')) return json(discovery);
    if (String(url).endsWith('jwks.json')) return json({ keys: [jwk] });
    if (String(url) === discovery.revocation_endpoint) { revoked++; return new Response('', { status: revokeFails ? 503 : 200 }); }
    if (String(url) === discovery.token_endpoint) {
      exchanges++; const form = new URLSearchParams(options.body);
      assert.equal(form.get('client_id'), 'oaiapp_fixture'); assert.equal(form.get('resource'), RESOURCE);
      assert.equal(options.redirect, 'error');
      if (form.get('grant_type') === 'refresh_token') {
        if (refreshFails) return new Response('', { status: 400 });
        assert.equal(form.get('refresh_token'), 'refresh-fixture');
        return json({ access_token: 'access-new', refresh_token: 'refresh-rotated', token_type: 'Bearer', expires_in: 3600, scope: scopes });
      }
      assert.equal(form.get('redirect_uri'), 'http://127.0.0.1:3116/auth/callback');
      assert.match(form.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
      if (identityOnly) return json({ id_token: jwt({ nonce }) });
      return json({ id_token: jwt({ nonce }), access_token: 'access-fixture', refresh_token: 'refresh-fixture', token_type: 'Bearer', expires_in: 3600, scope: scopes });
    }
    if (String(url) === `${RESOURCE}/models`) return json(catalog || { models: [{ visibility: 'list', slug: 'fixture-model', display_name: 'Fixture model' },
      { visibility: 'hidden', slug: 'hidden', display_name: 'Hidden' }, { visibility: 'list', slug: '../../invalid', display_name: 'Invalid' }] });
    throw new Error(`Unexpected endpoint ${url}`);
  };
  const auth = createOAuth({ origin: 'http://127.0.0.1:3116', hostId: 'urn:uuid:fixture', persist: async () => { saves++; }, fetcher });
  return { auth, requests, stats: () => ({ saves, exchanges, revoked }), async begin(s, usePlan = true) {
    const url = new URL(await auth.begin(s, usePlan, AbortSignal.timeout(2000))); nonce = url.searchParams.get('nonce'); return url;
  } };
}
test('OAuth uses dynamic registration and rejects missing/mismatched/consumed state and wrong client', async () => {
  const f = fixture(), s = session(), url = await f.begin(s);
  assert.equal(url.origin, ISSUER); assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('resource'), RESOURCE);
  const params = new URLSearchParams({ state: url.searchParams.get('state'), code: 'code-fixture', client_id: 'oaiapp_fixture' });
  await assert.rejects(f.auth.callback(s, new URLSearchParams({ ...Object.fromEntries(params), state: 'wrong' })), /Неверный/);
  assert.equal(f.stats().exchanges, 0);
  await f.auth.callback(s, params, AbortSignal.timeout(2000));
  assert.equal(s.auth.sub, 'subject'); assert.equal(s.auth.clientId, 'oaiapp_fixture'); assert.equal(s.usePlan, true);
  await assert.rejects(f.auth.callback(s, params), /Неверный/);
  const returning = await f.begin(s); assert.equal(returning.searchParams.get('client_id'), 'oaiapp_fixture');
  assert.equal(returning.searchParams.has('agent_name_hint'), false); assert.ok(returning.searchParams.get('id_token_hint'));
  await assert.rejects(f.auth.callback(s, new URLSearchParams({ state: returning.searchParams.get('state'), code: 'x', client_id: 'oaiapp_other' })), /регистрация/);
  assert.equal(s.auth.clientId, 'oaiapp_fixture');
});
test('identity login does not grant plan usage; server catalog filters models', async () => {
  for (const options of [{ identityOnly: true }, { scopes: 'openid email profile' }]) {
    const f = fixture(options), s = session(), url = await f.begin(s, !options.identityOnly);
    await f.auth.callback(s, new URLSearchParams({ state: url.searchParams.get('state'), code: 'x', client_id: 'oaiapp_fixture' }));
    await assert.rejects(f.auth.token(s), /разреши/);
  }
  const f = fixture(), s = session(), url = await f.begin(s);
  await f.auth.callback(s, new URLSearchParams({ state: url.searchParams.get('state'), code: 'x', client_id: 'oaiapp_fixture' }));
  assert.deepEqual(await f.auth.models(s), [{ slug: 'fixture-model', name: 'Fixture model' }]);
  assert.equal(s.model, 'fixture-model');
});
test('large model metadata loads without being persisted, while the catalog still has a hard size limit', async () => {
  const models = Array.from({ length: 45 }, (_, i) => ({ visibility: 'list', slug: `fixture-${i}`,
    display_name: `Fixture ${i}`, metadata: 'x'.repeat(8192) }));
  const catalog = { models };
  assert.ok(Buffer.byteLength(JSON.stringify(catalog)) > 256 * 1024);
  const f = fixture({ catalog }), s = session(), url = await f.begin(s);
  await f.auth.callback(s, new URLSearchParams({ state: url.searchParams.get('state'), code: 'x', client_id: 'oaiapp_fixture' }));
  const loaded = await f.auth.models(s);
  assert.equal(loaded.length, 40); assert.equal(s.model, 'fixture-0');
  assert.deepEqual(Object.keys(loaded[0]), ['slug', 'name']);
  assert.ok(JSON.stringify(s.models).length < 4000);
  const oversized = fixture({ catalog: { models: [{ ...models[0], metadata: 'x'.repeat(3 * 1024 * 1024) }] } });
  const b = session(), begin = await oversized.begin(b);
  await oversized.auth.callback(b, new URLSearchParams({ state: begin.searchParams.get('state'), code: 'x', client_id: 'oaiapp_fixture' }));
  await assert.rejects(oversized.auth.models(b), e => e.code === 'models_size' && /Вход сохранён/.test(e.message));
  assert.equal(b.models.length, 0); assert.equal(b.auth.accessToken, 'access-fixture');
});
test('refresh rotates atomically and failure prohibits retrying an uncertain token; logout revokes', async () => {
  const f = fixture(), s = session(), url = await f.begin(s);
  await f.auth.callback(s, new URLSearchParams({ state: url.searchParams.get('state'), code: 'x', client_id: 'oaiapp_fixture' }));
  s.auth.expiresAt = 0;
  const result = await Promise.all([f.auth.token(s), f.auth.token(s)]);
  assert.deepEqual(result, ['access-new', 'access-new']); assert.equal(s.auth.refreshToken, 'refresh-rotated');
  assert.equal(f.stats().exchanges, 2); assert.equal(f.stats().saves, 1);
  assert.equal(await f.auth.signOut(s), true); assert.equal(f.stats().revoked, 1);
  const fail = fixture({ refreshFails: true }), b = session(), login = await fail.begin(b);
  await fail.auth.callback(b, new URLSearchParams({ state: login.searchParams.get('state'), code: 'x', client_id: 'oaiapp_fixture' }));
  b.auth.expiresAt = 0; await assert.rejects(fail.auth.token(b), /отклонил/); assert.equal(b.auth.refreshToken, '');
  await assert.rejects(fail.auth.token(b), /истёк/);
  const revoke = fixture({ revokeFails: true }); b.auth.refreshToken = 'captured'; assert.equal(await revoke.auth.signOut(b), false);
});
test('real provider transport uses documented fields and one narrator call without content judges', async () => {
  const seen = [], s = { models: [{ slug: 'fixture-model' }], model: 'fixture-model' };
  const fetcher = async (url, options) => {
    assert.equal(url, `${RESOURCE}/responses`); const request = JSON.parse(options.body); seen.push(request);
    assert.deepEqual(Object.keys(request).sort(), ['model', 'instructions', 'input', 'store', 'stream'].sort());
    assert.equal(request.store, false); assert.equal(request.stream, true); assert.equal(request.input[0].role, 'user');
    assert.ok(request.instructions.startsWith('Ты ведёшь'));
    return sse({ lines: [{ actor: null, text: 'Принц решил организовать пресс-конференцию для неисправного микрофона.' }], reactions: [{ actor: 'firexrwt', text: 'Проверяем по одному.' }], memory: 'Принц предлагает пресс-конференцию.', visual: startScene('stream', 'fixture').history[0].visual });
  };
  const p = createProvider({ mode: 'chatgpt', credentials: async () => 'fixture-token', fetcher }), run = startScene('stream', 'model');
  assert.deepEqual(await p.plan(s, run, 'Беру запасной микрофон'), { actions: [], clarification: '' });
  assert.equal(seen.length, 0);
  await p.narrate(s, run, ['Предмет взят.'], '');
  assert.equal(seen.length, 1);
});

test('narrator requires the renderable response format', async () => {
  const s = { models: [{ slug: 'fixture-model' }], model: 'fixture-model' };
  const provider = createProvider({ mode: 'chatgpt', credentials: async () => 'fixture-token', fetcher: async () =>
    sse({ text: 'На столе появился золотой ключ, эфир успешно запущен', reactions: [] }) });
  await assert.rejects(provider.narrate(s, startScene('stream', 'r'), ['Эфир не запущен.'], ''), /неверный формат/);
});
test('logout during background token refresh cannot restore credentials or persist them', async () => {
  let release, started; const wait = new Promise(r => { release = r; }), begun = new Promise(r => { started = r; });
  const saved = [], revoked = [], s = session();
  s.usePlan = true; s.auth = { clientId: 'oaiapp_fixture', sub: 'subject', email: '', accessToken: 'old-access', refreshToken: 'old-refresh', scope: 'resource.invoke chatgpt.tokens.use.direct', expiresAt: 0, earliestRefreshAt: 0 };
  const oauth = createOAuth({ origin: 'http://127.0.0.1:3116', hostId: 'fixture', persist: async () => saved.push(structuredClone(s.auth)), fetcher: async (url, options = {}) => {
    if (String(url).endsWith('openid-configuration')) return json(discovery);
    if (String(url) === discovery.token_endpoint) { started(); await wait; return json({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600, scope: 'resource.invoke chatgpt.tokens.use.direct' }); }
    if (String(url) === discovery.revocation_endpoint) { revoked.push(new URLSearchParams(options.body).get('token')); return new Response(''); }
    throw new Error('unexpected fixture endpoint');
  } });
  const request = oauth.token(s); await begun;
  await oauth.signOut(s); s.auth = null; s.usePlan = false; s.sid = randomBytes(32).toString('base64url');
  release(); await assert.rejects(request, /Вход изменился/);
  assert.equal(s.auth, null); assert.deepEqual(saved, []); assert.deepEqual(revoked, ['old-refresh', 'new-refresh']);
});
