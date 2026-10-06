import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
test('standalone entry imports only existing local files within a 60 KiB source budget', async () => {
  const seen = new Set(), queue = [resolve(root, 'games/stories/index.html')]; let bytes = 0;
  while (queue.length) {
    const file = queue.pop(); if (seen.has(file)) continue; seen.add(file);
    assert.ok(file.startsWith(root)); bytes += (await stat(file)).size;
    if (!['.html', '.js', '.css'].includes(extname(file))) continue;
    const source = await readFile(file, 'utf8'), urls = [];
    if (file.endsWith('.html')) for (const m of source.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)/g)) urls.push(m[1]);
    if (file.endsWith('.js')) {
      assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|\beval\s*\(|access_token|refresh_token|code_verifier|client_secret/);
      for (const m of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)) urls.push(m[1]);
    }
    for (const url of urls) if (!/^https?:|^data:|^#/.test(url)) queue.push(resolve(url.startsWith('/') ? root : dirname(file), url.replace(/^\//, '')));
  }
  assert.ok(bytes < 60 * 1024, `${bytes} bytes exceeds 60 KiB`);
  assert.ok([...seen].some(path => path.endsWith('/main.js')));
});
