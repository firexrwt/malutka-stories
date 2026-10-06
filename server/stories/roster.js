// Only the seven fictional story identities; no site dossiers or social links.
export const ROSTER = [
  ['mzberg', 'МАЙЗЕНБЕРГ', '#ef6687'], ['arbuz', 'АРБУЗ', '#ebef93'],
  ['firexrwt', 'ФАЙРЕКС', '#ffd24d'], ['pr1nc3x3', 'ПРИНЦ', '#ff8400'],
  ['pihta_stream', 'ПИХТА', '#78c878'], ['ginkin_nm', 'ГИНКИН', '#b98cf5'],
  ['danyashepard', 'ДАНЯ ШЕПАРД', '#2fc9c9'],
].map(([id, name, accent]) => Object.freeze({ id, name, accent }));
