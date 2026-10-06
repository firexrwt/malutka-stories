import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createStorage } from './storage.js';
import { createService } from './service.js';
import { createProvider } from './provider.js';
import { createOAuth } from './oauth.js';
import { catalog } from './scenes.js';
import { StoryError } from './errors.js';
import { sendStory, readBody, readSession, cookieHeader, mutationGuard, requestSignal } from './http.js';

export async function createStories({ host, port, env = process.env, directory, fetcher = fetch }) {
  const enabled = env.MALUTKA_STORIES_LOCAL === '1';
  const mode = enabled ? (env.MALUTKA_STORIES_TEST === '1' ? 'test' : 'chatgpt') : 'unavailable';
  if (enabled && (host !== '127.0.0.1' || env.NODE_ENV === 'production')) throw new Error('Stories OAuth/test mode is local-only: HOST=127.0.0.1, no production mode');
  const origin = `http://127.0.0.1:${port}`;
  let service, oauth;
  if (enabled) {
    const root = directory === undefined ? fileURLToPath(new URL('../../.local/stories/', import.meta.url)) : directory;
    // Fixture text and credentials must never cross the test/ChatGPT boundary.
    const storage = await createStorage(root ? join(root, mode) : root);
    oauth = createOAuth({ origin, hostId: storage.hostId, persist: () => service.persist(), fetcher });
    const provider = createProvider({ mode, credentials: (s, signal) => oauth.token(s, signal), fetcher });
    service = await createService({ storage, provider });
  }
  return async function route(req, res) {
    const path = (req.url || '').split('?')[0];
    if (!path.startsWith('/api/stories/') && path !== '/auth/callback') return false;
    try {
      if (req.url.length > 8192) throw new StoryError('url', 'Слишком длинный запрос.', 414);
      if (!enabled) {
        if (path === '/api/stories/session' && req.method === 'GET') sendStory(res, 200, { mode, scenes: catalog(),
          localUrl: 'http://127.0.0.1:3116/games/stories/', run: null, models: [], account: null });
        else sendStory(res, 503, { error: 'web_access_pending', message: 'Публичный вход через ChatGPT ожидает официального доступа. Используй локальный сервис.' });
        return true;
      }
      if (req.headers.host !== new URL(origin).host) throw new StoryError('host', 'Открой демку по адресу 127.0.0.1.', 403);
      let session = service.get(readSession(req, origin));
      if (path === '/api/stories/session' && req.method === 'GET') {
        if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site' ||
            (!req.headers.origin && req.headers['sec-fetch-site'] !== 'same-origin')) {
          throw new StoryError('origin', 'Открой демку на своём компьютере.', 403);
        }
        if (!session) { session = await service.create(); res.setHeader('set-cookie', cookieHeader(origin, session.sid)); }
        sendStory(res, 200, service.info(session)); return true;
      }
      if (path === '/auth/callback' && req.method === 'GET') {
        if (!session || mode !== 'chatgpt') throw new StoryError('session', 'Нет ожидающего входа. Вернись в демку.', 401);
        await service.exclusive(session, async () => {
          await oauth.callback(session, new URL(req.url, origin).searchParams, AbortSignal.timeout(20000));
          await service.rotate(session);
        }, { charged: false });
        res.writeHead(303, { location: '/games/stories/?connected=1', 'set-cookie': cookieHeader(origin, session.sid),
          'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end(); return true;
      }
      if (req.method !== 'POST') throw new StoryError('method', 'Метод не поддерживается.', 405);
      mutationGuard(req, session, origin);
      const signal = requestSignal(req, res, ['/api/stories/turn', '/api/stories/start', '/api/stories/characters'].includes(path) ? 120000 : 20000);
      const body = await readBody(req);
      let result;
      if (path === '/api/stories/start') result = await service.start(session, body.scene, signal);
      else if (path === '/api/stories/turn') result = await service.turn(session, body, signal);
      else if (path === '/api/stories/characters') result = await service.addCharacter(session, body, signal);
      else if (path === '/api/stories/auth/start' && mode === 'chatgpt') {
        if (typeof body.usePlan !== 'boolean') throw new StoryError('consent', 'Выбери, разрешать ли запросы по подписке.');
        result = await service.exclusive(session, async () => ({ url: await oauth.begin(session, body.usePlan, signal) }));
      } else if (path === '/api/stories/models' && mode === 'chatgpt') {
        result = await service.exclusive(session, async () => {
          await oauth.models(session, signal); return service.info(session);
        });
      } else if (path === '/api/stories/model' && mode === 'chatgpt') {
        result = await service.exclusive(session, async () => {
          if (!session.models.some(m => m.slug === body.model)) throw new StoryError('model', 'Такая модель недоступна.');
          session.model = body.model; await service.persist(); return service.info(session);
        });
      } else if (path === '/api/stories/logout') {
        result = await service.exclusive(session, async () => {
          session.usePlan = false;
          const revoked = await oauth.signOut(session, AbortSignal.timeout(8000));
          oauth.cancel(session.sid); session.auth = null; session.usePlan = false; session.models = []; session.model = '';
          session.run = null; await service.rotate(session); res.setHeader('set-cookie', cookieHeader(origin, session.sid));
          return { ...service.info(session), revocationWarning: !revoked };
        });
      } else throw new StoryError('route', 'Неизвестный запрос.', 404);
      res.setHeader('set-cookie', cookieHeader(origin, session.sid));
      sendStory(res, 200, result);
    } catch (error) {
      if (res.destroyed) return true;
      const safe = error instanceof StoryError;
      if (!safe) console.error(`stories: ${error.name === 'TimeoutError' || error.name === 'AbortError' ? 'timeout' : 'request_failed'}`);
      sendStory(res, safe ? error.status : 503, { error: safe ? error.code : 'unavailable',
        message: safe ? error.message : 'Не удалось завершить запрос. Сохранение осталось на месте; повтори ход.' });
    }
    return true;
  };
}
