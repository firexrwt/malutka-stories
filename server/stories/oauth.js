import { randomBytes, createHash } from 'node:crypto';
import { createOidc, sameSecret, ISSUER, RESOURCE } from './oidc.js';
import { boundedJson } from './responses.js';
import { StoryError } from './errors.js';
import { LIMITS } from './limits.js';

const random = () => randomBytes(32).toString('base64url');
const usable = scope => typeof scope === 'string' && ['resource.invoke', 'chatgpt.tokens.use.direct'].every(s => scope.split(' ').includes(s));
const issued = id => typeof id === 'string' && /^oaiapp_[A-Za-z0-9_-]{1,180}$/.test(id);

export function createOAuth({ origin, hostId, persist, fetcher = fetch }) {
  const oidc = createOidc(fetcher), pending = new Map(), refreshing = new Map(), epochs = new WeakMap();
  const redirectUri = `${origin}/auth/callback`;

  async function exchange(values, signal, identityOnly = false) {
    const d = await oidc.discovery(signal);
    const response = await fetcher(d.token_endpoint, { method: 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...values, resource: RESOURCE }).toString() });
    if (!response.ok) {
      await response.body?.cancel();
      throw new StoryError('token_exchange', 'ChatGPT отклонил вход или обновление доступа. Начни вход заново.', 401);
    }
    const tokens = await boundedJson(response);
    if ((!identityOnly && (typeof tokens.access_token !== 'string' || !tokens.access_token || tokens.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(tokens.expires_in))) ||
        (tokens.access_token !== undefined && (typeof tokens.access_token !== 'string' || tokens.access_token.length > 16000)) ||
        (tokens.expires_in !== undefined && (tokens.expires_in < 1 || tokens.expires_in > 86400)) ||
        (!identityOnly && typeof tokens.scope !== 'string') || (tokens.scope !== undefined && (typeof tokens.scope !== 'string' || tokens.scope.length > 2000)) ||
        (tokens.refresh_token !== undefined && (typeof tokens.refresh_token !== 'string' || tokens.refresh_token.length > 16000))) {
      throw new StoryError('token_response', 'Не удалось проверить доступ ChatGPT.', 502);
    }
    return tokens;
  }

  function account(tokens, identity, clientId) {
    return { ...identity, clientId, accessToken: tokens.access_token || '', refreshToken: tokens.refresh_token || '',
      idToken: tokens.id_token || '', scope: tokens.scope || 'openid profile email', expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
      earliestRefreshAt: typeof tokens.earliest_refresh_at === 'number' ? tokens.earliest_refresh_at * 1000 : 0 };
  }

  async function token(session, signal) {
    const auth = session.auth;
    if (!auth || !session.usePlan || !usable(auth.scope)) throw new StoryError('plan_permission', 'Войди через ChatGPT и разреши использование подписки.', 401);
    if (auth.expiresAt > Date.now() + 30000) return auth.accessToken;
    if (!auth.refreshToken || auth.earliestRefreshAt > Date.now()) throw new StoryError('expired', 'Доступ истёк. Войди через ChatGPT снова.', 401);
    const sid = session.sid, epoch = epochs.get(session) || 0;
    if (!refreshing.has(sid)) {
      const job = (async () => {
        const tokens = await exchange({ grant_type: 'refresh_token', client_id: auth.clientId, refresh_token: auth.refreshToken }, signal);
        if (!tokens.refresh_token || !usable(tokens.scope)) throw new StoryError('refresh', 'Не удалось обновить разрешение подписки. Войди снова.', 401);
        if (tokens.id_token) await oidc.validate(tokens.id_token, { clientId: auth.clientId, subject: auth.sub }, signal);
        const replacement = account({ ...tokens, id_token: tokens.id_token || auth.idToken }, { sub: auth.sub, email: auth.email }, auth.clientId);
        if (session.sid !== sid || session.auth !== auth || (epochs.get(session) || 0) !== epoch) {
          await revoke(replacement, AbortSignal.timeout(8000));
          throw new StoryError('auth_changed', 'Вход изменился во время запроса. Подключись заново.', 401);
        }
        session.auth = replacement;
        await persist();
        return session.auth.accessToken;
      })().catch(async error => {
        // A rotating refresh may have been consumed: never blindly retry it.
        if (session.auth === auth && (epochs.get(session) || 0) === epoch) {
          session.auth = { ...auth, accessToken: '', refreshToken: '', expiresAt: 0 }; await persist();
        }
        throw error;
      }).finally(() => refreshing.delete(sid));
      refreshing.set(sid, job);
    }
    return refreshing.get(sid);
  }

  async function revoke(auth, signal) {
    if (!auth?.refreshToken) return true;
    try {
      const d = await oidc.discovery(signal), endpoint = new URL(d.revocation_endpoint);
      if (endpoint.origin !== ISSUER || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return false;
      const response = await fetcher(endpoint.href, { method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: auth.refreshToken, token_type_hint: 'refresh_token', client_id: auth.clientId }).toString() });
      await response.body?.cancel(); return response.ok;
    } catch { return false; }
  }

  return {
    token,
    cancel(sid) { pending.delete(sid); },
    async signOut(session, signal) {
      epochs.set(session, (epochs.get(session) || 0) + 1);
      return revoke(session.auth, signal);
    },
    async begin(session, usePlan, signal) {
      for (const [sid, p] of pending) if (p.expiresAt < Date.now()) pending.delete(sid);
      const d = await oidc.discovery(signal);
      const prior = session.auth;
      const state = random(), nonce = random(), verifier = random();
      const clientId = prior?.clientId || 'dynamic_agent_client';
      pending.set(session.sid, { state, nonce, verifier, clientId, usePlan, subject: prior?.sub,
        expiresAt: Date.now() + 600000 });
      const params = new URLSearchParams({ client_id: clientId, ext_agent_host_id: hostId,
        response_type: 'code', redirect_uri: redirectUri, resource: RESOURCE,
        scope: usePlan ? 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' : 'openid profile email',
        state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
      if (clientId === 'dynamic_agent_client') params.set('agent_name_hint', 'Малютка: ИИ-истории');
      else if (prior?.idToken) params.set('id_token_hint', prior.idToken);
      return `${d.authorization_endpoint}?${params}`;
    },
    async callback(session, params, signal) {
      const p = pending.get(session.sid);
      if (!p || p.expiresAt < Date.now() || !sameSecret(params.get('state'), p.state)) throw new StoryError('oauth_state', 'Неверный или просроченный вход. Начни заново.', 401);
      pending.delete(session.sid);
      if (params.has('error')) throw new StoryError('oauth_denied', 'Вход или разрешение отклонены. Можно вернуться и попробовать снова.', 401);
      if (['code', 'state', 'client_id'].some(k => params.getAll(k).length > 1)) throw new StoryError('oauth_params', 'Повреждённый ответ входа.', 401);
      const clientId = params.get('client_id') || (p.clientId === 'dynamic_agent_client' ? null : p.clientId);
      if (!issued(clientId) || (p.clientId !== 'dynamic_agent_client' && clientId !== p.clientId)) throw new StoryError('oauth_client', 'Не подтверждена регистрация приложения в ChatGPT.', 401);
      const code = params.get('code');
      if (typeof code !== 'string' || !code || code.length > 4096) throw new StoryError('oauth_code', 'Вход не завершён. Начни заново.', 401);
      const tokens = await exchange({ grant_type: 'authorization_code', client_id: clientId, code,
        code_verifier: p.verifier, redirect_uri: redirectUri }, signal, !p.usePlan);
      const identity = await oidc.validate(tokens.id_token, { clientId, nonce: p.nonce, subject: p.subject }, signal);
      epochs.set(session, (epochs.get(session) || 0) + 1);
      session.auth = account(tokens, identity, clientId); session.usePlan = p.usePlan;
      session.models = []; session.model = '';
      return usable(tokens.scope) && p.usePlan;
    },
    async models(session, signal) {
      const accessToken = await token(session, signal);
      const response = await fetcher(`${RESOURCE}/models`, { redirect: 'error', signal, headers: { 'authorization': `Bearer ${accessToken}` } });
      if (!response.ok) { await response.body?.cancel(); throw new StoryError('models', 'Не удалось получить модели твоего аккаунта ChatGPT.', 502); }
      let result;
      try { result = await boundedJson(response, LIMITS.catalogBytes); }
      catch (error) {
        if (error.code === 'provider_size') throw new StoryError('models_size', 'Не удалось загрузить каталог моделей ChatGPT: ответ превысил лимит. Вход сохранён; нажми «ЗАГРУЗИТЬ МОДЕЛИ».', 502);
        throw error;
      }
      if (!Array.isArray(result.models)) throw new StoryError('models', 'ChatGPT вернул неверный каталог моделей.', 502);
      const models = result.models.slice(0, 200).filter(m => m && m.visibility === 'list' && typeof m.slug === 'string' &&
        /^[A-Za-z0-9_.:-]{1,100}$/.test(m.slug) && typeof m.display_name === 'string' && m.display_name.length <= 160)
        .slice(0, LIMITS.models).map(m => ({ slug: m.slug, name: m.display_name }));
      if (!models.length) throw new StoryError('models', 'Для аккаунта пока нет доступных моделей.', 409);
      session.models = models;
      session.model = models.some(m => m.slug === session.model) ? session.model : models[0].slug;
      await persist(); return models;
    },
  };
}
