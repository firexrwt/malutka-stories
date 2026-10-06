import { randomBytes, randomUUID } from 'node:crypto';
import { catalog, startScene, SCENES } from './scenes.js';
import { execute, view } from './engine.js';
import { StoryError } from './errors.js';
import { shortText } from './protocol.js';
import { validSavedSession } from './saved-state.js';
import { LIMITS } from './limits.js';
import { runCast, availableSpeaker, characterChoices, validSelection, joinCharacter, MAX_CAST } from './participants.js';
import { digest, mutation, currentMutation } from './mutations.js';

const opaque = () => randomBytes(32).toString('base64url');
export const SESSION_TTL = 8 * 3600000;
export async function createService({ storage, provider, maxSessions = LIMITS.sessions }) {
  const sessions = new Map(), busy = new Set(); let active = 0, migrated = false;
  const stored = await storage.load();
  for (const s of (Array.isArray(stored) ? stored : []).slice(0, maxSessions)) {
    if (validSavedSession(s)) {
      if (s.run?.status === 'finished') { s.run.status = 'active'; s.run.outcome = null; migrated = true; }
      sessions.set(s.sid, s);
    }
    else console.error('stories: saved_session_invalid_or_expired');
  }
  let commitQueue = Promise.resolve();
  function serialize(work) {
    const result = commitQueue.then(work); commitQueue = result.catch(() => {}); return result;
  }
  const write = () => storage.save([...sessions.values()]);
  const persist = () => serialize(write);
  // Erase rejected/expired snapshots on startup as well as from the in-memory map.
  if (migrated || stored.length !== sessions.size) await persist();
  const commitRun = (session, run) => serialize(async () => {
    const prior = session.run, expiry = session.expiresAt; session.run = run; session.expiresAt = Date.now() + SESSION_TTL;
    try { await write(); } catch (error) { session.run = prior; session.expiresAt = expiry; throw error; }
  });
  function clean() {
    let changed = false;
    for (const [id, s] of sessions) if (s.expiresAt < Date.now() && !busy.has(id)) { sessions.delete(id); changed = true; }
    if (changed) void persist().catch(() => console.error('stories: expired_session_cleanup_failed'));
  }
  function get(sid) { clean(); return sessions.get(sid) || null; }
  function info(session) {
    return { mode: provider.mode, scenes: catalog(), csrf: session?.csrf || '', run: view(session?.run),
      account: session?.auth ? { email: session.auth.email, connected: !!session.auth.accessToken,
        planAllowed: !!session.usePlan && session.auth.scope.split(' ').includes('chatgpt.tokens.use.direct') } : null,
      models: session?.models || [], model: session?.model || '', characters: characterChoices(), maxCast: MAX_CAST };
  }
  async function exclusive(session, work, { charged = true } = {}) {
    if (busy.has(session.sid)) throw new StoryError('busy', 'Предыдущий запрос ещё выполняется. Подожди.', 409);
    if (active >= 2) throw new StoryError('overloaded', 'Сервис занят. Повтори через несколько секунд.', 429);
    if (charged && Date.now() - (session.lastRequest || 0) < 1200) throw new StoryError('rate', 'Слишком быстро. Подожди секунду.', 429);
    const sid = session.sid;
    busy.add(sid); active++; if (charged) session.lastRequest = Date.now();
    try { return await work(); } finally { busy.delete(sid); active--; }
  }
  return {
    get, info, persist, exclusive,
    async create() {
      clean();
      if (sessions.size >= maxSessions) throw new StoryError('capacity', 'Демка достигла лимита сессий. Попробуй позже.', 503);
      const s = { sid: opaque(), csrf: opaque(), expiresAt: Date.now() + SESSION_TTL, run: null,
        auth: null, usePlan: false, models: [], model: '' };
      sessions.set(s.sid, s);
      try { await persist(); } catch (error) { sessions.delete(s.sid); throw error; }
      return s;
    },
    async rotate(session) {
      const sid = session.sid, csrf = session.csrf;
      sessions.delete(sid); session.sid = opaque(); session.csrf = opaque(); sessions.set(session.sid, session);
      try { await persist(); } catch (error) { sessions.delete(session.sid); session.sid = sid; session.csrf = csrf; sessions.set(sid, session); throw error; }
    },
    async start(session, scene, signal = AbortSignal.timeout(120000)) {
      return exclusive(session, async () => {
        const run = startScene(scene, randomUUID());
        if (!run) throw new StoryError('scene', 'Такой истории нет.', 404);
        const opening = await provider.narrate(session, run, [], '', signal);
        signal?.throwIfAborted();
        run.memory = opening.memory;
        run.history = [{ player: '', ...opening, events: [], clarification: '' }];
        await commitRun(session, run);
        return info(session);
      });
    },
    async turn(session, body, signal) {
      if (!body || !shortText(body.text, 600) || !body.text.trim() || (body.speaker !== undefined && !shortText(body.speaker, 80))) throw new StoryError('input', 'Введи действие длиной до 600 знаков.');
      const speaker = body.speaker ?? 'player';
      const hash = digest(JSON.stringify({ kind: 'turn', text: body.text, speaker }));
      const { run, replay } = mutation(session, body, hash, 'turn', speaker === 'player' ? digest(body.text) : null);
      if (replay) return { ...info(session), replay: true };
      return exclusive(session, async () => {
        currentMutation(run, body);
        if (!availableSpeaker(run, speaker)) throw new StoryError('speaker', 'Этого персонажа сейчас нет в сцене. Выбери другого.', 409);
        const plan = await provider.plan(session, run, body.text, signal, speaker);
        plan.actions = plan.actions.map(a => ({ ...a, by: a.by === 'player' ? speaker : a.by }));
        signal?.throwIfAborted();
        const { next, events, clarification } = provider.mode === 'test' ? execute(run, plan) :
          { next: { ...structuredClone(run), turn: run.turn + 1 }, events: [], clarification: '' };
        const narrative = await provider.narrate(session, next, events, clarification, signal, body.text, plan.actions, speaker);
        signal?.throwIfAborted();
        next.memory = narrative.memory;
        next.version++;
        next.history.push({ player: body.text, speaker, ...narrative, events, clarification, actions: plan.actions });
        next.history = next.history.slice(-12);
        next.receipts.push({ id: body.requestId, digest: hash, digestVersion: 2, kind: 'turn' });
        next.receipts = next.receipts.slice(-LIMITS.receipts);
        await commitRun(session, next);
        return info(session);
      });
    },
    async addCharacter(session, body, signal) {
      const selection = validSelection(body?.selection);
      if (!selection) throw new StoryError('character_input', 'Выбери готового героя или укажи имя до 60 знаков и описание до 240 знаков.');
      const hash = digest(JSON.stringify({ kind: 'character', selection })), { run, replay } = mutation(session, body, hash, 'character', digest(JSON.stringify(selection)));
      if (replay) return { ...info(session), replay: true, addedActor: run.receipts.find(r => r.id === body.requestId).actor };
      return exclusive(session, async () => {
        currentMutation(run, body);
        if (runCast(run).length >= MAX_CAST) throw new StoryError('cast_limit', 'В сцене уже восемь участников.', 409);
        const character = selection.mode === 'ready' ? { kind: 'ready', id: selection.ready } :
          await provider.character(session, run, selection, runCast(run), signal);
        signal?.throwIfAborted();
        const next = joinCharacter(run, character);
        if (!next) throw new StoryError('character_duplicate', 'Этот герой или такое имя уже есть в сцене. Выбери другое.', 409);
        const member = runCast(next).find(m => m.id === character.id), event = `В сцену входит ${member.name}.`;
        const visual = structuredClone(run.history.at(-1).visual);
        visual.actors = [...visual.actors.filter(a => a.id !== 'arbuz' || run.facts.arbuz !== 'outside').slice(0, 4),
          { id: member.id, x: 50, y: 78, facing: 'front', variant: 'neutral' }];
        visual.actors.forEach((a, i) => { a.x = 18 + i * 64 / Math.max(1, visual.actors.length - 1); });
        visual.camera = 'medium'; visual.focus = member.id; visual.caption = event;
        next.version++;
        const events = [event];
        next.history.push({ player: '', speaker: 'player', text: events.map(e => `*${e}*`).join('\n'), reactions: [], visual, events, clarification: '' });
        next.history = next.history.slice(-12);
        next.receipts.push({ id: body.requestId, digest: hash, digestVersion: 2, kind: 'character', actor: member.id });
        next.receipts = next.receipts.slice(-LIMITS.receipts);
        await commitRun(session, next);
        return { ...info(session), addedActor: member.id };
      });
    },
  };
}
