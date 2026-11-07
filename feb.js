// Fuente principal de datos: baloncestoenvivo.feb.es (páginas HTML server-side, estables).
// Calendario completo + resultados, clasificación, plantilla y actas (box score) por partido.
// Los partidos ya jugados no cambian, así que se cachean y solo se descargan una vez.
const cheerio = require('cheerio'), fs = require('fs'), path = require('path');

const BASE = 'https://baloncestoenvivo.feb.es';
const CFG = {
  group: process.env.FEB_GROUP || '1',              // 1 = Primera FEB
  season: process.env.FEB_SEASON || '2026',         // 2026 = temporada 2026-27
  teamId: process.env.FEB_TEAM_ID || '1010493',     // Movistar Estudiantes
  icsUrl: process.env.ICS_URL || 'https://calendar.google.com/calendar/ical/8f9841fadce9be548c94e378f5639fc0eac0310cd23f1c3c75703446d38dd1bd%40group.calendar.google.com/public/basic.ics'
};
const FILE = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'feb-state.json');

// ---------- utilidades ----------
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const num = s => { const n = parseFloat(String(s ?? '').replace(',', '.').replace(/[^\d.-]/g, '')); return isNaN(n) ? null : n; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const toTitle = s => s.toLocaleLowerCase('es').replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('es'))
  .replace(/\b(Cb|Hla|Fibwi|Lf|Sdp|Bc)\b/g, w => w.toUpperCase());
const sameName = (a, b) => { const x = norm(a).replace(/[^a-z0-9]/g, ''), y = norm(b).replace(/[^a-z0-9]/g, ''); return !!x && !!y && (x.includes(y) || y.includes(x)); };
// "CABRERA GARRANCHO, ALBERTO" -> "Alberto Cabrera Garrancho"
const humanName = raw => {
  const s = clean(raw);
  if (s.includes(',')) { const [ap, nom] = s.split(',').map(x => x.trim()); return toTitle(`${nom} ${ap}`); }
  return toTitle(s);
};
const isoDate = d => { const m = String(d).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const shot = s => { const m = String(s ?? '').match(/(\d+)\s*\/\s*(\d+)/); return m ? [+m[1], +m[2]] : [0, 0]; };
const minutes = s => { const m = String(s ?? '').match(/(\d+):(\d{2})/); return m ? +m[1] + +m[2] / 60 : 0; };

// Offset horario de Madrid (minutos) para un instante dado
function madridOffset(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms) / 6e4;
}
// 'YYYY-MM-DD' + 'HH:MM' (hora de Madrid) -> ISO en UTC
function madridISO(ymd, hm) {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!hm) return `${ymd}T00:00:00`;
  const [H, M] = hm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, H, M);
  return new Date(guess - madridOffset(guess) * 6e4).toISOString();
}

async function get(url, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 (EstudiantesTracker)', 'accept-language': 'es-ES' } });
      if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
      return await r.text();
    } catch (e) { lastErr = e; await sleep(800); }
  }
  throw lastErr;
}

// ---------- parsers ----------
const URLS = {
  calendar: () => `${BASE}/calendario.aspx?g=${CFG.group}&t=${CFG.season}&nm=primerafeb`,
  results: () => `${BASE}/resultados/${CFG.group}/${CFG.season}`,
  team: id => `${BASE}/equipo/${id}`,
  match: id => `${BASE}/Partido.aspx?p=${id}`
};

// Calendario: lista de jornadas con partidos, resultado y enlace al acta
function parseCalendar(html) {
  const $ = cheerio.load(html), rounds = [];
  $('table[id*=DataGrid3]').each((_, t) => {
    const head = clean($(t).parent().clone().children('table').remove().end().text());
    const hm = head.match(/Jornada\s+(\d+)\s+(\d{2}\/\d{2}\/\d{4})/);
    if (!hm) return;
    const round = +hm[1], date = isoDate(hm[2]), matches = [];
    $(t).find('tr').each((_, tr) => {
      const home = $(tr).find('td.local a[href*=Equipo]').first(), away = $(tr).find('td.visitante a[href*=Equipo]').first();
      if (!home.length || !away.length) return;
      const res = $(tr).find('td.resultado a'), score = clean(res.text()).match(/^(\d+)\s*-\s*(\d+)$/);
      const pid = (res.attr('href') || '').match(/p=(\d+)/);
      matches.push({
        round, date,
        homeId: (home.attr('href').match(/i=(\d+)/) || [])[1], home: clean(home.text()),
        awayId: (away.attr('href').match(/i=(\d+)/) || [])[1], away: clean(away.text()),
        partido: pid ? pid[1] : null,
        played: !!score, hs: score ? +score[1] : null, as: score ? +score[2] : null
      });
    });
    rounds.push({ round, date, matches });
  });
  return rounds.sort((a, b) => a.round - b.round);
}

// Clasificación (página de resultados)
function parseStandings(html) {
  const $ = cheerio.load(html), out = [];
  $('#_ctl0_MainContentPlaceHolderMaster_clasificacionDataGrid tr').each((i, tr) => {
    const c = $(tr).find('td').map((_, td) => clean($(td).text())).get();
    if (c.length < 9 || !/^\d+$/.test(c[0])) return;
    const id = ($(tr).find('a[href*=Equipo]').attr('href') || '').match(/i=(\d+)/);
    const w = +c[3], l = +c[4];
    out.push({ pos: +c[0], team: toTitle(c[1]), teamId: id ? id[1] : null, pj: +c[2], w, l,
      pf: +c[5], pc: +c[6], dif: +c[7], pct: num(c[8]), streak: c[9] || '', pts: 2 * w + l });
  });
  return out;
}

// Próximas jornadas y resultados ya en la página de resultados (no se usa como fuente principal)

// Plantilla de un equipo
function parseRoster(html) {
  const $ = cheerio.load(html), out = [];
  $('table').first().find('tr').each((_, tr) => {
    let c = $(tr).find('td').map((_, td) => clean($(td).text())).get();
    if (c[0] === '') c = c.slice(1); // primera celda vacía en la tabla de FEB
    if (c.length < 8 || !/^\d+$/.test(c[2])) return;
    const b = c[3].match(/(\d{2}\/\d{2}\/\d{4})\s*(.*)/);
    out.push({
      name: humanName(c[0]), rawName: c[0], pos: c[1], num: +c[2],
      born: b ? isoDate(b[1]) : null, birthplace: b ? clean(b[2]) : '',
      status: toTitle(c[4]), formed: /^SI$/i.test(c[5]),
      height: num(c[6]) ? num(c[6]) / 100 : null, weight: num(c[7])
    });
  });
  return out;
}

// Acta de un partido: marcador, fecha, pabellón y estadísticas de cada jugador
function parseMatch(html, partidoId) {
  const $ = cheerio.load(html);
  const sideInfo = k => ({
    name: toTitle(clean($(`[id$=equipo${k}Nombre]`).text())),
    id: ((($(`[id$=equipo${k}HyperLink]`).attr('href')) || '').match(/i=(\d+)/) || [])[1] || null
  });
  const text = clean($('body').text());
  const fm = text.match(/Fecha\s+(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{1,2}:\d{2})/);
  const pm = text.match(/Pista\s+(.+?)\s+%/);
  const tables = $('table').toArray();
  const parseTable = t => {
    const rows = $(t).find('tr').toArray();
    const hdr = rows.findIndex(r => /Jugador/.test($(r).text()));
    const players = [];
    let totals = null;
    rows.slice(hdr + 1).forEach(r => {
      const c = $(r).find('td').map((_, td) => clean($(td).text())).get();
      const ti = c.indexOf('200:00');
      if (ti >= 0) { totals = { pts: +c[ti + 1] || 0 }; return; } // fila de totales del equipo
      if (c.length < 21) return;
      // columnas: I D Jugador MIN PT T2 T3 TC TL RO RD RT AS BR BP TF TC MT FC FR VA +/-
      const j = c.length >= 22 ? 1 : 0; // la primera columna (I = titular *) puede faltar
      const cols = c.slice(j);
      if (cols.length < 21 || !cols[1]) return;
      const [t2, t3, fg, ft] = [shot(cols[4]), shot(cols[5]), shot(cols[6]), shot(cols[7])];
      players.push({
        starter: c.length >= 22 && c[0] === '*', num: +cols[0], name: humanName(cols[1]), rawName: cols[1],
        min: minutes(cols[2]), pts: +cols[3] || 0, t2, t3, fg, ft,
        orb: +cols[8] || 0, drb: +cols[9] || 0, reb: +cols[10] || 0, ast: +cols[11] || 0,
        stl: +cols[12] || 0, tov: +cols[13] || 0, blkFor: +cols[14] || 0, blkAgainst: +cols[15] || 0,
        mt: +cols[16] || 0, fouls: +cols[17] || 0, fouled: +cols[18] || 0, val: +cols[19] || 0, pm: +cols[20] || 0
      });
    });
    return { players: players.filter(p => p.min > 0 || p.pts || p.reb || p.ast), totals };
  };
  const local = sideInfo('Local'), visitor = sideInfo('Visitante');
  const L = parseTable(tables[0]), V = parseTable(tables[1]);
  const lp = L.totals ? L.totals.pts : null, vp = V.totals ? V.totals.pts : null;
  // Las tablas siguen el orden local / visitante de la página
  return {
    id: String(partidoId), date: fm ? isoDate(fm[1]) : null, time: fm ? fm[2].padStart(5, '0') : null,
    venue: pm ? clean(pm[1]) : '',
    home: { ...local, pts: lp, players: L.players },
    away: { ...visitor, pts: vp, players: V.players },
    played: lp != null && vp != null && lp + vp > 0
  };
}

// Agenda del club (Google Calendar público, incluye las tres plantillas y horas/pabellón)
function parseICS(txt) {
  const un = txt.replace(/\r?\n[ \t]/g, ''), ev = [];
  for (const b of un.split('BEGIN:VEVENT').slice(1)) {
    const g = k => { const m = b.match(new RegExp('^' + k + '[^:\\n]*:(.*)$', 'm')); return m ? m[1].replace(/\\,/g, ',').replace(/\\n/g, ' ').replace(/\r/g, '').trim() : ''; };
    const ds = b.match(/^DTSTART[^:\n]*:(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z?))?/m);
    if (!ds) continue;
    let date = `${ds[1]}-${ds[2]}-${ds[3]}`, time = ds[4] ? `${ds[4]}:${ds[5]}` : null;
    if (ds[7] === 'Z') {
      const l = new Date(Date.UTC(+ds[1], +ds[2] - 1, +ds[3], +ds[4], +ds[5])).toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' });
      date = l.slice(0, 10); time = l.slice(11, 16);
    }
    ev.push({ sum: g('SUMMARY'), location: g('LOCATION'), date, time });
  }
  return ev;
}
// "1ªFEB 17 vs Cajasol Soto Córdoba" -> { comp, round, home, rival }
function parseAgendaItem(e) {
  const s = clean(e.sum);
  const m = s.match(/^(1ª\s?FEB|2ª\s?FEB|LF\s*Endesa|Copa[^0-9]*)?\s*(\d+)?\s*(vs\.?|@)?\s*(.*)$/i);
  if (!m) return null;
  const comp = m[1] ? clean(m[1]).replace(/^1ª\s?FEB$/i, 'Primera FEB').replace(/^2ª\s?FEB$/i, 'Segunda FEB').replace(/^LF\s*Endesa$/i, 'LF Endesa') : '';
  const rivalRaw = clean(m[4]);
  if (!m[3] || !rivalRaw) return null;
  return { comp, round: m[2] ? +m[2] : null, home: /vs/i.test(m[3]), rival: rivalRaw.replace(/\s+(SDP)$/, ' $1') };
}

// ---------- estado y sincronización ----------
let state = { lastSync: null, ok: false, errors: [], rounds: [], standings: [], roster: [], matches: {}, agenda: [], agendaSync: null };
try { state = { ...state, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch (e) { }
const persist = () => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(state)); } catch (e) { console.error("persist", e.message); } };

async function syncAgenda() {
  try {
    const t = await get(CFG.icsUrl);
    const all = parseICS(t).map(e => ({ ...e, ...(parseAgendaItem(e) || {}) })).filter(e => e.rival);
    state.agenda = all.filter(e => e.date >= '2026-08-01').sort((a, b) => (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1)
      .map(e => ({ date: e.date, time: e.time, comp: e.comp, round: e.round, home: e.home, rival: e.rival, venue: (e.location || '').split(',')[0].trim() }));
    state.agendaSync = new Date().toISOString();
  } catch (e) { state.errors = [...state.errors.filter(x => !x.startsWith('Agenda')), 'Agenda: ' + e.message]; }
}

// Sincroniza calendario, clasificación, plantilla, y actas nuevas de nuestro equipo
async function sync() {
  const errors = [];
  try {
    const cal = parseCalendar(await get(URLS.calendar()));
    if (cal.length) state.rounds = cal; else errors.push('Calendario vacío');
  } catch (e) { errors.push('Calendario: ' + e.message); }
  try { const st = parseStandings(await get(URLS.results())); if (st.length) state.standings = st; else errors.push('Clasificación vacía'); }
  catch (e) { errors.push('Clasificación: ' + e.message); }
  try { const r = parseRoster(await get(URLS.team(CFG.teamId))); if (r.length) state.roster = r; else errors.push('Plantilla vacía'); }
  catch (e) { errors.push('Plantilla: ' + e.message); }

  // Actas de nuestros partidos jugados que aún no tenemos (los ya cacheados no cambian)
  const ours = state.rounds.flatMap(r => r.matches).filter(m => m.played && m.partido && (m.homeId === CFG.teamId || m.awayId === CFG.teamId));
  for (const m of ours) {
    if (state.matches[m.partido]) continue;
    try { state.matches[m.partido] = parseMatch(await get(URLS.match(m.partido)), m.partido); await sleep(400); }
    catch (e) { errors.push(`Acta ${m.partido}: ${e.message}`); }
  }
  await syncAgenda();
  state.errors = errors.concat(state.errors.filter(x => x.startsWith('Agenda')));
  state.ok = state.rounds.length > 0 && state.standings.length > 0;
  state.lastSync = new Date().toISOString();
  persist();
  return state;
}

// Acta sobre demanda (partidos de otros equipos) con caché
// Solo se guardan en disco los partidos de nuestro equipo; los demás van a una caché en memoria con tope,
// para que pedir IDs arbitrarios no haga crecer el estado sin límite.
const OTHER = new Map(), OTHER_MAX = 100;
async function getMatch(id) {
  if (state.matches[id]) return state.matches[id];
  if (OTHER.has(id)) return OTHER.get(id);
  const m = parseMatch(await get(URLS.match(id)), id);
  if (!m.played) return m;
  if (m.home.id === CFG.teamId || m.away.id === CFG.teamId) { state.matches[id] = m; persist(); }
  else {
    if (OTHER.size >= OTHER_MAX) OTHER.delete(OTHER.keys().next().value);
    OTHER.set(id, m);
  }
  return m;
}

// ---------- agregados (lo que consume la web) ----------
const SIDE = { ours: 'home' };
function ourSide(m) { return m.home.id === CFG.teamId ? { me: m.home, opp: m.away, home: true } : { me: m.away, opp: m.home, home: false }; }

// Ficha de cada rival: clasificación, resultados de la temporada y partido contra nosotros
function rivals() {
  const byId = {};
  const std = Object.fromEntries(state.standings.filter(s => s.teamId).map(s => [s.teamId, s]));
  const nameOf = (id, fallback) => (std[id] && std[id].team) || toTitleName(fallback);
  for (const r of state.rounds) for (const m of r.matches) {
    for (const home of [true, false]) {
      const id = home ? m.homeId : m.awayId, opp = home ? m.awayId : m.homeId;
      if (!id) continue;
      const t = byId[id] || (byId[id] = { id, name: nameOf(id, home ? m.home : m.away), standing: std[id] || null, results: [] });
      t.results.push({ round: r.round, date: m.date, home, rivalId: opp, rival: nameOf(opp, home ? m.away : m.home),
        res: m.played ? (home ? [m.hs, m.as] : [m.as, m.hs]) : null, vsUs: opp === CFG.teamId });
    }
  }
  return Object.values(byId).map(t => ({ ...t, results: t.results.sort((a, b) => a.round - b.round) }));
}
const toTitleName = s => toTitle(clean(s)).replace(/\b(Cb|Hla|Fibwi|Lf|Sdp|Bc)\b/g, w => w.toUpperCase());

// Palabras significativas de un nombre (sin partículas). Se admiten apellidos cortos (Paz, Gil...).
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'da', 'do', 'dos', 'van', 'von', 'y', 'jr', 'sr']);
const nameTokens = s => norm(s).split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !PARTICLES.has(t));

// Empareja la plantilla del club con la de la FEB.
// 1) mismo dorsal y alguna palabra del nombre en común; 2) sin dorsal coincidente, al menos dos palabras en común
// (o una de 5+ letras). Lo que queda sin pareja se añade solo.
function matchRosters(clubRoster, febRoster) {
  const used = new Set(), pairs = clubRoster.map(c => ({ c, f: null }));
  const shared = (a, b) => { const tb = nameTokens(b); return nameTokens(a).filter(t => tb.includes(t)); };
  const pick = test => pairs.forEach(p => {
    if (p.f) return;
    const f = febRoster.find(x => !used.has(x) && test(p.c, x));
    if (f) { used.add(f); p.f = f; }
  });
  pick((c, x) => c.num != null && x.num === c.num && shared(c.name, x.name).length > 0);
  pick((c, x) => { const s = shared(c.name, x.name); return s.length >= 2 || s.some(t => t.length >= 5); });
  febRoster.filter(f => !used.has(f)).forEach(f => pairs.push({ c: null, f }));
  return pairs;
}

const recordOf = fixtures => {
  const played = fixtures.filter(f => f.ptsFor != null && f.ptsAgainst != null);
  return { w: played.filter(f => f.ptsFor > f.ptsAgainst).length, l: played.filter(f => f.ptsFor < f.ptsAgainst).length };
};

function build() {
  const rounds = state.rounds, roundOf = {};
  rounds.forEach(r => r.matches.forEach(m => { if (m.partido) roundOf[m.partido] = r.round; }));
  const ourMatches = Object.values(state.matches).filter(m => m.played && (m.home.id === CFG.teamId || m.away.id === CFG.teamId))
    .sort((a, b) => (roundOf[a.id] || 0) - (roundOf[b.id] || 0));

  // Jugadores: totales por partido
  const pl = {};
  for (const m of ourMatches) {
    const s = ourSide(m);
    for (const p of s.me.players) {
      const k = norm(p.name); const o = pl[k] || (pl[k] = { name: p.name, rawName: p.rawName, nums: {}, gp: 0, min: 0, pts: 0, reb: 0, orb: 0, drb: 0, ast: 0, stl: 0, tov: 0, blk: 0, fouls: 0, fouled: 0, val: 0, pm: 0, t2: [0, 0], t3: [0, 0], fg: [0, 0], ft: [0, 0], log: {}, gl: {} });
      o.nums[p.num] = 1; o.gp++; o.min += p.min; o.pts += p.pts; o.reb += p.reb; o.orb += p.orb; o.drb += p.drb; o.ast += p.ast; o.stl += p.stl; o.tov += p.tov; o.blk += p.blkFor;
      o.fouls += p.fouls; o.fouled += p.fouled; o.val += p.val; o.pm += p.pm;
      o.t2 = [o.t2[0] + p.t2[0], o.t2[1] + p.t2[1]]; o.t3 = [o.t3[0] + p.t3[0], o.t3[1] + p.t3[1]];
      o.fg = [o.fg[0] + p.fg[0], o.fg[1] + p.fg[1]]; o.ft = [o.ft[0] + p.ft[0], o.ft[1] + p.ft[1]];
      const r = roundOf[m.id];
      if (r) {
        o.log[r] = p.pts;
        o.gl[r] = { date: m.date, rival: s.opp.name, home: s.home, res: `${s.me.pts}-${s.opp.pts}`, min: +p.min.toFixed(1), pts: p.pts, reb: p.reb, ast: p.ast, stl: p.stl, blk: p.blkFor, tov: p.tov,
          fg: `${p.fg[0]}/${p.fg[1]}`, tp: `${p.t3[0]}/${p.t3[1]}`, ft: `${p.ft[0]}/${p.ft[1]}`, val: p.val, pm: p.pm };
      }
    }
  }
  const avg = (v, n) => n ? +(v / n).toFixed(1) : null;
  const pct = ([m, a]) => a ? +(m / a).toFixed(3) : null;
  // Totales del equipo para métricas avanzadas (suma de todos los jugadores de la temporada)
  const teamAdv = Object.values(pl).reduce((t, o) => ({ fga: t.fga + o.fg[1], fta: t.fta + o.ft[1], tov: t.tov + o.tov, min: t.min + o.min }), { fga: 0, fta: 0, tov: 0, min: 0 });
  // Métricas avanzadas por jugador (fórmulas estándar de baloncesto)
  const adv = o => {
    const fga = o.fg[1], fta = o.ft[1];
    return {
      ts: (fga + 0.44 * fta) ? +(o.pts / (2 * (fga + 0.44 * fta))).toFixed(3) : null,
      efg: fga ? +((o.fg[0] + 0.5 * o.t3[0]) / fga).toFixed(3) : null,
      astTo: o.tov ? +(o.ast / o.tov).toFixed(2) : (o.ast ? o.ast : null),
      usg: (o.min && teamAdv.min) ? +(100 * (fga + 0.44 * fta + o.tov) * (teamAdv.min / 5) / (o.min * (teamAdv.fga + 0.44 * teamAdv.fta + teamAdv.tov))).toFixed(1) : null
    };
  };

  // Plantilla: identidad y fotos del club (movistarestudiantes.com), estadísticas de la FEB (box scores).
  // Se cruzan por dorsal + apellido. Lo que no esté en una fuente se completa con la otra.
  const club = require('./club').state();
  const clubRoster = club.roster || [];
  const extra = (() => { try { return require(path.join(__dirname, 'data.json')).roster || []; } catch (e) { return []; } })();
  const pairs = matchRosters(clubRoster, state.roster);

  const roster = pairs.map(({ c, f }) => {
    const base = c || {}, feb = f || {};
    const name = base.name || feb.name;
    const k = norm(feb.name || name), st = pl[k] || null;
    const ex = extra.find(x => nameTokens(x.name).some(t => nameTokens(name).includes(t)) && (x.num === undefined || x.num === (base.num ?? feb.num)));
    const extraSt = st ? {
      gp: st.gp, min: avg(st.min, st.gp), ppg: avg(st.pts, st.gp), rpg: avg(st.reb, st.gp), apg: avg(st.ast, st.gp), spg: avg(st.stl, st.gp), bpg: avg(st.blk, st.gp), tov: avg(st.tov, st.gp), pf: avg(st.fouls, st.gp),
      fg: pct(st.fg), tp: pct(st.t3), ft: pct(st.ft), t2: pct(st.t2), val: avg(st.val, st.gp), pm: avg(st.pm, st.gp),
      ...adv(st),
      totals: { pts: st.pts, reb: st.reb, ast: st.ast, stl: st.stl, blk: st.blk, tov: st.tov, fgm: st.fg[0], fga: st.fg[1], tpm: st.t3[0], tpa: st.t3[1], ftm: st.ft[0], fta: st.ft[1] },
      log: st.log, gl: st.gl
    } : { gp: 0 };
    return {
      name, num: base.num ?? feb.num, pos: base.pos || feb.pos || '', height: base.height ?? feb.height ?? null,
      born: base.born || feb.born || null, birthplace: feb.birthplace || '', status: feb.status || base.category || '',
      category: base.category || '', photo: base.photo || null, profile: base.profile || null,
      career: (base.profile && club.career && club.career[base.profile]) || [],
      formed: feb.formed ?? null, hl: (ex && ex.hl) || [], ...extraSt,
      // La web del club publica el 1 de enero cuando no conoce la fecha: se marca para no mostrarla como cierta
      bornUnverified: !!(base.born && /-01-01$/.test(base.born))
    };
  });

  // Equipo: medias propias y del rival
  const tm = { n: ourMatches.length, pts: 0, opp: 0, reb: 0, oreb: 0, ast: 0, tov: 0, stl: 0, blk: 0, fg: [0, 0], t3: [0, 0], ft: [0, 0], ofg: [0, 0], ot3: [0, 0], oreb2: 0 };
  for (const m of ourMatches) {
    const s = ourSide(m), me = s.me, ot = s.opp;
    const sum = (arr, f) => arr.reduce((a, p) => a + f(p), 0);
    tm.pts += me.pts; tm.opp += ot.pts;
    tm.reb += sum(me.players, p => p.reb); tm.ast += sum(me.players, p => p.ast); tm.tov += sum(me.players, p => p.tov);
    tm.stl += sum(me.players, p => p.stl); tm.blk += sum(me.players, p => p.blkFor);
    tm.fg = [tm.fg[0] + sum(me.players, p => p.fg[0]), tm.fg[1] + sum(me.players, p => p.fg[1])];
    tm.t3 = [tm.t3[0] + sum(me.players, p => p.t3[0]), tm.t3[1] + sum(me.players, p => p.t3[1])];
    tm.ft = [tm.ft[0] + sum(me.players, p => p.ft[0]), tm.ft[1] + sum(me.players, p => p.ft[1])];
    tm.ofg = [tm.ofg[0] + sum(ot.players, p => p.fg[0]), tm.ofg[1] + sum(ot.players, p => p.fg[1])];
    tm.ot3 = [tm.ot3[0] + sum(ot.players, p => p.t3[0]), tm.ot3[1] + sum(ot.players, p => p.t3[1])];
    tm.oreb2 += sum(ot.players, p => p.reb);
  }
  const teamStats = tm.n ? {
    games: tm.n, ppg: avg(tm.pts, tm.n), papg: avg(tm.opp, tm.n), rpg: avg(tm.reb, tm.n), rpgOpp: avg(tm.oreb2, tm.n), apg: avg(tm.ast, tm.n), topg: avg(tm.tov, tm.n), spg: avg(tm.stl, tm.n), bpg: avg(tm.blk, tm.n),
    fg: pct(tm.fg), tp: pct(tm.t3), ft: pct(tm.ft), fgOpp: pct(tm.ofg), tpOpp: pct(tm.ot3)
  } : null;

  // Calendario de nuestro equipo (con horas y pabellón de la agenda cuando faltan)
  const fixtures = [];
  for (const r of rounds) for (const m of r.matches) {
    if (m.homeId !== CFG.teamId && m.awayId !== CFG.teamId) continue;
    const home = m.homeId === CFG.teamId;
    const acta = m.partido && state.matches[m.partido];
    const rival = home ? m.away : m.home;
    // Hora y pabellón: del acta si el partido ya está en la web de FEB; si no, de la agenda del club (misma jornada y rival)
    const ag = state.agenda.find(a => a.comp === 'Primera FEB' && a.round === m.round && sameName(a.rival, rival));
    const date = acta && acta.date && acta.time ? madridISO(acta.date, acta.time) : ag && ag.time ? madridISO(ag.date, ag.time) : madridISO(m.date, null);
    fixtures.push({
      id: m.partido || `J${m.round}-${home ? m.awayId : m.homeId}`,
      round: m.round, comp: 'Primera FEB', partido: m.partido,
      date, noTime: !((acta && acta.time) || (ag && ag.time)),
      home, rival, rivalId: home ? m.awayId : m.homeId,
      ptsFor: m.played ? (home ? m.hs : m.as) : null, ptsAgainst: m.played ? (home ? m.as : m.hs) : null,
      venue: (acta && acta.venue) || (ag && ag.venue) || '', top: '', note: ''
    });
  }
  return {
    fixtures: fixtures.sort((a, b) => new Date(a.date) - new Date(b.date)),
    standings: state.standings,
    roster,
    teamStats,
    agenda: state.agenda,
    rivals: rivals(),
    // Del calendario (marcadores de la FEB), no de las actas: si falla la descarga de un acta el récord sigue cuadrando con los resultados
    record: recordOf(fixtures)
  };
}

module.exports = { sync, syncAgenda, getMatch, build, state: () => state, CFG, parseCalendar, parseStandings, parseRoster, parseMatch, parseICS, parseAgendaItem, madridISO, matchRosters, recordOf };
