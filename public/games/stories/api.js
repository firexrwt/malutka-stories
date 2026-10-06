export function createApi(fetcher = fetch) {
  let csrf = '';
  async function request(path, data) {
    let response;
    try {
      response = await fetcher(`/api/stories/${path}`, { method: data ? 'POST' : 'GET', credentials: 'same-origin',
        headers: data ? { 'content-type': 'application/json', 'x-story-csrf': csrf } : {},
        body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(125000) });
    } catch (error) {
      throw new Error(error.name === 'TimeoutError' || error.name === 'AbortError' ?
        'ChatGPT не успел ответить. Текст сохранён; повтори ход.' : 'Нет связи с локальным сервером. Текст сохранён; повтори ход после подключения.');
    }
    let result;
    try { result = await response.json(); } catch { throw new Error('Сервис не ответил. Сохраняем действие для повтора.'); }
    if (!response.ok) { const error = new Error(result.message || 'Не удалось завершить запрос.'); error.code = result.error; throw error; }
    if (result.csrf) csrf = result.csrf;
    return result;
  }
  return { request };
}
