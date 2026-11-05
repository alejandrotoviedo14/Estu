// Genera archivos .ics (iCalendar, RFC 5545) para guardar partidos en el calendario del móvil.
const DUR_H = 2; // duración estimada de un partido, en horas

const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Pliegue de líneas a 75 octetos (RFC 5545 §3.1)
function fold(line) {
  const out = [];
  let s = line;
  while (Buffer.byteLength(s, 'utf8') > 75) {
    let cut = 75;
    while (Buffer.byteLength(s.slice(0, cut), 'utf8') > 75) cut--;
    out.push(s.slice(0, cut));
    s = ' ' + s.slice(cut);
  }
  out.push(s);
  return out.join('\r\n');
}
const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const madridYMD = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, '');
const addDays = (ymd, n) => { const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + n)); return d.toISOString().slice(0, 10).replace(/-/g, ''); };

// Un evento por partido. Si no hay hora confirmada, se crea como evento de día completo.
function eventFor(f, club) {
  const rival = f.rival.replace(/\b(\p{L})(\p{L}*)/gu, (m, a, b) => a + b.toLocaleLowerCase('es'));
  const summary = `${club} ${f.home ? 'vs' : '@'} ${rival}`;
  const desc = [f.comp + (f.round ? ` · Jornada ${f.round}` : ''), f.ptsFor != null ? `Resultado: ${f.ptsFor}-${f.ptsAgainst}` : null].filter(Boolean).join('\n');
  const lines = ['BEGIN:VEVENT', `UID:${esc(f.id)}@movistar-estudiantes-tracker`, `DTSTAMP:${stamp(new Date())}`];
  if (f.noTime) {
    const day = madridYMD(new Date(f.date));
    lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${addDays(day, 1)}`);
  } else {
    const start = new Date(f.date), end = new Date(start.getTime() + DUR_H * 36e5);
    lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`);
  }
  lines.push(`SUMMARY:${esc(summary)}`, `LOCATION:${esc(f.venue || '')}`, `DESCRIPTION:${esc(desc)}`, 'STATUS:CONFIRMED', 'TRANSP:OPAQUE');
  if (!f.noTime) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, 'TRIGGER:-PT2H', 'END:VALARM');
  lines.push('END:VEVENT');
  return lines;
}

function calendar(fixtures, { name = 'Movistar Estudiantes', club = 'Movistar Estudiantes' } = {}) {
  const head = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Estu//Movistar Estudiantes//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`, 'X-WR-TIMEZONE:Europe/Madrid'];
  const body = fixtures.flatMap(f => eventFor(f, club));
  return [...head, ...body, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}

module.exports = { calendar };
