const cheerio=require('cheerio'),fs=require('fs'),path=require('path');
const TEAM=(process.env.TEAM_MATCH||'estudiantes').toLowerCase();
const G=process.env.FEB_GROUP||'1',T=process.env.FEB_SEASON||'2026';
const BASE='https://competiciones.feb.es/estadisticas/';
const PAGES={results:`${BASE}Resultados.aspx?g=${G}&t=${T}`,standings:`${BASE}Clasificacion.aspx?g=${G}&t=${T}`};
const S365='https://www.365scores.com/es/basketball/team/movistar-estudiantes-220/standings';
const ICS='https://calendar.google.com/calendar/ical/8f9841fadce9be548c94e378f5639fc0eac0310cd23f1c3c75703446d38dd1bd%40group.calendar.google.com/public/basic.ics';
const NOT=/femenin|women|cantera|junior|cadete|infantil|mini|sub[ -]?\d|u\d\d|segunda feb/i;
function parseICS(txt){const un=txt.replace(/\r?\n[ \t]/g,''),ev=[];for(const b of un.split('BEGIN:VEVENT').slice(1)){const g=k=>{const m=b.match(new RegExp('^'+k+'[^:\\n]*:(.*)$','m'));return m?m[1].replace(/\\,/g,',').replace(/\\n/g,' ').replace(/\r/g,'').trim():''};
  const ds=b.match(/^DTSTART[^:\n]*:(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z?))?/m);if(!ds)continue;let date=`${ds[1]}-${ds[2]}-${ds[3]}`,time=ds[4]?`${ds[4]}:${ds[5]}:00`:null;
  if(ds[7]==='Z'){const l=new Date(Date.UTC(+ds[1],+ds[2]-1,+ds[3],+ds[4],+ds[5])).toLocaleString('sv-SE',{timeZone:'Europe/Madrid'});date=l.slice(0,10);time=l.slice(11,19)}
  ev.push({sum:g('SUMMARY'),desc:g('DESCRIPTION'),loc:g('LOCATION'),date,time})}return ev}
function icsFixtures(ev){return ev.filter(e=>e.date>='2026-09-01'&&/estudiantes/i.test(e.sum)&&!NOT.test(e.sum+' '+e.desc)).map(e=>{
  const p=e.sum.replace(/\(.*?\)|\bJ\s*\d+\b|primera feb|liga|[:|]/gi,' ').split(/\s+(?:vs\.?|-|–|—)\s+/i).map(x=>x.trim()).filter(Boolean),me=p.findIndex(x=>/estudiantes/i.test(x));if(p.length<2||me<0)return null;
  const j=(e.sum+' '+e.desc).match(/J(?:ornada)?\s*(\d+)/i);return{round:j?+j[1]:null,comp:/copa/i.test(e.sum)?'Copa de España':'Primera FEB',date:e.date+'T'+(e.time||'00:00:00'),home:me===0,rival:p[me===0?1:0],ptsFor:null,ptsAgainst:null,top:'',note:'',noTime:!e.time}}).filter(Boolean)}
const FILE=path.join(process.env.DATA_DIR||'/tmp','sync-state.json');
let state={lastSync:null,ok:false,errors:[],fixtures:[],standings:[],roster:[],rawLen:{}};
try{state={...state,...JSON.parse(fs.readFileSync(FILE,'utf8'))}}catch(e){}
const persist=()=>{try{fs.writeFileSync(FILE,JSON.stringify(state))}catch(e){}};
async function get(u){const c=new AbortController(),t=setTimeout(()=>c.abort(),15000);
  try{const r=await fetch(u,{signal:c.signal,headers:{'user-agent':'Mozilla/5.0 (EstudiantesTracker)','accept-language':'es-ES'}});
    if(!r.ok)throw new Error(u+' -> HTTP '+r.status);return await r.text()}finally{clearTimeout(t)}}
const num=s=>{const n=parseInt(String(s??'').replace(/[^\d-]/g,''),10);return isNaN(n)?null:n};
const cells=($,tr)=>$(tr).find('th,td').map((_,c)=>$(c).text().trim().replace(/\s+/g,' ')).get();
function parseStandings(html){const $=cheerio.load(html);let out=[];
  $('table').each((_,tb)=>{const rows=$(tb).find('tr').map((_,tr)=>[cells($,tr)]).get();
    const hi=rows.findIndex(r=>r.some(c=>/^equipo$/i.test(c))&&r.some(c=>/^(pj|j)$/i.test(c)));if(hi<0)return;
    const h=rows[hi].map(c=>c.toLowerCase()),ix=(...k)=>h.findIndex(c=>k.includes(c));
    const iT=ix('equipo'),iPJ=ix('pj','j'),iW=ix('g','v','pg'),iL=ix('p','d','pp'),iPF=ix('pf'),iPC=ix('pc');
    const res=rows.slice(hi+1).filter(r=>r[iT]&&num(r[iPJ])!=null).map((r,i)=>({pos:i+1,team:r[iT],pj:num(r[iPJ]),w:num(r[iW])??0,l:num(r[iL])??0,pf:num(r[iPF])??0,pc:num(r[iPC])??0}));
    if(res.length>out.length)out=res});
  return out}
function parseFixtures(html){const $=cheerio.load(html),out=[];let rnd=null;
  $('tr').each((_,tr)=>{const c=cells($,tr),line=c.join(' | '),jm=line.match(/jornada\s*(\d+)/i);
    if(jm&&c.length<3){rnd=+jm[1];return}
    if(!line.toLowerCase().includes(TEAM))return;
    const sc=c.find(x=>/^\d{2,3}\s*[-–]\s*\d{2,3}$/.test(x)),dm=line.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D+(\d{1,2}):(\d{2}))?/);
    const teams=c.filter(x=>x.length>2&&/[A-Za-zÁ-ú]{3}/.test(x)&&!/\d{1,2}\/\d{1,2}\/\d{4}/.test(x));
    const mine=teams.findIndex(x=>x.toLowerCase().includes(TEAM));if(mine<0||teams.length<2||!dm)return;
    const home=mine===0,[a,b]=sc?sc.split(/[-–]/).map(num):[null,null],p=n=>String(n).padStart(2,'0');
    out.push({round:rnd,comp:'Primera FEB',date:`${dm[3]}-${p(dm[2])}-${p(dm[1])}T${p(dm[4]||0)}:${p(dm[5]||0)}:00`,home,rival:teams[home?1:0],ptsFor:sc?(home?a:b):null,ptsAgainst:sc?(home?b:a):null})});
  return out}
function parse365(html){const $=cheerio.load(html),out=[];$('tr').each((_,tr)=>{const c=cells($,tr),i=c.findIndex(x=>/^\d{1,2}\s+\D/.test(x));if(i<0)return;const m=c[i].match(/^(\d{1,2})\s+(.+)$/),n=c.slice(i+1).filter(x=>/^\d+$/.test(x)).map(Number);if(n.length>=4)out.push({pos:+m[1],team:m[2],pj:n[0],w:n[1],l:n[2],pts:n[3],pf:0,pc:0})});return out}
async function sync(){const errors=[];let fx=[],st=[];
  try{const t=await get(ICS),ev=parseICS(t);state.sample=ev.filter(e=>e.date>='2026-09-01').slice(0,6).map(e=>`${e.date} ${e.time||''} · ${e.sum}`);fx=icsFixtures(ev);state.rawLen.ics=t.length}catch(e){errors.push('Calendario del club: '+e.message)}
  try{const h=await get(S365);state.rawLen.s365=h.length;st=parse365(h)}catch(e){errors.push('Clasificación: '+e.message)}
  if(fx.length)state.fixtures=fx;if(st.length)state.standings=st;
  state.errors=errors;state.lastSync=new Date().toISOString();state.ok=(fx.length>0||st.length>0);persist();return state}
module.exports={sync,get,PAGES,getState:()=>state,parseICS,icsFixtures};
