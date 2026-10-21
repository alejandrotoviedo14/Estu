const express=require('express'),fs=require('fs'),path=require('path');
const app=express(),PORT=process.env.PORT||3000;
const readData=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8'));
let cache={t:0,items:[]};
async function news(){
  if(Date.now()-cache.t<6e5) return cache.items;
  try{
    const url='https://news.google.com/rss/search?q='+encodeURIComponent('"Movistar Estudiantes" when:14d')+'&hl=es&gl=ES&ceid=ES:es';
    const xml=await (await fetch(url)).text();
    const g=(s,t)=>{const r=s.match(new RegExp('<'+t+'[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</'+t+'>'));return r?r[1].trim():''};
    const items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,25).map(m=>({title:g(m[1],'title'),link:g(m[1],'link'),date:g(m[1],'pubDate'),source:g(m[1],'source')}));
    cache={t:Date.now(),items};
  }catch(e){console.error('news',e.message)}
  return cache.items;
}
app.get('/api/data',(q,r)=>{try{r.json(readData())}catch(e){r.status(500).json({error:e.message})}});
app.get('/api/news',async(q,r)=>r.json(await news()));
app.get('/health',(q,r)=>r.send('ok'));
app.use(express.static(path.join(__dirname,'public')));
app.listen(PORT,'0.0.0.0',()=>console.log('Estudiantes tracker on '+PORT));
