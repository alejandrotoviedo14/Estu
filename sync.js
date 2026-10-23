const cheerio=require('cheerio'),fs=require('fs'),path=require('path');
const TEAM=(process.env.TEAM_MATCH||'estudiantes').toLowerCase();
const G=process.env.FEB_GROUP||'1',T=process.env.FEB_SEASON||'2026';
const BASE='https://competiciones.feb.es/estadisticas/';
const PAGES={results:`${BASE}Resultados.aspx?g=${G}&t=${T}`,standings:`${BASE}Clasificacion.aspx?g=${G}&t=${T}`};
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
async function sync(){const errors=[];let fx=[],st=[];
  try{const h=await get(PAGES.results);state.rawLen.results=h.length;fx=parseFixtures(h);st=parseStandings(h)}catch(e){errors.push(e.message)}
  try{const h=await get(PAGES.standings);state.rawLen.standings=h.length;const s=parseStandings(h);if(s.length)st=s}catch(e){errors.push(e.message)}
  if(fx.length)state.fixtures=fx;if(st.length)state.standings=st;
  state.errors=errors;state.lastSync=new Date().toISOString();state.ok=!errors.length&&(fx.length>0||st.length>0);persist();return state}
module.exports={sync,get,PAGES,getState:()=>state};
