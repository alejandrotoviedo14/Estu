const cheerio=require('cheerio'),fs=require('fs'),path=require('path');
const BASE='https://www.movistarestudiantes.com',FILE=path.join(process.env.DATA_DIR||'/tmp','stats-state.json');
let st={lastSync:null,ok:false,errors:[],players:{},mvps:{},leaders:null,games:0,results:{}};
try{st={...st,...JSON.parse(fs.readFileSync(FILE,'utf8'))}}catch(e){}
const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const KEYS=['speight','silverio','giovannetti','vaulet','niang','walker','jimenez','munnings','treier','tisma','floyd','westermann','aurrecoechea','zurbriggen'];
async function get(u){const c=new AbortController(),t=setTimeout(()=>c.abort(),15000);try{const r=await fetch(u,{signal:c.signal,headers:{'user-agent':'Mozilla/5.0 (EstudiantesTracker)','accept-language':'es-ES'}});if(!r.ok)throw new Error(u+' -> HTTP '+r.status);return await r.text()}finally{clearTimeout(t)}}
async function posts(){
  try{return JSON.parse(await get(BASE+'/wp-json/wp/v2/posts?per_page=40&_fields=title,link,date,content')).map(p=>({title:p.title.rendered,link:p.link,date:p.date,html:p.content.rendered}))}catch(e){}
  const $=cheerio.load(await get(BASE+'/noticia/')),ls=[...new Set($('a').map((_,a)=>$(a).attr('href')).get().filter(h=>/\/masculino\//.test(h||'')))].slice(0,14);
  return Promise.all(ls.map(async l=>{const $$=cheerio.load(await get(l));return{title:$$('h1').first().text(),link:l,date:$$('time').first().attr('datetime')||'',html:$$('main,article,body').first().html()}}))}
const txt=h=>cheerio.load('<div>'+h+'</div>')('div').text().replace(/\s+/g,' ');
function parseRecap(p){const m=p.title.replace(/<[^>]+>/g,'').match(/Primera FEB J(\d+):.*\((\d+)\s*-\s*(\d+)\)/);if(!m)return null;
  const t=txt(p.html),i=t.search(/Los números/i);if(i<0)return null;
  const parts=t.slice(i).split(/\(\s*\d+\s*-\s*\d+\s*-\s*\d+\s*-\s*\d+\s*\)/);
  const score=s=>KEYS.filter(k=>norm(s).includes(k)).length,mine=parts.sort((a,b)=>score(b)-score(a))[0]||'';
  const pl={};for(const x of mine.matchAll(/([A-ZÁÉÍÓÚÑ][\p{L}'’.-]+)\s*\(\s*(\d+|-)?\s*\)/gu)){const k=KEYS.find(k=>norm(x[1]).includes(k));if(k&&x[2]&&x[2]!='-')pl[k]=+x[2]}
  const mv=t.match(/(?:El mejor|mejor estudiantil)[^.]*?(\d+) puntos(?:, (\d+) rebotes)?(?:,? (\d+) asistencias)?[^.]*?(\d+) de valoración/i);
  const tp=[...t.matchAll(/\(\s*(\d+(?:-\d+){3,5})\s*\)/g)].map(x=>({i:x.index,s:x[1].split('-').reduce((a,b)=>a+ +b,0)})),me=tp.find(x=>/estudiantes/i.test(t.slice(Math.max(0,x.i-45),x.i))),ot=tp.find(x=>x!==me),res=me&&ot?{f:me.s,a:ot.s}:null;
  return{j:+m[1],pl,res,mvp:mv?{k:KEYS.find(k=>norm(t.slice(Math.max(0,t.search(/El mejor/i)),t.search(/El mejor/i)+160)).includes(k)),pts:+mv[1],reb:+mv[2]||null,ast:+mv[3]||null,val:+mv[4]}:null}}
const dec=s=>+String(s).replace(',','.');
function parseLeaders(t){const g=(a,b)=>{const m=t.match(new RegExp(a+':?\\*{0,2}\\s*(.*?)\\s*(?:'+b+')'));return m?[...m[1].matchAll(/([\p{L}'’. ]+?)\s*\(([\d,.]+)\)/gu)].map(x=>({k:KEYS.find(k=>norm(x[1]).includes(k)),v:dec(x[2])})).filter(x=>x.k):[]};
  return{val:g('Más valorados','Máximos anotadores'),pts:g('Máximos anotadores','Máximos reboteadores'),reb:g('Máximos reboteadores','Máximos asistentes'),ast:g('Máximos asistentes','\\.\\s|$')}}
async function sync(){const errors=[];try{const ps=await posts(),players={},mvps={},results={};let leaders=null,lj=-1,games=0;
  for(const p of ps){const r=parseRecap(p);if(r){games++;for(const[k,v]of Object.entries(r.pl))(players[k]=players[k]||{})[r.j]=v;if(r.mvp&&r.mvp.k)mvps[r.j]=r.mvp;if(r.res)results[r.j]=r.res}
    const t=txt(p.html),jm=p.title.match(/J(\d+)/),L=/Más valorados/.test(t)&&jm?+jm[1]:-1;if(L>lj){const x=parseLeaders(t);if(x.val.length||x.pts.length){leaders=x;lj=L}}}
  if(games){st.players=players;st.mvps=mvps;st.results=results;st.games=games}if(leaders)st.leaders=leaders;st.ok=games>0||!!leaders;if(!st.ok)errors.push('Sin actas ni líderes reconocibles en la web del club')}catch(e){errors.push(e.message)}
  st.errors=errors;st.lastSync=new Date().toISOString();try{fs.writeFileSync(FILE,JSON.stringify(st))}catch(e){}return st}
module.exports={sync,state:()=>st,KEYS,norm};
