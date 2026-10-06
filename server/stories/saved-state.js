import { SCENES, startScene } from './scenes.js';
import { validNarration, shortText, validPlan } from './protocol.js';
import { LIMITS } from './limits.js';
import { validDirection } from '../../public/games/stories/director.js';
import { NPC } from '../../public/games/stories/art-library.js';
import { runCast, validCharacters } from './participants.js';

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const opaque = v => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
const id = v => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const token = v => typeof v === 'string' && v.length <= 16000;
export function validSavedRun(run) {
  try {
    if (!plain(run) || !SCENES.has(run.scene) || !id(run.id) || !Number.isSafeInteger(run.turn) || run.turn < 0 ||
        !Number.isSafeInteger(run.version) || run.version < run.turn || !id(run.seed) ||
        !shortText(run.memory, 1200) || !Array.isArray(run.guests) || run.guests.length > 2 ||
        new Set(run.guests).size !== run.guests.length || run.guests.some(actor => !NPC.has(actor)) || !['pending', 'achieved'].includes(run.goalStatus) ||
        !['active', 'finished'].includes(run.status) || (run.outcome !== null && !shortText(run.outcome, 500)) ||
        !Array.isArray(run.objects) || !plain(run.facts) || !Array.isArray(run.history) || !run.history.length || run.history.length > 12 ||
        !Array.isArray(run.receipts) || run.receipts.length !== Math.min(run.version, LIMITS.receipts)) return false;
    const scene = SCENES.get(run.scene), base = startScene(run.scene, run.id);
    if (!validCharacters(run)) return false;
    const members = runCast(run), cast = members.map(m => m.id);
    if (run.objects.length !== base.objects.length || run.objects.some((o, i) => !plain(o) || o.id !== base.objects[i].id ||
      o.name !== base.objects[i].name || o.portable !== base.objects[i].portable || !['table', 'inventory', 'channel', 'desk'].includes(o.place))) return false;
    const f = run.facts;
    if (Object.keys(f).length !== Object.keys(base.facts).length) return false;
    for (const [key, value] of Object.entries(base.facts)) {
      if (typeof value === 'boolean' && typeof f[key] !== 'boolean') return false;
    }
    if (run.scene === 'stream' && (!['broken_mic', 'spare_mic'].includes(f.mic) ||
      (f.tested && (!f.cable || (f.mic === 'broken_mic' && !f.repaired))) || (f.live && run.goalStatus !== 'achieved'))) return false;
    if (run.scene !== 'stream' && (!Array.isArray(f.support) || f.support.length > 3 || new Set(f.support).size !== f.support.length ||
      f.support.some(actor => !scene.cast.includes(actor)))) return false;
    if (run.scene === 'meeting' && (!['uninvited', 'guest', 'outside'].includes(f.arbuz) || ![null, 'arbuz', 'mzberg'].includes(f.chair))) return false;
    if (run.scene === 'board' && (!['control', 'retain', 'title'].includes(f.proposal) || !plain(f.shares) ||
      Object.keys(f.shares).length !== 3 || Object.entries(base.facts.shares).some(([k, v]) => f.shares[k] !== v))) return false;
    if (run.history.some(h => !plain(h) || !shortText(h.player, 600) || !shortText(h.clarification, 240) || !validNarration(h, cast) ||
      (h.speaker !== undefined && h.speaker !== 'player' && !cast.includes(h.speaker)) ||
      !validDirection(h.visual, members, base.objects.map(o => o.id)) ||
      !Array.isArray(h.events) || h.events.length > 6 || h.events.some(e => !shortText(e, 600)) ||
      (h.actions && !validPlan({ actions: h.actions, clarification: h.clarification })))) return false;
    if (run.receipts.some(r => !plain(r) || !/^[A-Za-z0-9-]{16,64}$/.test(r.id) || !/^[a-f0-9]{64}$/.test(r.digest) ||
      (r.digestVersion !== undefined && r.digestVersion !== 2) ||
      (r.kind !== undefined && !['turn', 'character'].includes(r.kind)) || (r.kind === 'character' && !cast.includes(r.actor)))) return false;
    return new Set(run.receipts.map(r => r.id)).size === run.receipts.length;
  } catch { return false; }
}
export function validSavedSession(s) {
  try {
    if (!plain(s) || !opaque(s.sid) || !opaque(s.csrf) || !Number.isFinite(s.expiresAt) || s.expiresAt <= Date.now() ||
        typeof s.usePlan !== 'boolean' || !Array.isArray(s.models) || s.models.length > LIMITS.models || typeof s.model !== 'string' || s.model.length > 100 ||
        (s.run !== null && !validSavedRun(s.run))) return false;
    if (s.models.some(m => !plain(m) || !/^[A-Za-z0-9_.:-]{1,100}$/.test(m.slug) || !shortText(m.name, 160))) return false;
    if (s.auth !== null && (!plain(s.auth) || !/^oaiapp_[A-Za-z0-9_-]{1,180}$/.test(s.auth.clientId) || !shortText(s.auth.sub, 240) || !s.auth.sub ||
      !shortText(s.auth.email, 160) || !token(s.auth.accessToken) || !token(s.auth.refreshToken) || !token(s.auth.idToken) || !shortText(s.auth.scope, 2000) ||
      !Number.isFinite(s.auth.expiresAt) || !Number.isFinite(s.auth.earliestRefreshAt))) return false;
    return true;
  } catch { return false; }
}
