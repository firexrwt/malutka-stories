import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeResponse } from '../server/stories/responses.js';

const completed = (output = []) => ({ type: 'response.completed', response: { status: 'completed', output } });
const delta = (text, output_index = 0, content_index = 0) => ({ type: 'response.output_text.delta', delta: text, output_index, content_index });
const done = (text, output_index = 0, content_index = 0) => ({ type: 'response.output_text.done', text, output_index, content_index });
const message = text => ({ type: 'message', content: [{ type: 'output_text', text }] });
const sse = events => events.map(value => `data: ${JSON.stringify(value)}\r\n\r\n`).join('');
const response = events => new Response(sse(events));

test('ChatGPT plan stream preserves finalized text when completed output is empty', async () => {
  const text = JSON.stringify({ text: 'Арбуз возражает.', safe: true });
  const events = [delta(text.slice(0, 9), 1), delta(text.slice(9), 1), done(text, 1), completed()];
  const bytes = Buffer.from(sse(events));
  const stream = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  assert.deepEqual(await consumeResponse(new Response(stream)), JSON.parse(text));
  assert.deepEqual(await consumeResponse(response([delta(text), completed()])), JSON.parse(text));
  assert.deepEqual(await consumeResponse(response([done(text), completed()])), JSON.parse(text));
  for (const output of [[{ type: 'reasoning' }], [{ type: 'message', content: [] }]]) {
    assert.deepEqual(await consumeResponse(response([delta(text), done(text), completed(output)])), JSON.parse(text));
  }
});

test('text parts are ordered by index and snapshots do not duplicate deltas', async () => {
  const a = '{"safe":', b = 'true}';
  assert.deepEqual(await consumeResponse(response([delta(b, 1, 1), delta(a, 1, 0), done(a, 1, 0), done(b, 1, 1), completed()])), { safe: true });
  const text = '{"safe":true}';
  assert.deepEqual(await consumeResponse(response([delta(text), done(text), completed([message(text)])])), { safe: true });
});

test('streamed text requires successful completion and never overrides refusal or failure', async () => {
  const text = '{"safe":true}';
  for (const tail of [[], [{ type: 'response.failed' }], [{ type: 'response.incomplete' }], [completed(), { type: 'response.failed' }]]) {
    await assert.rejects(consumeResponse(response([delta(text), ...tail])));
  }
  for (const event of [{ type: 'response.refusal.done', refusal: 'no' }, completed([{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }])]) {
    await assert.rejects(consumeResponse(response([delta(text), event, completed()])), /отказ|не завершил/);
  }
  await assert.rejects(consumeResponse(response([completed(), delta(text)])));
  await assert.rejects(consumeResponse(response([delta(text), completed(), done(text)])));
  assert.deepEqual(await consumeResponse(new Response(sse([delta(text), completed()]) + 'data: [DONE]\n\n')), { safe: true });
});

test('stream text bounds, indices, contradictory snapshots and invalid JSON fail closed', async () => {
  for (const events of [
    [delta('x'.repeat(12001)), completed()],
    [delta('x'.repeat(7000), 0, 0), delta('x'.repeat(7000), 0, 1), completed()],
    [delta('{"safe":true}', -1), completed()],
    [delta('{"safe":true}'), done('{"safe":false}'), completed()],
    [delta('not JSON'), completed()],
    [completed()],
  ]) await assert.rejects(consumeResponse(response(events)));
  let cancelled = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(Buffer.from(sse([delta('x'.repeat(12001))]))); }, cancel() { cancelled = true; } });
  await assert.rejects(consumeResponse(new Response(stream)));
  assert.equal(cancelled, true);
});

test('64 text parts and 512 KiB are accepted; exceeding either bound fails closed', async () => {
  const text = JSON.stringify({ text: 'x'.repeat(53) });
  assert.equal(text.length, 64);
  assert.deepEqual(await consumeResponse(response([...text].map((char, i) => delta(char, 0, i)).concat(completed()))), JSON.parse(text));
  const oversizedParts = JSON.stringify({ text: 'x'.repeat(54) });
  assert.equal(oversizedParts.length, 65);
  await assert.rejects(consumeResponse(response([...oversizedParts].map((char, i) => delta(char, 0, i)).concat(completed()))));
  const limit = 512 * 1024, wire = sse([delta('{"safe":true}'), completed()]);
  const padded = ': ' + ' '.repeat(limit - Buffer.byteLength(wire) - 4) + '\n\n' + wire;
  assert.equal(Buffer.byteLength(padded), limit);
  assert.deepEqual(await consumeResponse(new Response(padded)), { safe: true });
  let cancelled = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(limit + 1)); }, cancel() { cancelled = true; } });
  await assert.rejects(consumeResponse(new Response(stream)), e => e.code === 'provider_size');
  assert.equal(cancelled, true);
});
