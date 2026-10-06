import { CAST } from './canon.js';
import { SCENES } from './scenes.js';
import { ART_BANK, APPEARANCES, NPC } from '../../public/games/stories/art-library.js';
import { shortText } from './protocol.js';
import { isSfw } from './safety.js';

export const MAX_CAST = 8;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const key = name => name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleUpperCase('ru');
export const validName = name => shortText(name, 60) && /^[\p{Script=Latin}\p{Script=Cyrillic}\p{N}][\p{Script=Latin}\p{Script=Cyrillic}\p{N} .'-]*$/u.test(name) && name === name.trim() &&
  !(/\p{Script=Latin}/u.test(name) && /\p{Script=Cyrillic}/u.test(name)) && isSfw(name);
const reserved = new Set(['ТЫ', 'PLAYER', ...[...CAST.values()].map(m => key(m.name))]);

export function validCharacter(value) {
  if (!plain(value)) return null;
  if (value.kind === 'ready') return CAST.has(value.id) ? { kind: 'ready', id: value.id } : null;
  if (value.kind !== 'custom' || !/^custom_[a-f0-9]{32}$/.test(value.id) || !validName(value.name) ||
      reserved.has(key(value.name)) || !shortText(value.trait, 240) || !value.trait.trim() || /[\r\n*]/u.test(value.trait) ||
      !isSfw(value.trait) || !APPEARANCES.has(value.artId)) return null;
  return { kind: 'custom', id: value.id, name: value.name, trait: value.trait.trim(), artId: value.artId };
}
export function runCast(run) {
  const base = [...SCENES.get(run.scene).cast, ...run.guests].map(id => ({ ...CAST.get(id), artId: id }));
  for (const character of run.characters || []) {
    if (character.kind === 'ready') base.push({ ...CAST.get(character.id), artId: character.id });
    else base.push({ ...validCharacter(character), accent: '#fff4bd', sprite: ART_BANK.get(character.artId).portraits.neutral,
      variants: ART_BANK.get(character.artId).variants });
  }
  return base;
}
export function validCharacters(run) {
  if (run.characters !== undefined && (!Array.isArray(run.characters) || run.characters.some(c => !validCharacter(c)))) return false;
  const cast = runCast(run);
  return cast.length <= MAX_CAST && new Set(cast.map(m => m.id)).size === cast.length && new Set(cast.map(m => key(m.name))).size === cast.length;
}
export const present = (run, id) => id !== 'arbuz' || run.facts.arbuz !== 'outside';
export const availableSpeaker = (run, id) => id === 'player' || (present(run, id) && runCast(run).some(m => m.id === id));
export const secondary = (run, id) => id !== 'player' && !SCENES.get(run.scene).cast.includes(id);
export const characterChoices = () => [...CAST.values()].map(m => ({ id: m.id, name: m.name, artId: m.id }));

export function validSelection(value) {
  if (!plain(value)) return null;
  if (value.mode === 'ready') return CAST.has(value.ready) ? { mode: 'ready', ready: value.ready } : null;
  if (!['custom', 'random'].includes(value.mode) || !['auto', 'male', 'female'].includes(value.presentation)) return null;
  if (value.mode === 'random') return { mode: 'random', presentation: value.presentation };
  if (!validName(value.name) || reserved.has(key(value.name)) || !shortText(value.description, 240) || /[\r\n*]/u.test(value.description)) return null;
  return { mode: 'custom', name: value.name, description: value.description.trim(), presentation: value.presentation };
}
export function joinCharacter(run, character) {
  const next = structuredClone(run);
  next.characters = [...(next.characters || []), character];
  if (!validCharacters(next)) return null;
  return next;
}
export function canIntroduce(run, id) {
  return NPC.has(id) && run.guests.length < 2 && runCast(run).length < MAX_CAST && !runCast(run).some(m => m.id === id);
}
