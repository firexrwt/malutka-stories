export function streamRule(run, a) {
  const f = run.facts;
  if (a.type === 'inspect' && a.target === 'broken_mic') {
    f.diagnosed = true;
    return 'Проверка: основной микрофон сломан. Его можно заменить или попросить Файрекса починить.';
  }
  if (a.type === 'connect') {
    if (a.channel !== 'audio' || !['spare_mic', 'cable'].includes(a.target)) return 'Отказ: подходит только микрофон или кабель, канал - audio.';
    const object = run.objects.find(o => o.id === a.target);
    if (object.place !== 'inventory') return `Отказ: сначала возьми предмет «${object.name}» со стола.`;
    object.place = 'channel';
    if (a.target === 'spare_mic') {
      f.mic = 'spare_mic'; run.objects.find(o => o.id === 'broken_mic').place = 'table';
    }
    else f.cable = true;
    f.tested = false;
    return `${object.name} подключён к звуковому каналу. Проверка звука ещё не выполнена.`;
  }
  if (a.type === 'ask') {
    if (a.task === 'repair' && a.actor === 'firexrwt') {
      if (!f.diagnosed) return 'Файрекс отказал: сначала проверь основной микрофон, иначе чинить будем догадку.';
      f.repaired = true; f.tested = false;
      return 'Файрекс починил основной микрофон. Кабель и проверка звука всё ещё нужны.';
    }
    if (a.task === 'cable' && a.actor === 'firexrwt') {
      const cable = run.objects.find(o => o.id === 'cable');
      cable.place = 'channel'; f.cable = true; f.tested = false;
      return 'Файрекс подключил имеющийся кабель к каналу audio.';
    }
    if (a.task === 'test' && ['pihta_stream', 'firexrwt', 'pr1nc3x3'].includes(a.actor)) {
      if (!f.cable || (f.mic === 'broken_mic' && !f.repaired)) return 'Проверка не прошла: нужен исправный микрофон и подключённый кабель.';
      f.tested = true;
      return 'Проверка звука прошла: голос поступает в пульт. Можно запускать эфир.';
    }
    return 'Участник отказал: попроси Файрекса починить микрофон или подключить кабель, а любого участника - проверить звук.';
  }
  if (a.type === 'begin') {
    if (f.live) return 'Эфир уже идёт. История продолжается в прямом эфире.';
    if (!f.tested || !f.cable || (f.mic === 'broken_mic' && !f.repaired)) return 'Эфир не запущен: сначала исправное подключение и успешная проверка звука.';
    f.live = true; run.goalStatus = 'achieved';
    return 'Подтверждено: эфир запущен, звук работает.';
  }
  return null;
}
