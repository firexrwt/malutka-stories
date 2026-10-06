// Normalization plus lexical rejection supplements a separate model classifier.
// Unclassified real-model content is never accepted.
export function isSfw(text) {
  if (typeof text !== 'string') return false;
  const clean = text.normalize('NFKC').toLowerCase().replace(/[\p{Cf}\p{M}]/gu, '')
    .replace(/[0]/g, 'o').replace(/[3]/g, 'e').replace(/[4@]/g, 'a');
  const compact = clean.replace(/[^\p{L}\p{N}]/gu, '');
  return !/(?:порн|секс|эрот|минет|оргазм|мастурб|изнасил|обнаж|раздев|голый|голая|голые|генитал|пенис|вагин|анал(?:ьн|sex)|инцест|хентай|фелляц|porn|sex|eroti|nsfw|nude|naked|orgasm|masturb|blowjob|genital|incest|hentai|rape|fetish|фетиш|лоли|lolicon)/u.test(compact);
}

export const SAFE_MESSAGE = 'Здесь только безопасные комедийные сцены. Попробуй другое действие.';
