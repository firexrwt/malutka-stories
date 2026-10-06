import test from 'node:test';
import assert from 'node:assert/strict';
import { splitChatText, appendChatText } from '../public/games/stories/chat-text.js';
import { validScript } from '../server/stories/protocol.js';
import { CAST } from '../server/stories/canon.js';

test('every scripted speech gets its canonical speaker name while actions stay separate', () => {
  const cast = [CAST.get('pihta_stream'), CAST.get('firexrwt'), CAST.get('generic_courier')];
  const result = validScript({ lines: [
    { actor: null, text: 'Пихта смотрит на микрофон.' },
    { actor: 'pihta_stream', text: 'Я его не трогал.' },
    { actor: 'firexrwt', text: 'Тогда проверим кабель.' },
    { actor: 'generic_courier', text: 'Я подожду здесь.' },
  ], reactions: [] }, cast);
  assert.equal(result.text, `*Пихта смотрит на микрофон.*\n${cast[0].name}: Я его не трогал.\n${cast[1].name}: Тогда проверим кабель.\n${cast[2].name}: Я подожду здесь.`);
});

test('a missing or out-of-scene speaker cannot publish an anonymous or invented speech', () => {
  const cast = [CAST.get('pihta_stream')], good = { actor: 'pihta_stream', text: 'Привет.' };
  for (const line of [{ text: 'Привет.' }, { ...good, actor: 'mzberg' }, { ...good, actor: '__proto__' },
    { ...good, actor: {} }, { ...good, text: '   ' }, { ...good, text: 'Привет.\nКто-то: ответ.' },
    { ...good, text: '*двигаюсь* Привет.' }]) {
    assert.equal(validScript({ lines: [line], reactions: [] }, cast), null);
  }
  assert.equal(validScript({ text: 'Речь без говорящего.', reactions: [] }, cast), null);
  assert.equal(validScript({ lines: [], reactions: [] }, cast), null);
  assert.equal(validScript({ lines: Array(17).fill(good), reactions: [] }, cast), null);
  assert.equal(validScript({ lines: Array(3).fill({ ...good, text: 'x'.repeat(400) }), reactions: [] }, cast), null);
});

test('long custom names do not consume the model content budget or reject otherwise valid speech', () => {
  const name = 'Л'.repeat(60), lines = Array.from({ length: 16 }, () => ({ actor: 'custom', text: 'Я'.repeat(50) }));
  const result = validScript({ lines, reactions: [] }, [{ id: 'custom', name }]);
  assert.ok(result); assert.equal(result.text.length, 16 * (60 + 2 + 50) + 15);
});

test('excluding the user role does not hide invalid content or accept an empty remaining response', () => {
  const cast = [CAST.get('pihta_stream'), CAST.get('firexrwt')], chosen = { actor: 'pihta_stream', text: 'Лишняя реплика.' };
  const reply = { actor: 'firexrwt', text: 'Да алё, блядь!' };
  assert.equal(validScript({ lines: [chosen], reactions: [] }, cast, 'pihta_stream'), null);
  for (const line of [{ ...chosen, text: '*нельзя*' }, { ...chosen, text: 'x'.repeat(601) }, { ...chosen, actor: 'root' }])
    assert.equal(validScript({ lines: [line, reply], reactions: [] }, cast, 'pihta_stream'), null);
  for (const reactions of [[{ ...chosen, text: '' }], [{ ...chosen, actor: 'root' }], Array(4).fill(chosen)])
    assert.equal(validScript({ lines: [reply], reactions }, cast, 'pihta_stream'), null);
  const result = validScript({ lines: [chosen, reply], reactions: [chosen] }, cast, 'pihta_stream');
  assert.equal(result.text, `${cast[1].name}: Да алё, блядь!`); assert.deepEqual(result.reactions, []);
});

test('speaker labels render as text and cannot consume actions or execute markup', () => {
  const doc = { createTextNode: text => ({ kind: 'text', text }), createElement: kind => ({ kind }) };
  const children = [], node = { ownerDocument: doc, append(...items) { children.push(...items); } };
  appendChatText(node, '*Пихта: смотрит на пульт.*\nПихта: <img src=x onerror=alert(1)>\nФайрекс: Проверим.\nЧужой: текст.', ['Пихта', 'Файрекс']);
  const labels = children.filter(c => c.kind === 'strong'), actions = children.filter(c => c.kind === 'em');
  assert.deepEqual(labels.map(c => [c.className, c.textContent]), [['story-speaker', 'Пихта:'], ['story-speaker', 'Файрекс:']]);
  assert.equal(actions.length, 1); assert.equal(actions[0].textContent, 'Пихта: смотрит на пульт.');
  assert.ok(children.some(c => c.kind === 'text' && c.text.includes('<img src=x onerror=alert(1)>')));
  assert.ok(children.some(c => c.kind === 'text' && c.text === 'Чужой: текст.'));
});

test('speech stays plain while single-star actions become separate styled parts', () => {
  assert.deepEqual(splitChatText('Я слушаю. *открываю повестку* Что дальше?\n*смотрю на Арбуза*'), [
    { action: false, text: 'Я слушаю. ' }, { action: true, text: 'открываю повестку' },
    { action: false, text: ' Что дальше?\n' }, { action: true, text: 'смотрю на Арбуза' },
  ]);
  assert.deepEqual(splitChatText('*Арбуз хмурится* Меня опять забыли?'), [
    { action: true, text: 'Арбуз хмурится' }, { action: false, text: ' Меня опять забыли?' },
  ]);
});

test('unfinished, escaped, empty, multiline and double stars remain readable literal text', () => {
  for (const text of ['Просто речь.', 'Что значит *', '*   *', '**жирный**', '\\*буквальные звёздочки*', '*две\nстроки*', '*закрытие\\*']) {
    assert.deepEqual(splitChatText(text), [{ action: false, text }]);
  }
  for (const value of [null, undefined, {}, 42]) assert.deepEqual(splitChatText(value), []);
  assert.deepEqual(splitChatText(''), []);
  assert.deepEqual(splitChatText('\\*буквально* затем *действую*'), [
    { action: false, text: '\\*буквально* затем ' }, { action: true, text: 'действую' },
  ]);
  assert.deepEqual(splitChatText('before\\*x* *y*'), [
    { action: false, text: 'before\\*x* ' }, { action: true, text: 'y' },
  ]);
  assert.deepEqual(splitChatText('до \\* затем *действую*'), [
    { action: false, text: 'до \\* затем ' }, { action: true, text: 'действую' },
  ]);
});

test('actions and speech use text nodes, so markup and URLs never become executable content', () => {
  const created = [];
  const doc = {
    createTextNode(text) { return { kind: 'text', text }; },
    createElement(tag) {
      const node = { kind: tag, set innerHTML(_) { throw new Error('unsafe HTML'); } };
      created.push(node); return node;
    },
  };
  const children = [], node = { ownerDocument: doc, append(child) { children.push(child); }, set innerHTML(_) { throw new Error('unsafe HTML'); } };
  appendChatText(node, '<img src=x onerror=alert(1)> *<script>alert(2)</script>* [link](javascript:alert(3))');
  assert.deepEqual(children, [
    { kind: 'text', text: '<img src=x onerror=alert(1)> ' }, created[0],
    { kind: 'text', text: ' [link](javascript:alert(3))' },
  ]);
  assert.equal(created.length, 1); assert.equal(created[0].kind, 'em');
  assert.equal(created[0].className, 'story-action'); assert.equal(created[0].textContent, '<script>alert(2)</script>');
});
