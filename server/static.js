import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.webp', 'image/webp'],
]);
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
export function send(res, status, body, headers = {}, head = false) {
  res.writeHead(status, { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY', 'content-security-policy': csp, ...headers });
  res.end(head ? undefined : body);
}
export async function serveStatic(req, res) {
  const head = req.method === 'HEAD';
  if (req.method !== 'GET' && !head) return send(res, 405, 'method not allowed', { allow: 'GET, HEAD' });
  const path = (req.url || '/').split('?')[0];
  if (path === '/' || path === '/games/stories') return send(res, 302, '', { location: '/games/stories/', 'cache-control': 'no-store' }, head);
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { return send(res, 400, 'bad path', {}, head); }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(part => part === '..' || part.startsWith('.')))
    return send(res, 400, 'bad path', {}, head);
  const file = resolve(root, `.${decoded === '/games/stories/' ? '/games/stories/index.html' : decoded}`);
  const type = mime.get(extname(file));
  if (!file.startsWith(resolve(root) + sep) || !type) return send(res, 404, 'not found', {}, head);
  try {
    const actual = await realpath(file), info = await stat(actual);
    if (!actual.startsWith(resolve(root) + sep) || !info.isFile()) return send(res, 404, 'not found', {}, head);
    const code = ['.html', '.js', '.css'].includes(extname(file));
    send(res, 200, head ? undefined : await readFile(actual), { 'content-type': type, 'content-length': info.size,
      'cache-control': code ? 'no-cache' : 'public, max-age=86400' }, head);
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) console.error('stories: static_read_failed');
    send(res, 404, 'not found', {}, head);
  }
}
