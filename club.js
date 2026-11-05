// Fuente oficial del club (movistarestudiantes.com): plantilla con fotos, dorsal, posición,
// altura, fecha de nacimiento, categoría (comunitario, formado localmente...), cuerpo técnico
// e historial de clubes de cada jugador (página de perfil).
const cheerio = require('cheerio'), fs = require('fs'), path = require('path');

const SITE = 'https://www.movistarestudiantes.com';
const ROSTER_URL = process.env.CLUB_ROSTER_URL || `${SITE}/plantilla-masculina/`;
const FILE = path.join(process.env.DATA_DIR || '/tmp', 'club-state.json');

const clean = s => String(s ?? '').replace(/\s+/g, ' ').replace(/ /g, ' ').trim();
const toTitle = s => s.toLocaleLowerCase('es').replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('es'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 (EstudiantesTracker)', 'accept-language': 'es-ES' } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.text();
}

const STAFF_ROLE = /ENTRENADOR|DELEGADO|PREPARADOR|FISIOTERAPEUTA|PSICÓLOGO|NUTRICIONISTA|RESPONSABLE|MÉDICO|ANALISTA/i;

// Plantilla y cuerpo técnico desde la página oficial
function parseClubRoster(html) {
  const $ = cheerio.load(html), players = [], staff = [];
  $('article.player').each((_, a) => {
    const h = $(a).find('figcaption h6').map((_, x) => clean($(x).text())).get();
    const name = clean($(a).find('h2').text());
    const img = $(a).find('img').attr('src') || null;
    const url = $(a).find('h2 a').attr('href') || $(a).find('figure > a').attr('href') || null;
    if (!name) return;
    if (STAFF_ROLE.test(h[0] || '') && !/^\d/.test(h[0] || '')) {
      staff.push({ name, role: toTitle(h[0]), photo: img });
      return;
    }
    // Orden de los datos de un jugador: dorsal, posición, altura, nacimiento, categoría, (nº de temporadas)
    players.push({
      name, num: parseInt(h[0], 10) || null, pos: toTitle(h[1] || '').replace('Ala-pívot', 'Ala-pívot'),
      height: parseFloat(h[2]) || null, born: /^\d{4}-\d{2}-\d{2}$/.test(h[3]) ? h[3] : null,
      category: toTitle(h[4] || ''), photo: img, profile: url
    });
  });
  return { players, staff };
}

// Historial de clubes del perfil: "2026-2027 Movistar Estudiantes. Primera FEB. 2025-2026 ..."
function parseCareer(html) {
  const $ = cheerio.load(html);
  const t = clean($('body').text());
  const i = t.indexOf('Temporadas en el club');
  if (i < 0) return [];
  // El bloque de historial está después del widget de Twitter y antes del pie de página
  const stops = ['info@', '©', 'Aviso Legal'].map(x => t.indexOf(x, i)).filter(x => x > i);
  const end = stops.length ? Math.min(...stops) : t.length;
  const seg = t.slice(i + 'Temporadas en el club'.length, end);
  const out = [];
  for (const m of seg.matchAll(/(\d{4}-\d{4})\s+([^.]+?)\.\s+([^.]+?)\.(?=\s|$)/g)) {
    out.push({ season: m[1], club: clean(m[2]), league: clean(m[3]) });
  }
  return out;
}

let state = { lastSync: null, roster: null, staff: [], career: {} };
try { state = { ...state, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch (e) { }
const persist = () => { try { fs.writeFileSync(FILE, JSON.stringify(state)); } catch (e) { } };

// Sincroniza plantilla; los perfiles (historial) se piden una vez por jugador y se cachean
async function sync() {
  const errors = [];
  try {
    const { players, staff } = parseClubRoster(await get(ROSTER_URL));
    if (players.length) { state.roster = players; state.staff = staff; }
    else errors.push('Plantilla del club vacía');
  } catch (e) { errors.push('Plantilla del club: ' + e.message); }

  for (const p of state.roster || []) {
    if (!p.profile || state.career[p.profile]) continue;
    try { state.career[p.profile] = parseCareer(await get(p.profile)); await sleep(400); }
    catch (e) { errors.push(`Perfil ${p.name}: ${e.message}`); }
  }
  state.lastSync = new Date().toISOString();
  state.errors = errors;
  persist();
  return state;
}

module.exports = { sync, state: () => state, parseClubRoster, parseCareer, ROSTER_URL };
