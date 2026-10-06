export function placeFeedback(doc) {
  const host = doc.getElementById(doc.getElementById('play').hidden ? 'connection-feedback' : 'play-feedback');
  const feedback = doc.getElementById('feedback');
  if (feedback.parentElement !== host) host.append(feedback);
}

export function showFeedbackError(doc, error) {
  const node = doc.getElementById('error');
  node.textContent = error.message || 'Не удалось подключиться к демке.';
  node.hidden = false;
  node.scrollIntoView({ block: 'nearest' });
}

export function showLatestReply(doc) {
  const history = doc.getElementById('history');
  history.scrollTop = history.scrollHeight;
}
