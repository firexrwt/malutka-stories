const storageKey = 'malutka-stories-pending';
export function readPending(storage) {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw || raw.length > 2500) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value.runId !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(value.requestId) || !Number.isInteger(value.version)) return null;
    if (!value.kind || value.kind === 'turn') {
      if (typeof value.text !== 'string' || value.text.length > 600 || (value.speaker !== undefined && (typeof value.speaker !== 'string' || value.speaker.length > 80))) return null;
      return { kind: 'turn', text: value.text, speaker: value.speaker || 'player', runId: value.runId, version: value.version, requestId: value.requestId };
    }
    if (value.kind === 'character' && value.selection && ['ready', 'custom', 'random'].includes(value.selection.mode)) return value;
  } catch { /* The server remains authoritative when storage is unavailable. */ }
  return null;
}
export function savePending(storage, value) {
  try { if (value) storage.setItem(storageKey, JSON.stringify(value)); else storage.removeItem(storageKey); } catch { /* Optional recovery. */ }
}
export function sameTurn(pending, text, runId, speaker) {
  return pending?.kind === 'turn' && pending.text === text && pending.runId === runId && pending.speaker === speaker;
}
export function turnRequest(pending, text, run, speaker, newId) {
  if (pending?.kind === 'turn' && pending.text === text && pending.runId === run.id) return pending;
  return { kind: 'turn', text, speaker, runId: run.id, version: run.version, requestId: newId() };
}
