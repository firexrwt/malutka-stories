import { StoryError } from './errors.js';

const TEXT_LIMIT = 12000;
const formatError = () => new StoryError('provider_format', 'Не удалось прочитать ответ ChatGPT. Ход не сохранён.', 502);
const refusalError = () => new StoryError('provider_refused', 'ChatGPT отказался продолжать этот запрос. Ход не сохранён.', 502);

function outputText(output) {
  let text = '';
  for (const item of output) {
    if (item?.type !== 'message') continue;
    if (!Array.isArray(item.content)) throw formatError();
    for (const part of item.content) {
      if (part?.type === 'refusal') throw refusalError();
      if (part?.type !== 'output_text') continue;
      if (typeof part.text !== 'string') throw formatError();
      text += part.text;
      if (text.length > TEXT_LIMIT) throw formatError();
    }
  }
  return text;
}

function streamedText() {
  const parts = new Map(); let size = 0;
  return {
    add(event) {
      const done = event.type === 'response.output_text.done';
      if (!done && event.type !== 'response.output_text.delta') return;
      const { output_index: output, content_index: content } = event;
      const text = done ? event.text : event.delta;
      if (!Number.isSafeInteger(output) || output < 0 || !Number.isSafeInteger(content) || content < 0 || typeof text !== 'string') throw formatError();
      const key = `${output}:${content}`, prior = parts.get(key);
      if ((prior?.done && !done) || (done && prior && prior.text !== text)) throw formatError();
      const next = done ? text : (prior?.text || '') + text;
      size += next.length - (prior?.text.length || 0);
      if (size > TEXT_LIMIT || (!prior && parts.size >= 64)) throw formatError();
      parts.set(key, { output, content, text: next, done });
    },
    read() { return [...parts.values()].sort((a, b) => a.output - b.output || a.content - b.content).map(p => p.text).join(''); },
  };
}

export async function boundedJson(response, max = 65536) {
  let data = '', size = 0; const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > max) throw new StoryError('provider_size', 'Ответ сервиса слишком большой.', 502);
    data += decoder.decode(chunk, { stream: true });
  }
  try { return JSON.parse(data + decoder.decode()); } catch { throw new StoryError('provider_format', 'Сервис вернул неполный ответ. Ход не сохранён.', 502); }
}

export async function consumeResponse(response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new StoryError('provider_http', response.status === 429 ? 'Лимит ChatGPT. Подожди и повтори тот же ход.' :
      response.status === 401 || response.status === 403 ? 'ChatGPT отклонил доступ. Войди снова и проверь разрешение на подписку.' :
      'ChatGPT временно недоступен. Ход не сохранён.', response.status === 429 ? 429 : 502);
  }
  const decoder = new TextDecoder(), text = streamedText(); let buffer = '', bytes = 0, completed = null;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 512 * 1024) throw new StoryError('provider_size', 'Ответ ChatGPT превысил лимит демки. Ход не сохранён.', 502);
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') continue;
      if (completed) throw formatError();
      let value;
      try { value = JSON.parse(data); } catch { throw new StoryError('provider_format', 'Повреждённый поток ChatGPT. Повтори ход.', 502); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw formatError();
      if (['error', 'response.failed', 'response.incomplete'].includes(value.type)) throw new StoryError('provider_failed', 'ChatGPT не завершил ответ. Ход не сохранён.', 502);
      if (['response.refusal.delta', 'response.refusal.done'].includes(value.type)) throw refusalError();
      text.add(value);
      if (value.type === 'response.completed') {
        completed = value.response;
        if (Array.isArray(completed?.output)) outputText(completed.output);
      }
    }
  }
  if (completed?.status !== 'completed' || !Array.isArray(completed.output)) throw new StoryError('provider_incomplete', 'Ответ оборвался. Ход не сохранён, его можно повторить.', 502);
  // ChatGPT plan streams may omit terminal message text; read the preceding stream events too.
  const result = outputText(completed.output) || text.read();
  if (!result || result.length > TEXT_LIMIT) throw formatError();
  try { return JSON.parse(result); } catch { throw new StoryError('provider_format', 'ChatGPT вернул неверный формат. Повтори ход.', 502); }
}

export async function responseJson(token, model, instructions, payload, signal, fetcher = fetch) {
  const response = await fetcher('https://api.openai.com/v1/responses', {
    method: 'POST', redirect: 'error', signal, headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, instructions, input: [{ role: 'user', content: JSON.stringify(payload) }], store: false, stream: true }),
  });
  return consumeResponse(response);
}
