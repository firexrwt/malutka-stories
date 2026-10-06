export const COMMANDS = Object.freeze(Object.fromEntries(Object.entries({
  inspect: ['target'], take: ['target'], connect: ['target', 'channel'],
  ask: ['actor', 'task'], say: ['actor', 'text'], propose: ['option'],
  show: ['target', 'actor'], begin: [], finish: [], introduce: ['actor'],
}).map(([type, keys]) => [type, ['by', ...keys]])));
const known = new Map(Object.entries(COMMANDS));
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const SCRIPT_LINES = 16, NARRATION_CONTENT_LIMIT = 900, NARRATION_TEXT_LIMIT = 2100;
export const shortText = (v, max = 600) => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);

export function validPlan(value) {
  if (!plain(value) || !Array.isArray(value.actions) || value.actions.length > 5 || !shortText(value.clarification, 240)) return null;
  const actions = [];
  for (const action of value.actions) {
    if (!plain(action) || !known.has(action.type)) return null;
    const keys = known.get(action.type);
    if (Object.keys(action).length !== keys.length + 1 || keys.some(key => !shortText(action[key], key === 'text' ? 240 : 80) || !action[key].trim())) return null;
    actions.push(Object.fromEntries([['type', action.type], ...keys.map(key => [key, action[key]])]));
  }
  const clarification = value.clarification.trim();
  if (actions.length && clarification) return null;
  return { actions, clarification };
}

export function validNarration(value, cast) {
  if (!plain(value) || !shortText(value.text, NARRATION_TEXT_LIMIT) || !value.text.trim() || !Array.isArray(value.reactions) || value.reactions.length > 3) return null;
  if (value.reactions.some(r => !plain(r) || !cast.includes(r.actor) || !shortText(r.text, 240) || !r.text.trim())) return null;
  return { text: value.text.trim(), reactions: value.reactions.map(r => ({ actor: r.actor, text: r.text.trim() })) };
}

// Model script becomes ordinary persisted text; speaker names come from the cast.
export function validScript(value, cast, excludedActor) {
  if (!plain(value) || !Array.isArray(value.lines) || !value.lines.length || value.lines.length > SCRIPT_LINES) return null;
  const names = new Map(cast.map(actor => [actor.id, actor.name])), lines = [];
  let contentLength = 0;
  for (const line of value.lines) {
    if (!plain(line) || !shortText(line.text, 600) || !line.text.trim() || /[\r\n*]/u.test(line.text)) return null;
    if (line.actor !== null && !names.has(line.actor)) return null;
    contentLength += line.text.trim().length;
    if (contentLength > NARRATION_CONTENT_LIMIT) return null;
    if (line.actor === excludedActor) continue;
    lines.push(line.actor === null ? `*${line.text.trim()}*` : `${names.get(line.actor)}: ${line.text.trim()}`);
  }
  const narration = validNarration({ text: lines.join('\n'), reactions: value.reactions }, [...names.keys()]);
  if (narration) narration.reactions = narration.reactions.filter(r => r.actor !== excludedActor);
  return narration;
}
