import { createHash } from 'node:crypto';
import { StoryError } from './errors.js';

export const digest = value => createHash('sha256').update(value).digest('hex');
export function mutation(session, body, hash, kind = 'turn', legacyHash = null) {
  if (!body || !/^[A-Za-z0-9-]{16,64}$/.test(body.requestId) || !Number.isSafeInteger(body.version) || body.version < 0 || typeof body.runId !== 'string') {
    throw new StoryError('input', 'Неверный запрос. Обнови страницу.');
  }
  const run = session.run;
  if (!run || run.id !== body.runId) throw new StoryError('run', 'Это прохождение недоступно. Обнови страницу.', 404);
  const receipt = run.receipts.find(r => r.id === body.requestId);
  const expected = receipt?.digestVersion === 2 ? hash : legacyHash;
  if (receipt && (receipt.digest !== expected || (receipt.kind || 'turn') !== kind)) throw new StoryError('idempotency', 'Повтор запроса содержит другое действие.', 409);
  return { run, replay: !!receipt };
}
export function currentMutation(run, body) {
  if (body.version !== run.version) throw new StoryError('version', 'История изменилась в другой вкладке. Обнови её.', 409);
  if (run.status !== 'active') throw new StoryError('finished', 'История завершена. Запусти новую.', 409);
}
