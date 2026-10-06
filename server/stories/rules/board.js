export function boardRule(run, a) {
  const f = run.facts;
  if (a.type === 'inspect' && a.target === 'amendment') {
    f.read = true;
    return 'Поправка прочитана: Принцу предлагается 80% голосов. Ссылки на решение совета нет.';
  }
  if ((a.type === 'show' && a.target === 'registry' && a.actor === 'danyashepard') ||
      (a.type === 'ask' && a.actor === 'danyashepard' && a.task === 'verify')) {
    f.verified = true;
    return 'Шепард сверил исходный реестр: 40/30/30. Оснований передать контроль Принцу нет. Источник проверен.';
  }
  if (a.type === 'propose') {
    if (!['retain', 'title', 'control'].includes(a.option)) return 'Неясная поправка: оставить доли, дать Принцу титул или вынести его заявку на контроль.';
    f.proposal = a.option; f.support = [];
    return 'Предложение записано в протокол. Акции пока не изменились.';
  }
  if (a.type === 'ask' && a.task === 'support') {
    if (!f.read || !f.verified) return 'Участник отказал голосовать без прочитанной поправки и проверенного реестра.';
    if (f.proposal === 'control' && a.actor !== 'pr1nc3x3') return 'Участник отказал: голосов за захват контроля не будет. В реестре нет такого решения.';
    if (f.proposal === 'retain' && a.actor === 'pr1nc3x3') return 'Принц отказал: без нового титула он не видит смысла в компромиссе.';
    if (!f.support.includes(a.actor)) f.support.push(a.actor);
    return 'Участник поддержал предложение. Итог фиксируется только при голосовании.';
  }
  if (a.type === 'begin') {
    if (run.goalStatus === 'achieved') return 'Голосование уже завершено. Доли 40/30/30; обсуждение последствий продолжается.';
    if (!f.read || !f.verified) return 'Голосование не открыто: сначала прочитай поправку и проверь источник с Шепардом.';
    // Votes belong to characters and the verified proposal, never model arguments.
    const votes = run.facts.proposal === 'control' ? 1 : 2 + Number(f.proposal === 'title');
    run.goalStatus = 'achieved';
    return `Голосование завершено: ${votes} за, ${3 - votes} против. Доли остались 40/30/30.`;
  }
  if (a.type === 'ask') return 'Шепард может проверить источник; каждого участника можно попросить поддержать предложение.';
  return null;
}
