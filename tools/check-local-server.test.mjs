import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, localPort } from '../server/index.js';

const app = await createApp({ testMode: true, directory: null });
async function request(url, { method = 'GET', host = '127.0.0.1:3116' } = {}) {
  const result = { headers: {} };
  await app({ url, method, headers: { host, 'sec-fetch-site': 'same-origin' } }, {
    setHeader(name, value) { result.headers[name] = value; },
    writeHead(status, headers) { result.status = status; Object.assign(result.headers, headers); },
    end(body) { result.body = body; },
  });
  return result;
}
test('standalone redirects to the directory entry and serves every first-load asset', async () => {
  for (const path of ['/', '/games/stories']) {
    const r = await request(path); assert.equal(r.status, 302); assert.equal(r.headers.location, '/games/stories/');
  }
  for (const path of ['/games/stories/', '/games/stories/main.js', '/games/stories/stories.css', '/css/tokens.css',
    '/games/shell.css', '/assets/logo.svg', '/games/stories/assets/arbuz-neutral-v2.webp']) {
    const r = await request(path); assert.equal(r.status, 200, path); assert.ok(r.body.length);
    assert.equal(r.headers['x-content-type-options'], 'nosniff'); assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  }
  assert.equal((await request('/games/stories/main.js')).headers['cache-control'], 'no-cache');
});
test('HEAD has headers without body and unsupported methods do not expose files', async () => {
  const r = await request('/games/stories/', { method: 'HEAD' });
  assert.equal(r.status, 200); assert.equal(r.body, undefined); assert.ok(r.headers['content-length'] > 100);
  assert.equal((await request('/games/stories/main.js', { method: 'POST' })).status, 405);
});
test('project files, storage, traversal and foreign Host are never served', async () => {
  for (const path of ['/server/stories/oauth.js', '/.local/stories/chatgpt/sessions.json', '/package.json', '/README.md',
    '/../server/index.js', '/%2e%2e/server/index.js', '/%2e%2e%5cserver/index.js', '/%00', '/%broken']) {
    assert.ok([400, 404].includes((await request(path)).status), path);
  }
  assert.equal((await request('/', { host: 'attacker.invalid' })).status, 403);
  assert.equal((await request('/' + 'a'.repeat(8192))).status, 414);
});
test('standalone mounts the existing session API in explicit test mode', async () => {
  const r = await request('/api/stories/session');
  assert.equal(r.status, 200); assert.equal(JSON.parse(r.body).mode, 'test');
  assert.equal((await request('/api/health')).status, 200);
});
test('port configuration stays outside privileged and invalid ranges', () => {
  assert.equal(localPort(), 3116); assert.equal(localPort('3117'), 3117);
  for (const value of ['0', '80', '65536', '-1', '3116abc', '', 'NaN']) assert.throws(() => localPort(value));
});
