import { sameSecret } from './oidc.js';
import { StoryError } from './errors.js';

export function requestSignal(req, res, duration) {
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException('Client disconnected', 'AbortError'));
  const close = () => { if (!res.writableEnded) abort(); dispose(); };
  function dispose() { req.off?.('aborted', abort); res.off?.('close', close); res.off?.('finish', dispose); }
  req.once?.('aborted', abort); res.once?.('close', close); res.once?.('finish', dispose);
  if (req.aborted || res.destroyed) abort();
  return AbortSignal.any([controller.signal, AbortSignal.timeout(duration)]);
}

export function sendStory(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers });
  res.end(JSON.stringify(data));
}
export const cookieName = origin => `malutka_stories_${new URL(origin).port}`;
export const cookieHeader = (origin, sid) => `${cookieName(origin)}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`;
export function readSession(req, origin) {
  const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName(origin)}=`));
  const value = cookie?.slice(cookie.indexOf('=') + 1);
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
}
export async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new StoryError('content_type', 'Ожидался JSON.');
  if (Number(req.headers['content-length']) > 4096) throw new StoryError('body_size', 'Действие слишком длинное.', 413);
  let bytes = 0; const chunks = [];
  const deadline = setTimeout(() => req.destroy(), 5000); deadline.unref();
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 4096) throw new StoryError('body_size', 'Действие слишком длинное.', 413);
      chunks.push(chunk);
    }
  } finally { clearTimeout(deadline); }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new StoryError('json', 'Неверный формат действия.'); }
}
export function mutationGuard(req, session, origin) {
  if (!session || req.headers.origin !== origin || !sameSecret(req.headers['x-story-csrf'], session.csrf)) {
    throw new StoryError('session', 'Сессия недоступна. Обнови страницу.', 403);
  }
}
