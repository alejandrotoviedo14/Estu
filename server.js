process.on('uncaughtException',e=>console.error('uncaught',e));process.on('unhandledRejection',e=>console.error('unhandled',e));
const express=require('express'),fs=require('fs'),path=require('path'),S=require('./sync'),ST=require('./stats'),RG=require('./realgm');
const app=express(),PORT=process.env.PORT||3000,MIN=+process.env.SYNC_MINUTES||10;
const readData=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8'));
let cache={t:0,items:[]};
async function news(){
  if(Date.now()-cache.t<6e5) return cache.items;
  try{
    const url='https://news.google.com/rss/search?q='+encodeURIComponent('"Movistar Estudiantes" when:14d')+'&hl=es&gl=ES&ceid=ES:es';
    const xml=await (await fetch(url,{signal:AbortSignal.timeout(8000)})).text();
    const g=(s,t)=>{const r=s.match(new RegExp('<'+t+'[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</'+t+'>'));return r?r[1].trim():''};
    cache={t:Date.now(),items:[...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,25).map(m=>({title:g(m[1],'title'),link:g(m[1],'link'),date:g(m[1],'pubDate'),source:g(m[1],'source')}))};
  }catch(e){console.error('news',e.message)}
  return cache.items;
}
app.get('/api/data',(q,r)=>{try{const d=readData(),s=S.getState();
  if(s.standings.length)d.standings=s.standings;
  const key=f=>f.date.slice(0,10),m=new Map(d.fixtures.map(f=>[key(f),f]));
  s.fixtures.forEach(f=>{const o=m.get(key(f));if(!o||(f.ptsFor!=null&&o.ptsFor==null))m.set(key(f),{...o,...f})});d.fixtures=[...m.values()];
  d.sync={lastSync:s.lastSync,ok:s.ok,errors:s.errors,sample:s.sample||[],counts:{fixtures:s.fixtures.length,standings:s.standings.length,roster:s.roster.length}};
  const a=Object.values(ST.state().players),pn=d.fixtures.filter(f=>f.ptsFor!=null).length,sp=ST.state();
  d.roster.forEach(p=>{const k=ST.KEYS.find(k=>ST.norm(p.name).includes(k)),lg=k&&sp.players[k];if(lg&&Object.keys(lg).length){p.log={...(p.log||{}),...lg};const v=Object.values(p.log);if(p.ppg==null||v.length>=pn)p.ppg=Math.round(v.reduce((x,y)=>x+y,0)/v.length*10)/10}
    for(const[m,f]of[['val','val'],['pts','ppg'],['reb','rpg'],['ast','apg']]){const e=sp.leaders&&sp.leaders[m]&&sp.leaders[m].find(x=>x.k==k);if(e)p[f]=e.v}});
  const rg=RG.state().players,rk=Object.fromEntries(d.fixtures.filter(f=>f.round).map(f=>[f.date.slice(0,10),f.round]));
  d.roster.forEach(p=>{const k=ST.KEYS.find(k=>ST.norm(p.name).includes(k)),x=k&&rg[k];if(!x)return;const g=x.pg||{},a=x.adv||{};
    Object.assign(p,{gp:g.GP,min:g.MIN,ppg:g.PTS,rpg:g.REB,apg:g.AST,spg:g.STL,bpg:g.BLK,tov:g.TOV,fg:g['FG%'],tp:g['3P%'],ft:g['FT%'],ts:a['TS%'],usg:a['USG%'],per:a.PER,ortg:a.ORtg,drtg:a.DRtg});
    (x.games||[]).forEach(m=>{const j=rk[m.date];if(j){(p.log=p.log||{})[j]=m.pts;(p.gl=p.gl||{})[j]=m}})});
  Object.entries(sp.results||{}).forEach(([j,r])=>{const f=d.fixtures.find(x=>x.round==j);if(f&&f.ptsFor==null){f.ptsFor=r.f;f.ptsAgainst=r.a}});
  d.sync.rg={lastSync:RG.state().lastSync,ok:RG.state().ok,errors:RG.state().errors};
  d.mvps=sp.mvps;d.sync.stats={lastSync:sp.lastSync,ok:sp.ok,errors:sp.errors,games:sp.games};
  r.json(d)}catch(e){r.status(500).json({error:e.message})}});
app.get('/api/news',async(q,r)=>r.json(await news()));
app.get('/api/sync',async(q,r)=>r.json(await S.sync()));
app.get('/api/debug/raw',async(q,r)=>{try{const h=await S.get(S.PAGES[q.query.page]||S.PAGES.results);r.type('text').send(h.slice(0,+q.query.n||4000))}catch(e){r.status(500).send(e.message)}});
app.get('/api/stats-sync',async(q,r)=>r.json(await ST.sync()));
app.get('/api/stats-status',(q,r)=>r.json(ST.state()));
app.get('/api/rg-sync',async(q,r)=>r.json(await RG.sync()));
app.get('/api/rg-status',(q,r)=>r.json(RG.state()));
const IMG=new Map();
app.get('/img',async(q,r)=>{try{const u=new URL(q.query.u);if(!/(^|\.)(movistarestudiantes\.com|365scores\.com)$/.test(u.hostname))return r.sendStatus(403);
  let c=IMG.get(u.href);if(!c){const x=await fetch(u.href,{signal:AbortSignal.timeout(8000),headers:{'user-agent':'Mozilla/5.0','referer':u.origin+'/','accept':'image/*'}});if(!x.ok)return r.sendStatus(404);c={t:x.headers.get('content-type')||'image/jpeg',b:Buffer.from(await x.arrayBuffer())};if(IMG.size>300)IMG.delete(IMG.keys().next().value);IMG.set(u.href,c)}
  r.set('Content-Type',c.t).set('Cache-Control','public,max-age=604800').send(c.b)}catch(e){r.sendStatus(404)}});
app.get('/health',(q,r)=>r.send('ok'));
app.use(express.static(path.join(__dirname,'public')));
app.listen(PORT,'0.0.0.0',()=>{console.log('Estudiantes tracker on '+PORT);const safe=f=>()=>Promise.resolve().then(f).catch(e=>console.error('sync',e&&e.message));setTimeout(()=>[S.sync,ST.sync,RG.sync].forEach(f=>safe(f)()),4000);[S.sync,ST.sync].forEach(f=>setInterval(safe(f),MIN*60e3));setInterval(safe(RG.sync),(+process.env.RG_MINUTES||180)*60e3)});
