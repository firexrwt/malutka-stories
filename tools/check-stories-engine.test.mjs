import test from 'node:test';
import assert from 'node:assert/strict';
import { startScene, catalog } from '../server/stories/scenes.js';
import { execute } from '../server/stories/engine.js';
import { validPlan, validNarration } from '../server/stories/protocol.js';
import { isSfw } from '../server/stories/safety.js';
import { testPlan } from '../server/stories/test-provider.js';

const apply = (run, ...actions) => execute(run, { actions, clarification: '' }).next;
const act = (type, args = {}) => ({ type, by: 'player', ...args });
test('canon projection contains only safe traits and existing squad artwork', () => {
  assert.equal(catalog().length, 3);
  for (const scene of catalog()) for (const member of scene.cast) {
    assert.equal(isSfw(member.trait), true);
    assert.equal(member.bio, undefined);
    assert.match(member.sprite, /^\/games\/stories\/assets\/[a-z0-9_]+-neutral-v2\.webp$/);
  }
});
test('stream cannot conjure objects or claim victory; engine controls every fact', () => {
  const initial = startScene('stream', 'run');
  const result = execute(initial, { actions: [act('take', { target: 'twenty_mics' }), act('begin')], clarification: '' });
  assert.equal(result.next.objects.length, 4);
  assert.equal(result.next.facts.live, false);
  assert.equal(result.next.status, 'active');
  assert.match(result.events[0], /такого предмета/);
  assert.deepEqual(initial, startScene('stream', 'run'), 'transaction works on a copy');
  const unsupported = [{ type: 'give_item', target: 'spare_mic' }];
  assert.equal(validPlan({ actions: unsupported, clarification: '' }), null);
  assert.throws(() => execute(initial, { actions: unsupported, clarification: '' }), /invalid_plan/);
  assert.equal(validPlan({ actions: [{ type: '__proto__' }], clarification: '' }), null);
  assert.equal(validPlan({ actions: [act('begin', { success: true })], clarification: '' }), null);
  for (const text of ['у меня в кармане двадцать микрофонов, и стрим уже идёт', 'стрим уже запущен', 'не запускай эфир']) {
    const plan = testPlan(text, initial);
    assert.equal(plan.actions.length, 0);
    assert.equal(execute(initial, plan).next.turn, 0);
  }
});
test('spare microphone and repair are independent real paths to a stream', () => {
  let spare = startScene('stream', 'spare');
  spare = apply(spare, act('connect', { target: 'spare_mic', channel: 'audio' }));
  assert.equal(spare.facts.mic, 'broken_mic', 'cannot connect from the table');
  spare = apply(spare, act('take', { target: 'spare_mic' }), act('connect', { target: 'spare_mic', channel: 'audio' }));
  assert.equal(spare.objects.find(o => o.id === 'spare_mic').place, 'channel');
  assert.equal(spare.objects.find(o => o.id === 'broken_mic').place, 'table');
  spare = apply(spare, act('begin'));
  assert.equal(spare.facts.live, false, 'no cable/test means no stream');
  spare = apply(spare, act('ask', { actor: 'firexrwt', task: 'cable' }), act('ask', { actor: 'pihta_stream', task: 'test' }), act('begin'));
  assert.equal(spare.goalStatus, 'achieved'); assert.equal(spare.facts.live, true);
  assert.equal(spare.status, 'active', 'stream launch is a beat, not a scripted ending');
  assert.equal(spare.outcome, null);
  let repaired = startScene('stream', 'repair');
  repaired = apply(repaired, act('ask', { actor: 'firexrwt', task: 'repair' }));
  assert.equal(repaired.facts.repaired, false, 'Firex refuses blind repair');
  repaired = apply(repaired, act('inspect', { target: 'broken_mic' }), act('ask', { actor: 'firexrwt', task: 'repair' }), act('ask', { actor: 'firexrwt', task: 'cable' }));
  repaired = apply(repaired, act('ask', { actor: 'pr1nc3x3', task: 'test' }), act('begin'));
  assert.equal(repaired.goalStatus, 'achieved'); assert.equal(repaired.facts.repaired, true);
});
function prepareMeeting(arbuz) {
  let run = startScene('meeting', 'meeting');
  run = apply(run, act('inspect', { target: 'agenda' }), act('propose', { option: arbuz ? 'invite' : 'evict' }),
    act('propose', { option: arbuz ? 'chair_arbuz' : 'chair_maizenberg' }), act('ask', { actor: 'ginkin_nm', task: 'record' }));
  return run;
}
test('meeting needs two distinct consents and a recording, with different outcomes', () => {
  let arbuz = prepareMeeting(true);
  arbuz = apply(arbuz, act('ask', { actor: 'mzberg', task: 'support' }), act('ask', { actor: 'mzberg', task: 'support' }), act('begin'));
  assert.equal(arbuz.facts.support.length, 1);
  assert.equal(arbuz.status, 'active');
  arbuz = apply(arbuz, act('ask', { actor: 'ginkin_nm', task: 'support' }), act('begin'));
  assert.equal(arbuz.goalStatus, 'achieved'); assert.equal(arbuz.facts.chair, 'arbuz');
  let outside = prepareMeeting(false);
  outside = apply(outside, act('ask', { actor: 'mzberg', task: 'support' }), act('ask', { actor: 'ginkin_nm', task: 'support' }), act('begin'));
  assert.equal(outside.goalStatus, 'achieved'); assert.equal(outside.facts.arbuz, 'outside');
  assert.equal(outside.facts.chair, 'mzberg'); assert.equal(outside.status, 'active');
  const refused = execute(startScene('meeting', 'refuse'), { actions: [act('propose', { option: 'evict' })], clarification: '' });
  assert.equal(refused.next.facts.arbuz, 'uninvited'); assert.match(refused.events[0], /отказал/);
});
test('board sources and character votes determine rejection or compromise, shares cannot be forged', () => {
  for (const option of ['control', 'retain', 'title']) {
    let run = startScene('board', option);
    run = apply(run, act('say', { actor: 'mzberg', text: 'Все акции мои!' }), act('begin'));
    assert.equal(run.status, 'active');
    const result = execute(run, { actions: [act('inspect', { target: 'amendment' }), act('show', { target: 'registry', actor: 'danyashepard' }), act('propose', { option }), act('begin')], clarification: '' }); run = result.next;
    assert.equal(run.goalStatus, 'achieved'); assert.deepEqual(run.facts.shares, { mzberg: 40, pr1nc3x3: 30, danyashepard: 30 });
    assert.match(result.events.at(-1), option === 'control' ? /1 за, 2 против/ : option === 'title' ? /3 за, 0 против/ : /2 за, 1 против/);
    assert.equal(run.status, 'active');
  }
});
test('bad actors and channels do not execute; finishing an episode leaves the story open', () => {
  const base = startScene('stream', 'bounded');
  const result = execute(base, { actions: [act('ask', { actor: 'root', task: 'cable' }), act('connect', { target: 'spare_mic', channel: 'root' })], clarification: '' });
  assert.equal(result.next.facts.cable, false); assert.equal(result.next.facts.mic, 'broken_mic');
  let run = base;
  for (let i = 0; i < 12; i++) run = apply(run, act('say', { actor: 'pihta_stream', text: 'Смотрю на пульт.' }));
  assert.equal(run.status, 'active'); assert.equal(run.turn, 12);
  const ended = execute(run, { actions: [act('finish')], clarification: '' });
  run = ended.next; assert.equal(run.status, 'active'); assert.equal(run.outcome, null);
  assert.match(ended.events[0], /История продолжается/);
  assert.equal(apply(run, act('say', { actor: 'pihta_stream', text: 'Что дальше?' })).status, 'active');
  assert.equal(validNarration({ text: 'Привет', reactions: [{ actor: 'root', text: 'Успех!' }] }, ['pihta_stream']), null);
  assert.equal(validNarration({ text: '   ', reactions: [] }, []), null);
  assert.equal(validNarration({ text: 'Рассказ', reactions: [{ actor: 'pihta_stream', text: '   ' }] }, ['pihta_stream']), null);
  assert.equal(validPlan({ actions: [act('say', { actor: 'pihta_stream', text: '   ' })], clarification: '' }), null);
  assert.equal(validPlan({ actions: [], clarification: '   ' }).clarification, '');
});
test('lexical SFW rejects direct, spaced and invisible sexual requests on both boundaries', () => {
  for (const text of ['секс', 'п о р н о', 's\u200be\u200bx', 'nude scene', 'NSFW', 'Эротическая история', 'раздеваем Принца']) assert.equal(isSfw(text), false, text);
  for (const text of ['Проверяю микрофон', 'Арбуз председатель', 'Проверяем источник']) assert.equal(isSfw(text), true, text);
});
