import { mkdir, readFile, open, rename, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LIMITS } from './limits.js';
import { StoryError } from './errors.js';

export async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) throw new Error('Story storage must be an owner-only directory');
}

export async function atomicJson(path, value) {
  const data = JSON.stringify(value);
  if (Buffer.byteLength(data) > LIMITS.storageBytes) throw new StoryError('save_limit', 'Локальное хранилище демки заполнено. Заверши ненужные сессии.', 507);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(data); await handle.sync();
    await handle.close(); await rename(temporary, path);
  } catch (error) {
    await handle.close().catch(() => {}); await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function readPrivateJson(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > LIMITS.storageBytes || (info.mode & 0o077)) throw new Error('Invalid story storage file');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function createStorage(directory) {
  if (!directory) return { load: async () => [], save: async () => {}, hostId: `urn:uuid:${randomUUID()}` };
  await privateDirectory(directory);
  const hostFile = join(directory, 'host.json');
  let host = await readPrivateJson(hostFile);
  if (!host) { host = { id: `urn:uuid:${randomUUID()}` }; await atomicJson(hostFile, host); }
  if (!/^urn:uuid:[a-f0-9-]{36}$/.test(host.id)) throw new Error('Invalid story host identity');
  const file = join(directory, 'sessions.json');
  let writing = Promise.resolve();
  return { hostId: host.id,
    async load() {
      const value = await readPrivateJson(file);
      if (!value) return [];
      if (value.version !== 1 || !Array.isArray(value.sessions)) { console.error('stories: saved_sessions_format_invalid'); return []; }
      return value.sessions;
    },
    save(sessions) {
      // Serialize snapshot writes. An earlier turn cannot overwrite a later one.
      const snapshot = structuredClone(sessions);
      const result = writing.then(() => atomicJson(file, { version: 1, sessions: snapshot }));
      writing = result.catch(() => {});
      return result;
    },
  };
}
