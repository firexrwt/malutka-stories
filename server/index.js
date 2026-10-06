import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStories } from './stories/index.js';
import { send, serveStatic } from './static.js';

export function localPort(value = '3116') {
  if (!/^\d{4,5}$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw new Error('PORT должен быть от 1024 до 65535.');
  return Number(value);
}
export async function createApp({ port = 3116, testMode = false, directory } = {}) {
  localPort(String(port));
  const host = '127.0.0.1', expected = `${host}:${port}`;
  const stories = await createStories({ host, port, directory,
    env: { ...process.env, MALUTKA_STORIES_LOCAL: '1', MALUTKA_STORIES_TEST: testMode ? '1' : '0' } });
  return async (req, res) => {
    try {
      if (req.headers.host !== expected) return send(res, 403, 'Открой демку по адресу 127.0.0.1.');
      if ((req.url || '').length > 8192) return send(res, 414, 'request too long');
      if (await stories(req, res)) return;
      if (req.url === '/api/health' && req.method === 'GET') return send(res, 200, '{"ok":true}', { 'content-type': 'application/json', 'cache-control': 'no-store' });
      await serveStatic(req, res);
    } catch {
      console.error('stories: request_failed');
      if (!res.headersSent && !res.destroyed) send(res, 500, 'Не удалось завершить запрос.');
      else if (!res.destroyed) res.end();
    }
  };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--test')) throw new Error('Поддерживается только --test.');
  const port = localPort(process.env.PORT), handler = await createApp({ port, testMode: process.argv.includes('--test') });
  const server = createServer(handler);
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Порт ${port} уже занят. Останови другую локальную демку или выбери PORT.` : 'Не удалось запустить локальную демку.');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`Малютки потеряли повестку: http://127.0.0.1:${port}/games/stories/`));
}
