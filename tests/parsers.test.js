// Tests de los parsers contra HTML guardado de las webs reales (tests/fixtures).
// Si la FEB o el club cambian su maquetación, estos tests fallan y avisan antes de que la web se rompa en silencio.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const F = require('../feb');
const C = require('../club');
const ICS = require('../ics');

test('calendario FEB: 34 jornadas, 306 partidos, marcadores y actas', () => {
  const rounds = F.parseCalendar(read('feb-calendario.html'));
  assert.equal(rounds.length, 34);
  const all = rounds.flatMap(r => r.matches);
  assert.equal(all.length, 306);
  const first = rounds[0].matches.find(m => m.home === 'MOVISTAR ESTUDIANTES' || m.away === 'MOVISTAR ESTUDIANTES');
  assert.ok(first, 'Estudiantes aparece en la jornada 1');
  assert.equal(first.played, true);
  assert.ok(first.partido, 'el partido tiene enlace al acta');
  assert.ok(all.filter(m => m.played).every(m => m.hs !== null && m.as !== null));
});

test('clasificación FEB: 18 equipos y Estudiantes líder con 6-0', () => {
  const st = F.parseStandings(read('feb-resultados.html'));
  assert.equal(st.length, 18);
  assert.equal(st[0].pos, 1);
  assert.match(st[0].team, /Estudiantes/i);
  assert.equal(st[0].w, 6);
  assert.equal(st[0].pts, 12); // 2 por victoria
});

test('plantilla FEB: 12 jugadores con dorsal y altura en metros', () => {
  const r = F.parseRoster(read('feb-equipo.html'));
  assert.ok(r.length >= 10, `jugadores: ${r.length}`);
  assert.ok(r.every(p => Number.isInteger(p.num) && p.height > 1.5 && p.height < 2.5));
});

test('acta FEB: marcador, fecha, pabellón y totales coherentes', () => {
  const m = F.parseMatch(read('feb-partido.html'), '2535772');
  assert.equal(m.date, '2026-10-30');
  assert.equal(m.time, '20:45');
  assert.equal(m.home.pts, 79);
  assert.equal(m.away.pts, 89);
  assert.equal(m.played, true);
  assert.ok(m.venue.length > 0);
  // Cada jugador con tiros: fg = t2 + t3
  for (const p of [...m.home.players, ...m.away.players]) {
    assert.equal(p.fg[0], p.t2[0] + p.t3[0], `fg de ${p.name}`);
    assert.equal(p.fg[1], p.t2[1] + p.t3[1], `fg attempts de ${p.name}`);
  }
});

test('estadísticas FEB de equipo: columnas BR/BP/TF según la leyenda de la FEB', () => {
  // Fila de Estudiantes en la tabla de equipos (6 partidos): BR=48 robos, BP=66 pérdidas, TF=20 tapones a favor
  const html = read('feb-estadisticas.html');
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  const row = $('table').first().find('tr').toArray().map(tr => $(tr).find('th,td').map((_, c) => $(c).text().trim().replace(/\s+/g, ' ')).get())
    .find(c => /ESTUDIANTES/i.test(c.join(' ')));
  assert.ok(row, 'fila de Estudiantes');
  assert.equal(parseInt(row[12], 10), 48); // BR
  assert.equal(parseInt(row[13], 10), 66); // BP
  assert.equal(parseInt(row[14], 10), 20); // TF
});

test('plantilla del club: 14 jugadores y 12 cargos técnicos con foto', () => {
  const { players, staff } = C.parseClubRoster(read('club-plantilla.html'));
  assert.equal(players.length, 14);
  assert.equal(staff.length, 12);
  assert.ok(players.every(p => p.num && p.photo && p.pos));
  const names = players.map(p => p.name);
  assert.ok(names.includes('Léo Westermann') && names.includes('Kaspar Treier'));
});

test('perfil del club: historial de clubes', () => {
  const career = C.parseCareer(read('club-perfil-munnings.html'));
  assert.ok(career.length >= 3);
  assert.equal(career[0].club, 'Movistar Estudiantes');
  assert.match(career[0].season, /^\d{4}-\d{4}$/);
});

test('ICS: líneas de 75 octetos como máximo y UID únicos', () => {
  const fx = [
    { id: 'J1-1', round: 1, rival: 'INSOLAC CAJA 87', home: true, date: '2026-09-27T10:00:00.000Z', noTime: false, venue: 'Movistar Arena, Madrid', comp: 'Primera FEB', ptsFor: null },
    { id: 'J2-2', round: 2, rival: 'CB Algeciras con un nombre muy largo para forzar el pliegue de líneas en el calendario', home: false, date: '2026-10-01T00:00:00', noTime: true, venue: '', comp: 'Primera FEB', ptsFor: null }
  ];
  const txt = ICS.calendar(fx, { name: 'Test', club: 'Movistar Estudiantes' });
  const lines = txt.split('\r\n').filter(Boolean);
  assert.ok(lines.every(l => Buffer.byteLength(l, 'utf8') <= 75), 'ninguna línea supera 75 octetos');
  const uids = lines.filter(l => l.startsWith('UID:'));
  assert.equal(new Set(uids).size, uids.length);
  assert.ok(txt.includes('DTSTART;VALUE=DATE:'), 'partido sin hora como evento de día completo');
});

test('perfiles del club: formatos de temporada "2025-27" y entradas sin liga', () => {
  const gio = C.parseCareer(read('club-perfil-giovannetti.html'));
  assert.equal(gio[0].season, '2025-27');
  assert.equal(gio.length, 3);
  const tis = C.parseCareer(read('club-perfil-tisma.html'));
  assert.equal(tis[0].club, 'Movistar Estudiantes');
  assert.equal(tis[1].club, 'Zadar');
  assert.ok(tis.every(e => /^\d{4}-\d{2,4}$/.test(e.season)));
});

test('cruce de plantillas: apellidos cortos y dorsal', () => {
  const club = [{ name: 'Juan Paz', num: 7 }, { name: 'Léo Westermann', num: 5 }, { name: 'Kaspar Treier', num: 22 }];
  const feb = [{ name: 'Juan Paz Gil', num: 7 }, { name: 'Leo Westermann', num: 9 }, { name: 'Kaspar Treier', num: 22 }, { name: 'Otro Jugador', num: 3 }];
  const pairs = F.matchRosters(club, feb);
  const of = n => pairs.find(p => p.c && p.c.name === n).f;
  assert.equal(of('Juan Paz').name, 'Juan Paz Gil', 'apellido de 3 letras con mismo dorsal');
  assert.equal(of('Léo Westermann').name, 'Leo Westermann', 'cambio de dorsal: se cruza por apellido largo');
  assert.equal(of('Kaspar Treier').num, 22);
  assert.equal(pairs.length, 4, 'el jugador sin pareja se añade una sola vez');
  // Mismo dorsal pero ningún nombre en común: no se cruzan
  const p2 = F.matchRosters([{ name: 'Ana Ruiz', num: 4 }], [{ name: 'Marta Sanz', num: 4 }]);
  assert.equal(p2.length, 2);
});

test('récord: sale del calendario aunque falte el acta', () => {
  const fx = [{ ptsFor: 80, ptsAgainst: 70 }, { ptsFor: 60, ptsAgainst: 75 }, { ptsFor: null, ptsAgainst: null }, { ptsFor: 90, ptsAgainst: 88 }];
  assert.deepEqual(F.recordOf(fx), { w: 2, l: 1 });
  const st = F.state(), bak = { rounds: st.rounds, matches: st.matches, roster: st.roster };
  st.rounds = [{ round: 1, date: '2026-09-27', matches: [{ round: 1, date: '2026-09-27', homeId: F.CFG.teamId, home: 'MOVISTAR ESTUDIANTES', awayId: '99', away: 'RIVAL', partido: '123', played: true, hs: 85, as: 70 }] }];
  st.matches = {}; st.roster = [];
  try { assert.deepEqual(F.build().record, { w: 1, l: 0 }, 'sin acta descargada'); }
  finally { Object.assign(st, bak); }
});
