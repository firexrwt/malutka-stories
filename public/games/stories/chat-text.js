export function splitChatText(value) {
  if (typeof value !== 'string') return [];
  const parts = []; let cursor = 0, start = -1;
  const space = char => char === undefined || /\s/u.test(char);
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\n' || value[i] === '\r') { start = -1; continue; }
    if (value[i] === '\\' && value[i + 1] === '*') { i++; continue; }
    if (value[i] !== '*') continue;
    if (value[i + 1] === '*') {
      start = -1;
      while (value[i + 1] === '*') i++;
      continue;
    }
    if (start >= 0 && !space(value[i - 1])) {
      if (start > cursor) parts.push({ action: false, text: value.slice(cursor, start) });
      parts.push({ action: true, text: value.slice(start + 1, i) });
      cursor = i + 1; start = -1;
    } else if (!space(value[i + 1])) start = i;
  }
  if (cursor < value.length) parts.push({ action: false, text: value.slice(cursor) });
  return parts;
}

export function appendChatText(node, value, speakers = []) {
  const doc = node.ownerDocument;
  const known = new Set(speakers);
  for (const part of splitChatText(value)) {
    if (!part.action) {
      for (const line of part.text.split(/(\r\n|\r|\n)/u)) {
        const colon = line.indexOf(':'), name = line.slice(0, colon).trimStart();
        if (colon < 0 || !known.has(name)) { node.append(doc.createTextNode(line)); continue; }
        node.append(doc.createTextNode(line.slice(0, colon - name.length)));
        const label = doc.createElement('strong'); label.className = 'story-speaker'; label.textContent = `${name}:`;
        node.append(label, doc.createTextNode(line.slice(colon + 1)));
      }
      continue;
    }
    const action = doc.createElement('em'); action.className = 'story-action'; action.textContent = part.text;
    node.append(action);
  }
}
