import { validDirection } from './director.js';
import { ART_BANK, backgroundAsset } from './art-library.js';
const make = (tag, value, cls) => {
  const node = document.createElement(tag); if (value) node.textContent = value; if (cls) node.className = cls; return node;
};
export function portrait(id, variant = 'neutral') {
  const asset = ART_BANK.get(id), node = make('img', '', 'portrait');
  node.alt = ''; node.decoding = 'async';
  node.setAttribute('aria-hidden', 'true');
  if (asset) {
    node.src = asset.portraits[variant] || asset.portraits.neutral;
  }
  return node;
}
export function renderStage(run, scene, speaker = 'player', onSelect = () => {}) {
  const last = run.history.at(-1), stage = document.getElementById('stage'); stage.replaceChildren();
  const cast = run.cast || scene.cast;
  const v = validDirection(last.visual, cast, run.objects.map(o => o.id));
  if (!v) { stage.append(make('p', 'Постановка кадра недоступна.')); return; }
  v.actors = v.actors.filter(a => !(a.id === 'arbuz' && run.facts.arbuz === 'outside'));
  if (!v.actors.some(a => a.id === v.focus)) { v.focus = null; if (v.camera === 'close') v.camera = 'wide'; }
  stage.className = `scene-stage camera-${v.camera} light-${v.light}`;
  stage.setAttribute('aria-label', v.caption || scene.location);
  const room = make('div', '', 'stage-room'); room.style.backgroundImage = `url("${backgroundAsset(v.background)}")`; stage.append(room);
  const actors = make('div', '', 'stage-actors'); stage.append(actors);
  v.actors.forEach(a => {
    const member = cast.find(m => m.id === a.id);
    const char = make('button', '', 'character'); char.type = 'button'; char.dataset.actor = a.id;
    char.setAttribute('aria-label', `Писать как ${member.name}`); char.setAttribute('aria-pressed', String(speaker === a.id));
    char.addEventListener('click', () => onSelect(a.id));
    char.style.setProperty('--actor-x', `${a.x}%`); char.style.bottom = `${(78 - a.y) / 6}%`;
    char.style.zIndex = String(Math.round(a.y));
    if (a.id === v.focus) {
      char.classList.add('focus'); char.style.zIndex = '100';
      if (v.camera === 'close') { char.style.left = '50%'; char.style.bottom = '0%'; }
    }
    const art = portrait(member.artId || a.id, a.variant);
    if ((member.artId || a.id) === 'arbuz') art.classList.add('fruit');
    if (a.facing === 'left') art.style.transform = 'scaleX(-1)';
    char.append(art, make('span', member.name, 'character-name')); actors.append(char);
  });
  const props = make('div', '', 'stage-props');
  v.props.forEach(id => {
    const object = run.objects.find(o => o.id === id);
    if (object.place !== 'inventory') props.append(make('span', object.name, 'prop-label'));
  });
  stage.append(props);
  document.getElementById('direction-caption').textContent = v.caption;
  document.getElementById('shot-label').textContent = new Map([['wide', 'ОБЩИЙ ПЛАН'], ['medium', 'СРЕДНИЙ ПЛАН'], ['close', 'КРУПНЫЙ ПЛАН']]).get(v.camera);
}
