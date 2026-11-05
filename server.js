process.on('uncaughtException', e => console.error('uncaught', e));
process.on('unhandledRejection', e => console.error('unhandled', e));
const express = require('express'), fs = require('fs'), path = require('path'), F = require('./feb'), C = require('./club'), ICS = require('./ics');

const app = express(), PORT = process.env.PORT || 3000, MIN = +process.env.SYNC_MINUTES || 15;
const readStatic = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));

// /api/data: datos del club (estáticos) + lo sincronizado desde la FEB. Se recalcula solo cuando cambia la sincronización.
let memo = { key: null, body: null };
function payload() {
  const st = F.state(), cs = C.state(), key = [st.lastSync, st.agendaSync, cs.lastSync].join('|');
  if (memo.key === key) return memo.body;
  const s = readStatic(), b = F.build();
  memo = {
    key, body: {
      season: s.season, motto: s.motto, club: s.club, teams: s.teams, history: s.history,
      staff: (cs.staff && cs.staff.length) ? cs.staff : s.staff,
      fixtures: b.fixtures, standings: b.standings, roster: b.roster, teamStats: b.teamStats, agenda: b.agenda, record: b.record,
      sync: {
        lastSync: st.lastSync, ok: st.ok, errors: st.errors, agendaSync: st.agendaSync,
        counts: { fixtures: b.fixtures.length, played: b.fixtures.filter(f => f.ptsFor != null).length, standings: b.standings.length, roster: b.roster.length, actas: Object.keys(st.matches).length, agenda: b.agenda.length }
      }
    }
  };
  return memo.body;
}

let syncing = null;
const runSync = () => syncing || (syncing = Promise.allSettled([F.sync(), C.sync()])
  .catch(e => console.error('sync', e && e.message)).finally(() => { syncing = null; }));

// Calendario del móvil (.ics): un partido o toda la temporada
const clubName = () => (readStatic().club || {}).name || 'Movistar Estudiantes';
const icsHeaders = (r, name) => r.type('text/calendar; charset=utf-8').set('Content-Disposition', `attachment; filename="${name}"`);
app.get('/calendario/partido/:id.ics', (q, r) => {
  const f = F.build().fixtures.find(x => x.id === q.params.id);
  if (!f) return r.status(404).send('Partido no encontrado');
  icsHeaders(r, `estudiantes-${f.round ? 'J' + f.round + '-' : ''}${f.rival.replace(/\W+/g, '-').toLowerCase()}.ics`).send(ICS.calendar([f], { name: clubName(), club: clubName() }));
});
app.get('/calendario/temporada.ics', (q, r) => {
  const fx = F.build().fixtures;
  icsHeaders(r, 'estudiantes-temporada.ics').send(ICS.calendar(fx, { name: clubName() + ' · temporada', club: clubName() }));
});

app.get('/api/data', (q, r) => { try { r.json(payload()); } catch (e) { r.status(500).json({ error: e.message }); } });
app.get('/api/match/:id', async (q, r) => {
  const id = String(q.params.id).replace(/\D/g, '');
  if (!id) return r.status(400).json({ error: 'id de partido no válido' });
  try { r.json(await F.getMatch(id)); }
  catch (e) { r.status(502).json({ error: e.message }); }
});
app.get('/api/sync', async (q, r) => { await runSync(); const st = F.state(); r.json({ ok: st.ok, lastSync: st.lastSync, errors: st.errors }); });

// Noticias (Google News RSS), cacheadas 10 min
let newsCache = { t: 0, items: [] };
async function news() {
  if (Date.now() - newsCache.t < 6e5) return newsCache.items;
  // 1) Noticias oficiales del club (WordPress)
  try {
    const posts = await (await fetch(`${'https://www.movistarestudiantes.com'}/wp-json/wp/v2/posts?per_page=20&_fields=title,link,date`, { signal: AbortSignal.timeout(8000) })).json();
    if (Array.isArray(posts) && posts.length) {
      const cheerio = require('cheerio');
      newsCache = { t: Date.now(), items: posts.map(p => ({ title: cheerio.load('<p>' + p.title.rendered + '</p>')('p').text(), link: p.link, date: p.date, source: 'Movistar Estudiantes' })) };
      return newsCache.items;
    }
  } catch (e) { console.error('news club', e.message); }
  // 2) Respaldo: Google News
  try {
    const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent('"Movistar Estudiantes" when:14d') + '&hl=es&gl=ES&ceid=ES:es';
    const xml = await (await fetch(url, { signal: AbortSignal.timeout(8000) })).text();
    const g = (s, t) => { const r = s.match(new RegExp('<' + t + '[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</' + t + '>')); return r ? r[1].trim() : ''; };
    newsCache = { t: Date.now(), items: [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 25).map(m => ({ title: g(m[1], 'title'), link: g(m[1], 'link'), date: g(m[1], 'pubDate'), source: g(m[1], 'source') })) };
  } catch (e) { console.error('news', e.message); }
  return newsCache.items;
}
app.get('/api/news', async (q, r) => r.json(await news()));

// Proxy de imágenes restringido a dominios conocidos
const IMG = new Map();
app.get('/img', async (q, r) => {
  try {
    const u = new URL(q.query.u);
    if (!/(^|\.)(movistarestudiantes\.com|365scores\.com|feb\.es)$/.test(u.hostname)) return r.sendStatus(403);
    let c = IMG.get(u.href);
    if (!c) {
      const x = await fetch(u.href, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0', 'referer': u.origin + '/', 'accept': 'image/*' } });
      if (!x.ok) return r.sendStatus(404);
      c = { t: x.headers.get('content-type') || 'image/jpeg', b: Buffer.from(await x.arrayBuffer()) };
      if (IMG.size > 300) IMG.delete(IMG.keys().next().value);
      IMG.set(u.href, c);
    }
    r.set('Content-Type', c.t).set('Cache-Control', 'public,max-age=604800').send(c.b);
  } catch (e) { r.sendStatus(404); }
});

app.get('/health', (q, r) => r.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log('Estudiantes tracker on ' + PORT);
  setTimeout(runSync, 4000);
  setInterval(runSync, MIN * 60e3);
});
