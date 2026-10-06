const $ = id => document.getElementById(id);
const present = (run, m) => m.id !== 'arbuz' || run.facts.arbuz !== 'outside';
export function createCastControls({ onSelect, onAdd }) {
  let speaker = 'player', runId = null;
  try {
    const raw = sessionStorage.getItem('malutka-stories-role');
    if (raw?.length < 200) { const saved = JSON.parse(raw); if (typeof saved?.speaker === 'string') { speaker = saved.speaker; runId = saved.runId; } }
  } catch { /* Role selection works without browser storage. */ }
  function select(id) {
    if (!$('speaker-select').querySelector(`option[value="${CSS.escape(id)}"]`)) return;
    speaker = id; $('speaker-select').value = id;
    try { sessionStorage.setItem('malutka-stories-role', JSON.stringify({ speaker, runId })); } catch { /* Optional convenience. */ }
    updateLabel(); onSelect(id);
  }
  function updateLabel() {
    const name = $('speaker-select').selectedOptions[0]?.textContent || 'Ты';
    $('active-speaker').textContent = `Сейчас пишешь: ${name}`;
    for (const node of document.querySelectorAll('#stage [data-actor]')) node.setAttribute('aria-pressed', String(node.dataset.actor === speaker));
  }
  function fields() {
    const ready = $('character-mode').value === 'ready';
    $('ready-fields').hidden = !ready; $('custom-fields').hidden = ready;
    $('character-name').required = !ready;
  }
  $('speaker-select').addEventListener('change', () => select($('speaker-select').value));
  $('character-mode').addEventListener('change', fields);
  $('character-form').addEventListener('submit', event => {
    event.preventDefault();
    onAdd($('character-mode').value === 'ready' ? { mode: 'ready', ready: $('character-ready').value } :
      { mode: 'custom', name: $('character-name').value.trim(), description: $('character-description').value.trim(), presentation: $('character-presentation').value });
  });
  $('character-random').addEventListener('click', () => onAdd({ mode: 'random', presentation: $('character-presentation').value }));
  return {
    get speaker() { return speaker; }, select,
    restore(selection) {
      $('character-mode').value = selection.mode === 'ready' ? 'ready' : 'custom';
      if (selection.mode === 'ready') $('character-ready').value = selection.ready;
      else {
        $('character-name').value = selection.name || '';
        $('character-description').value = selection.description || '';
        $('character-presentation').value = selection.presentation || 'auto';
      }
      fields();
      if (selection.mode === 'random') $('character-name').required = false;
      $('cast-editor').open = true;
    },
    render(session, frozenSpeaker) {
      const run = session.run;
      if (runId !== run.id) { runId = run.id; speaker = 'player'; }
      const select = $('speaker-select'); select.replaceChildren();
      for (const m of [{ id: 'player', name: 'Ты' }, ...run.cast.filter(m => present(run, m))]) {
        const option = document.createElement('option'); option.value = m.id; option.textContent = m.name; select.append(option);
      }
      const frozen = run.cast.find(m => m.id === frozenSpeaker);
      if (frozen && ![...select.options].some(o => o.value === frozen.id)) {
        const option = document.createElement('option'); option.value = frozen.id; option.textContent = `${frozen.name} (повтор хода)`; option.disabled = true; select.append(option);
      }
      if (frozenSpeaker && [...select.options].some(o => o.value === frozenSpeaker)) speaker = frozenSpeaker;
      if (![...select.options].some(o => o.value === speaker)) speaker = 'player';
      select.value = speaker; updateLabel();
      const choices = $('character-ready'), previous = choices.value; choices.replaceChildren();
      for (const m of (session.characters || []).filter(m => !run.cast.some(c => c.id === m.id))) {
        const option = document.createElement('option'); option.value = m.id; option.textContent = m.name; choices.append(option);
      }
      if ([...choices.options].some(o => o.value === previous)) choices.value = previous;
      $('cast-count').textContent = `${run.cast.length} / ${session.maxCast || 8} в сцене`;
      fields();
    },
    block(disabled, pendingKind) {
      $('speaker-select').disabled = disabled || !!pendingKind;
      for (const node of document.querySelectorAll('#stage button')) node.disabled = disabled || !!pendingKind;
      for (const node of document.querySelectorAll('#character-form input, #character-form select, #character-random')) node.disabled = disabled || !!pendingKind;
      $('character-add').disabled = disabled || (pendingKind && pendingKind !== 'character');
      $('character-add').textContent = pendingKind === 'character' ? 'ПОВТОРИТЬ ДОБАВЛЕНИЕ ↗' : 'ДОБАВИТЬ В СЦЕНУ ↗';
    },
  };
}
