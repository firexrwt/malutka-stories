export function meetingRule(run, a) {
  const f = run.facts;
  if (a.type === 'inspect' && a.target === 'agenda') {
    f.agenda = true;
    return 'Повестка прочитана: обсудить эфир, назначить председателя и вести запись. Арбуз в списке приглашённых отсутствует.';
  }
  if (a.type === 'propose') {
    if (a.option === 'invite') { f.arbuz = 'guest'; return 'Арбуз включён в повестку как гость. Он сделал вид, что так и было.'; }
    if (a.option === 'evict') {
      if (!f.agenda) return 'Майзенберг отказал: сначала прочитай повестку, иначе опять всё собрание про Арбуз.';
      f.arbuz = 'outside';
      if (f.chair === 'arbuz') { f.chair = null; f.support = []; }
      return 'Майзенберг и Гинкин поддержали удаление Арбуза. Он ждёт следующую встречу за дверью.';
    }
    const candidates = new Map([['chair_arbuz', 'arbuz'], ['chair_maizenberg', 'mzberg']]);
    if (!candidates.has(a.option)) return 'Неясное предложение: можно пригласить/вывести Арбуза или выдвинуть Арбуза/Майзенберга председателем.';
    f.chair = candidates.get(a.option); f.support = [];
    return 'Кандидат выдвинут. До назначения нужно согласие Майзенберга и Гинкина.';
  }
  if (a.type === 'ask') {
    if (a.task === 'record' && a.actor === 'ginkin_nm') {
      f.recording = true; return 'Гинкин включил запись. Роль нарезчика закреплена, опасные паузы уже найдены.';
    }
    if (a.task === 'leave' && a.actor === 'arbuz') return 'Арбуз отказал: молча придвинулся к столу. Решение о его участии принимают остальные.';
    if (a.task === 'support' && ['mzberg', 'ginkin_nm'].includes(a.actor)) {
      if (!f.chair || !f.agenda) return 'Отказ: сначала повестка и конкретный кандидат.';
      if (a.actor === 'ginkin_nm' && !f.recording) return 'Гинкин отказал: без записи история с Арбузом останется без нарезки. Сначала поручите ему запись.';
      if (f.chair === 'arbuz' && f.arbuz !== 'guest') return 'Отказ: Арбуза сначала нужно официально включить в повестку как гостя.';
      if (!f.support.includes(a.actor)) f.support.push(a.actor);
      return `${a.actor === 'mzberg' ? 'Майзенберг' : 'Гинкин'} поддержал кандидата. Повестка остаётся обязательной.`;
    }
    return 'Участник не берётся за эту роль. Гинкин может вести запись, Майзенберг и Гинкин - поддержать кандидата.';
  }
  if (a.type === 'begin') {
    if (run.goalStatus === 'achieved') return 'Совещание уже идёт. Участники могут продолжать обсуждение.';
    if (!f.agenda || !f.recording || f.support.length < 2 || f.arbuz === 'uninvited') return 'Совещание не началось: нужны повестка, запись, два согласия и решение об участии Арбуза.';
    run.goalStatus = 'achieved';
    return 'Подтверждено: председатель избран, роли распределены, совещание началось.';
  }
  return null;
}
