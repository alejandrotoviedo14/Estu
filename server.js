const express=require('express'),fs=require('fs'),path=require('path'),S=require('./sync');
const app=express(),PORT=process.env.PORT||3000,MIN=+process.env.SYNC_MINUTES||10;
const readData=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8'));
let cache={t:0,items:[]};
async function news(){
  if(Date.now()-cache.t<6e5) return cache.items;
  try{
    const url='https://news.google.com/rss/search?q='+encodeURIComponent('"Movistar Estudiantes" when:14d')+'&hl=es&gl=ES&ceid=ES:es';
    const xml=await (await fetch(url)).text();
    const g=(s,t)=>{const r=s.match(new RegExp('<'+t+'[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</'+t+'>'));return r?r[1].trim():''};
    cache={t:Date.now(),items:[...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,25).map(m=>({title:g(m[1],'title'),link:g(m[1],'link'),date:g(m[1],'pubDate'),source:g(m[1],'source')}))};
  }catch(e){console.error('news',e.message)}
  return cache.items;
}
app.get('/api/data',(q,r)=>{try{const d=readData(),s=S.getState();
  for(const k of ['fixtures','standings','roster'])if(s[k]&&s[k].length)d[k]=s[k];
  d.sync={lastSync:s.lastSync,ok:s.ok,errors:s.errors,counts:{fixtures:s.fixtures.length,standings:s.standings.length,roster:s.roster.length}};
  r.json(d)}catch(e){r.status(500).json({error:e.message})}});
app.get('/api/news',async(q,r)=>r.json(await news()));
app.get('/api/sync',async(q,r)=>r.json(await S.sync()));
app.get('/api/debug/raw',async(q,r)=>{try{const h=await S.get(S.PAGES[q.query.page]||S.PAGES.results);r.type('text').send(h.slice(0,+q.query.n||4000))}catch(e){r.status(500).send(e.message)}});
app.get('/health',(q,r)=>r.send('ok'));
app.use(express.static(path.join(__dirname,'public')));
app.listen(PORT,'0.0.0.0',()=>{console.log('Estudiantes tracker on '+PORT);S.sync();setInterval(S.sync,MIN*60e3)});
