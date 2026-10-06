// Declarative direction only: no executable code, URLs, HTML or CSS from the model.
import { ART_BANK, BACKGROUNDS } from './art-library.js';
export const CAMERA = ['wide', 'medium', 'close'];
export const LIGHT = ['neutral', 'warm', 'cold', 'alert'];
export const FACING = ['front', 'left', 'right'];
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
export function validDirection(value, cast, objects) {
  const members = new Map(cast.map(m => typeof m === 'string' ? [m, m] : [m.id, m.artId || m.id]));
  if (!plain(value) || !CAMERA.includes(value.camera) || !LIGHT.includes(value.light) ||
      !text(value.caption, 240) || !Array.isArray(value.actors) || !value.actors.length || value.actors.length > Math.min(5, cast.length) ||
      (value.focus !== null && !members.has(value.focus)) || !Array.isArray(value.props) || value.props.length > objects.length) return null;
  if (!BACKGROUNDS.includes(value.background)) return null;
  if (value.actors.some(a => !plain(a) || !members.has(a.id) || !Number.isFinite(a.x) || a.x < 12 || a.x > 88 ||
      !Number.isFinite(a.y) || a.y < 48 || a.y > 78 || !FACING.includes(a.facing) || !ART_BANK.get(members.get(a.id))?.variants.includes(a.variant))) return null;
  if (new Set(value.actors.map(a => a.id)).size !== value.actors.length || value.props.some(p => !objects.includes(p)) || new Set(value.props).size !== value.props.length) return null;
  if ((value.camera === 'close' && value.focus === null) || (value.focus !== null && !value.actors.some(a => a.id === value.focus))) return null;
  return { camera: value.camera, light: value.light, caption: value.caption.trim(), focus: value.focus, background: value.background,
    actors: value.actors.map(a => ({ id: a.id, x: a.x, y: a.y, facing: a.facing, variant: a.variant })), props: [...value.props] };
}
export function initialDirection(scene) {
  return { camera: 'wide', light: 'neutral', background: scene.id === 'stream' ? 'studio' : scene.id, caption: scene.location, focus: null,
    actors: scene.cast.slice(0, 5).map((m, i) => ({ id: typeof m === 'string' ? m : m.id, x: 18 + i * 64 / Math.max(1, Math.min(5, scene.cast.length) - 1), y: 78, facing: 'front', variant: 'neutral' })),
    props: scene.objects.map(o => o.id) };
}
