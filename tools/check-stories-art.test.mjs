import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ART_BANK, BACKGROUNDS, backgroundAsset } from '../public/games/stories/art-library.js';
const root = new URL('../public/', import.meta.url);
function webp(data) {
  assert.equal(data.toString('ascii', 0, 4), 'RIFF');
  assert.equal(data.toString('ascii', 8, 12), 'WEBP');
  let dimensions, alpha = false;
  for (let at = 12; at + 8 < data.length;) {
    const tag = data.toString('ascii', at, at + 4), n = data.readUInt32LE(at + 4), p = at + 8;
    if (tag === 'VP8X') { dimensions = [data.readUIntLE(p + 4, 3) + 1, data.readUIntLE(p + 7, 3) + 1]; alpha = !!(data[p] & 16); }
    if (tag === 'VP8 ' && !dimensions) dimensions = [data.readUInt16LE(p + 6) & 16383, data.readUInt16LE(p + 8) & 16383];
    if (tag === 'VP8L' && !dimensions) { const bits = data.readUInt32LE(p + 1); dimensions = [(bits & 16383) + 1, ((bits >>> 14) & 16383) + 1]; alpha = !!(bits & (1 << 28)); }
    at = p + n + (n % 2);
  }
  return { dimensions, alpha };
}
test('portable art bank uses separate transparent portraits, four backgrounds and a bounded transfer size', async () => {
  let bytes = 0, portraits = 0;
  const paths = new Set();
  assert.equal(ART_BANK.size, 13); assert.equal(BACKGROUNDS.length, 4);
  for (const [id, asset] of ART_BANK) {
    assert.ok(asset.variants.length >= 3);
    const hashes = new Set();
    for (const variant of asset.variants) {
      const path = asset.portraits[variant];
      assert.equal(paths.has(path), false, `${id}/${variant}: portrait path reused`); paths.add(path);
      assert.match(path, /^\/games\/stories\/assets\/[a-z0-9_]+-[a-z]+-v2\.webp$/);
      const data = await readFile(new URL(path.slice(1), root)); bytes += data.length; portraits++;
      const digest = createHash('sha256').update(data).digest('hex');
      assert.equal(hashes.has(digest), false, `${id}: variant reuses the exact same image`); hashes.add(digest);
      assert.deepEqual(webp(data), { dimensions: [384, 768], alpha: true }, `${id}/${variant}: one character per file`);
    }
  }
  for (const id of BACKGROUNDS) {
    const data = await readFile(new URL(backgroundAsset(id).slice(1), root)); bytes += data.length;
    assert.deepEqual(webp(data).dimensions, [1200, 800]);
  }
  assert.ok(bytes < 5 * 1024 * 1024, `${bytes} bytes exceeds static bank budget`);
  assert.equal(portraits, 60);
  assert.equal(backgroundAsset('../private'), null);
});
