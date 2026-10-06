import { createPublicKey, verify, timingSafeEqual } from 'node:crypto';
import { boundedJson } from './responses.js';
import { StoryError } from './errors.js';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
export const sameSecret = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function verifyIdToken(token, keys, { clientId, nonce, subject, now = Date.now() / 1000 }) {
  try {
    if (typeof token !== 'string' || token.length > 16000) return null;
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit) return null;
    const jwk = keys.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256'));
    if (!jwk || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) return null;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== ISSUER || !audiences.includes(clientId) || (audiences.length > 1 && claims.azp !== clientId) ||
        !Number.isFinite(claims.exp) || claims.exp <= now - 5 || !Number.isFinite(claims.iat) || claims.iat > now + 5 ||
        (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + 5)) ||
        typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 240 ||
        (nonce !== undefined && !sameSecret(claims.nonce, nonce)) || (subject && claims.sub !== subject)) return null;
    return { sub: claims.sub, email: typeof claims.email === 'string' ? claims.email.slice(0, 160) : '' };
  } catch { return null; }
}

export function createOidc(fetcher = fetch) {
  let cache = null, keys = null, keysAt = 0, inflight = null;
  async function json(url, signal) {
    const response = await fetcher(url, { redirect: 'error', signal });
    if (!response.ok) { await response.body?.cancel(); throw new StoryError('openid', 'Не удалось проверить вход через ChatGPT.', 502); }
    return boundedJson(response);
  }
  return {
    async discovery(signal) {
      if (cache) return cache;
      const d = await json(`${ISSUER}/.well-known/openid-configuration`, signal);
      if (d.issuer !== ISSUER || d.authorization_endpoint !== `${ISSUER}/api/accounts/authorize` ||
          d.token_endpoint !== `${ISSUER}/api/accounts/oauth/token` || d.jwks_uri !== `${ISSUER}/.well-known/jwks.json`) throw new StoryError('openid', 'Неподтверждённая конфигурация OpenAI.', 502);
      cache = d; return d;
    },
    async validate(token, expected, signal) {
      await this.discovery(signal);
      async function refresh() {
        if (!inflight) inflight = json(cache.jwks_uri, signal).then(result => {
          if (!Array.isArray(result.keys) || result.keys.length > 30) throw new StoryError('openid', 'Неверные ключи OpenAI.', 502);
          keys = result.keys; keysAt = Date.now();
        }).finally(() => { inflight = null; });
        await inflight;
      }
      if (!keys || Date.now() - keysAt > 300000) await refresh();
      let result = verifyIdToken(token, keys, expected);
      if (!result) { await refresh(); result = verifyIdToken(token, keys, expected); }
      if (!result) throw new StoryError('identity', 'Не удалось подтвердить личность ChatGPT. Начни вход заново.', 401);
      return result;
    },
  };
}
