const cheerio=require('cheerio'),fs=require('fs'),path=require('path'),{KEYS,norm}=require('./stats');
const FILE=path.join(process.env.DATA_DIR||'/tmp','realgm-state.json'),ROSTER='https://basketball.realgm.com/international/league/55/Spanish-Primera-FEB/team/32/Movistar-Estudiantes/rosters/2027';
let st={lastSync:null,ok:false,errors:[],players:{},ids:{vaulet:'https://basketball.realgm.com/player/Juan-Vaulet/Summary/41359'}};
try{st={...st,...JSON.parse(fs.readFileSync(FILE,'utf8'))}}catch(e){}
const wrap=u=>process.env.SCRAPER_URL?process.env.SCRAPER_URL.replace('{url}',encodeURIComponent(u)):u;
async function get(u){const c=new AbortController(),t=setTimeout(()=>c.abort(),25000);try{const r=await fetch(wrap(u),{signal:c.signal,headers:{'user-agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36','accept':'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9'}});if(!r.ok)throw new Error(u+' -> HTTP '+r.status);return await r.text()}finally{clearTimeout(t)}}
const nm=s=>{const n=parseFloat(String(s).replace(/[^\d.-]/g,''));return isNaN(n)?null:n};
function parsePlayer(html){const $=cheerio.load(html),o={pg:{},tot:{},adv:{},games:[]};
  $('table').each((_,t)=>{const h=$(t).find('th').map((_,x)=>$(x).text().trim()).get(),rows=$(t).find('tr').map((_,tr)=>[$(tr).find('td').map((_,c)=>$(c).text().trim().replace(/\s+/g,' ')).get()]).get();
    if(h.includes('League')&&h.includes('GP')){const r=rows.find(r=>/^2026-27/.test(r[0])&&/Primera FEB/.test(r[h.indexOf('League')]));if(!r)return;const k=h.includes('FGM')?'tot':h.includes('TS%')?'adv':'pg';h.forEach((x,i)=>{if(i>3)o[k][x]=nm(r[i])})}
    else if(h[0]=='Date'&&h.includes('PTS')){rows.forEach(r=>{const m=(r[0]||'').match(/^(\d+)\/(\d+)\/(\d{4})$/);if(m&&+m[3]==2026&&+m[1]>=9&&+m[2]>=1){const d=`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;if(d>='2026-09-20')o.games.push({date:d,opp:r[1],pts:nm(r[2]),reb:nm(r[3]),ast:nm(r[4]),stl:nm(r[5]),blk:nm(r[6])})}})}});
  return o}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function sync(){const errors=[];
  try{const $=cheerio.load(await get(ROSTER));$('a[href*="/player/"]').each((_,a)=>{const k=KEYS.find(k=>norm($(a).text()).includes(k)),h=$(a).attr('href');if(k&&/Summary\/\d+/.test(h||''))st.ids[k]=h.startsWith('http')?h:'https://basketball.realgm.com'+h})}catch(e){errors.push('roster: '+e.message)}
  let ok=0;for(const[k,u]of Object.entries(st.ids)){try{const p=parsePlayer(await get(u)),old=st.players[k]||{games:[]},by=Object.fromEntries([...old.games,...p.games].map(g=>[g.date,g]));if(Object.keys(p.pg).length){st.players[k]={...p,games:Object.values(by).sort((a,b)=>a.date<b.date?-1:1)};ok++}}catch(e){errors.push(k+': '+e.message)}await sleep(900)}
  st.ok=ok>0;st.errors=errors.slice(0,8);st.lastSync=new Date().toISOString();try{fs.writeFileSync(FILE,JSON.stringify(st))}catch(e){}return st}
module.exports={sync,state:()=>st,parsePlayer};
