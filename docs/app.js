'use strict';
const $=s=>document.querySelector(s);
const CATS=[['3','교육'],['1','금융'],['2','인력'],['4','창업'],['5','특허'],['6','판로'],['7','기타'],['8','기술'],['9','컨설팅'],['10','네트워킹']];
const CAT=Object.fromEntries(CATS);
// 상생누리 검색 화면과 같은 구분. '평가'는 사이트 검색 메뉴에는 없지만 목록 데이터에 있어 함께 둔다.
const TARGETS=['협력사 지원','계열사 오픈','부분 오픈','전체 오픈'];
const STATUSES=['신청예정','신청중','신청완료'];
const PROGRESSES=['예정','모집중','진행중','평가','종료'];
const TITLES={open:'진행 중 공고',new:'새로 발견한 공고',favorite:'즐겨찾기',all:'전체 검색'};
const DEFAULT_SORT={open:'deadline',new:'found',favorite:'deadline',all:'registered'};
const PAGE=20,DAY=86400000,STALE_HOURS=30;

let meta=null,open=[],archive=null,archiveLoading=null,view='open',category='',shown=PAGE,loadedAt=0;

// ── 기기별 저장 (읽음·즐겨찾기). 저장소가 막혀 있어도 화면은 동작한다.
const KEY='sangsaeng-moa:v1';
let store={read:{},fav:{}};
try{const s=JSON.parse(localStorage.getItem(KEY)||'null');if(s&&typeof s==='object')store={read:s.read||{},fav:s.fav||{}};}catch{}
function save(){try{localStorage.setItem(KEY,JSON.stringify(store));}catch{toast('이 브라우저에서는 저장할 수 없어 새로고침하면 사라집니다.');}}

// ── 유틸
const fmt=n=>Number(n).toLocaleString('ko-KR');
const kstToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function dday(v){if(!/^\d{4}-\d\d-\d\d$/.test(v||''))return null;return Math.round((new Date(v+'T00:00:00+09:00')-new Date(kstToday()+'T00:00:00+09:00'))/DAY);}
function when(v){return v?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}):'아직 없음';}
function ago(v){if(!v)return'';const m=Math.round((Date.now()-new Date(v))/60000);if(m<60)return`${Math.max(m,1)}분 전`;const h=Math.round(m/60);return h<48?`${h}시간 전`:`${Math.round(h/24)}일 전`;}
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,3500);}
const url=r=>{const [p,b]=r.i.split(':');return`https://www.winwinnuri.or.kr/pg/businessView.do?pageNumber=1&prgIdH=${encodeURIComponent(p)}&bizIdH=${encodeURIComponent(b)}&returnUrl=%2Fpg%2FselectPgSearchList.do`;};
const isRecent=r=>!!r.f&&Date.now()-new Date(r.f)<(meta?.newDays||14)*DAY;
const isNew=r=>isRecent(r)&&!store.read[r.i];
const isRead=r=>!!store.read[r.i];

async function getJSON(name,v){
  const res=await fetch(`data/${name}?v=${encodeURIComponent(v)}`,{cache:'no-cache'});
  if(!res.ok)throw Error(`${name} ${res.status}`);
  return res.json();
}

// ── 불러오기
async function load(){
  try{
    const m=await getJSON('meta.json',Date.now());
    const changed=!meta||m.lastAttempt!==meta.lastAttempt||m.lastSuccess!==meta.lastSuccess;
    meta=m;loadedAt=Date.now();
    if(changed){open=await getJSON('open.json',m.lastAttempt||'0');archive=null;archiveLoading=null;}
    for(const r of open)if(store.fav[r.i])store.fav[r.i]=r;
    save();
    if(view==='all')await ensureArchive();
    render();
  }catch(e){
    const s=$('#sync');s.className='sync error';
    s.textContent='데이터를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.';
    if(!open.length)$('#cards').replaceChildren(el('div','empty','공고 데이터를 불러오지 못했습니다.'));
  }
}
function ensureArchive(){
  if(archive)return Promise.resolve();
  if(!archiveLoading){
    const years=Object.keys(meta.archive||{});
    $('#resultCount').textContent='지난 공고를 불러오는 중…';
    archiveLoading=Promise.all(years.map(y=>getJSON(`archive-${y}.json`,meta.lastAttempt||'0'))).then(parts=>{
      archive=parts.flat();
      for(const r of archive)if(store.fav[r.i])store.fav[r.i]=r;
      save();
    }).catch(e=>{archiveLoading=null;toast('지난 공고를 불러오지 못했습니다.');throw e;});
  }
  return archiveLoading;
}

// ── 화면
function setupCategories(){
  const box=$('#categories');
  for(const [code,label] of [['','전체'],...CATS]){
    const b=el('button',code?'':'selected',label);b.dataset.c=code;b.setAttribute('aria-pressed',String(!code));box.append(b);
  }
}
function sourceRows(){
  if(view==='open')return open;
  if(view==='new')return open.filter(isRecent);
  if(view==='favorite'){
    const map=new Map(Object.values(store.fav).filter(Boolean).map(r=>[r.i,r]));
    return [...map.values()];
  }
  return archive?open.concat(archive):open;
}
function readFilters(){
  const v=id=>$('#'+id).value.trim();
  let from=v('from'),to=v('to');if(from&&to&&from>to)[from,to]=[to,from];
  return {title:v('qTitle').toLowerCase(),org:v('qOrg').toLowerCase(),from,to,g:v('target'),s:v('status'),p:v('progress')};
}
// skip: 건수 계산 때 제외할 필터 키(g/s/p)
function match(r,f,skip){
  if(category&&r.c!==category)return false;
  if(f.title&&!(r.t||'').toLowerCase().includes(f.title))return false;
  if(f.org&&!(r.o||'').toLowerCase().includes(f.org))return false;
  if(f.from&&!(r.se&&r.se>=f.from))return false;
  if(f.to&&!(r.ss&&r.ss<=f.to))return false;
  if(skip!=='g'&&f.g&&r.g!==f.g)return false;
  if(skip!=='s'&&f.s&&r.s!==f.s)return false;
  if(skip!=='p'&&f.p&&r.p!==f.p)return false;
  return true;
}
function setupSelects(){
  for(const [id,label,values] of [['target','전체 지원대상',TARGETS],['status','전체 신청단계',STATUSES],['progress','전체 진행단계',PROGRESSES]]){
    const s=$('#'+id);s.append(new Option(label,''));for(const v of values)s.append(new Option(v,v));
  }
}
function render(){
  if(!meta)return;
  const applying=open.filter(r=>r.s==='신청중');
  const newCount=open.filter(isNew).length,favCount=Object.keys(store.fav).length;
  const due=applying.filter(r=>{const d=dday(r.ae);return d!==null&&d>=0&&d<=7;}).length;
  const total=meta.open+Object.values(meta.archive||{}).reduce((a,b)=>a+b,0);
  for(const [id,v] of Object.entries({openStat:applying.length,openCount:open.length,newStat:newCount,newCount,dueStat:due,favoriteStat:favCount,favoriteCount:favCount,allCount:total}))$('#'+id).textContent=fmt(v);

  // 수집 상태
  const run=meta.runs?.[0],s=$('#sync');
  const hours=meta.lastSuccess?(Date.now()-new Date(meta.lastSuccess))/3600000:Infinity;
  let cls='sync',text=`마지막 수집 ${when(meta.lastSuccess)} · ${ago(meta.lastSuccess)}`;
  if(run?.status==='error'){cls+=' error';text=`최근 수집 실패 (${when(run.started)}) · ${run.message} · 마지막 성공 ${ago(meta.lastSuccess)}`;}
  else if(hours>STALE_HOURS){cls+=' warn';text+=' · 수집이 하루 넘게 멈춰 있어요. 회사 PC의 수집기가 켜져 있는지 확인하세요.';}
  else if(meta.lastAdded)text+=` · 지난 수집에서 신규 ${fmt(meta.lastAdded)}건`;
  s.className=cls;s.textContent=text;
  $('#baselineInfo').textContent=`첫 기준 수집: ${when(meta.baselineAt)}. 기준 수집에 포함된 공고는 NEW로 표시하지 않습니다. 원본 공개 목록 ${fmt(meta.sourceTotal)}건.`;
  $('#runs').replaceChildren(...(meta.runs||[]).map(r=>el('li','',`${when(r.started)} · ${r.status==='success'?'성공':r.status==='error'?'실패':'진행 중'} · ${r.message}`)));

  // 목록 — 필터마다 '그 필터를 뺀 나머지 조건' 기준 건수를 옵션에 표시
  const base=sourceRows(),sort=$('#sort').value,f=readFilters();
  for(const [id,key] of [['target','g'],['status','s'],['progress','p']]){
    const counts={};for(const r of base)if(match(r,f,key))counts[r[key]]=(counts[r[key]]||0)+1;
    for(const o of $('#'+id).options)if(o.value)o.textContent=`${o.value} (${fmt(counts[o.value]||0)})`;
  }
  const active=[f.org,f.from||f.to,f.g,f.s,f.p].filter(Boolean).length;
  $('#filterCount').textContent=active?` ${active}`:'';$('#filterToggle').classList.toggle('on',active>0);
  let rows=base.filter(r=>match(r,f));
  const dl=r=>{const d=dday(r.ae);return d!==null&&d>=0?d:1e9;};
  const byReg=(a,b)=>(b.d||'').localeCompare(a.d||'')||b.i.localeCompare(a.i);
  if(sort==='deadline'){const m=new Map(rows.map(r=>[r.i,dl(r)]));rows.sort((a,b)=>m.get(a.i)-m.get(b.i)||byReg(a,b));}
  else if(sort==='found')rows.sort((a,b)=>(b.f||'').localeCompare(a.f||'')||byReg(a,b));
  else rows.sort(byReg);

  $('#viewTitle').textContent=TITLES[view];
  $('#markAll').hidden=!(view==='new'&&newCount>0);
  const loadingArchive=view==='all'&&!archive;
  $('#resultCount').textContent=loadingArchive?'지난 공고를 불러오는 중…':`${category?CAT[category]:'전체 분야'} · ${fmt(rows.length)}건`;
  $('#cards').replaceChildren(...rows.slice(0,shown).map(card));
  if(!rows.length&&!loadingArchive){
    const msg=view==='new'?`최근 ${meta.newDays}일 동안 새로 발견한 공고가 없습니다.`:view==='favorite'?'☆를 눌러 관심 공고를 저장해 보세요.':'조건에 맞는 공고가 없습니다. 검색어나 필터를 바꿔 보세요.';
    $('#cards').append(el('div','empty',msg));
  }
  const more=$('#more');more.hidden=rows.length<=shown;more.textContent=`더 보기 (${fmt(Math.min(PAGE,rows.length-shown))}건 / 남은 ${fmt(rows.length-shown)}건)`;
}
function card(r){
  const read=isRead(r),fav=!!store.fav[r.i];
  const c=el('article','card'+(read?' read':'')),body=el('div','card-body'),top=el('div','meta-line');
  top.append(el('span','pill',CAT[r.c]||'기타'));if(r.o)top.append(el('span','org',r.o));if(isNew(r))top.append(el('span','new','NEW'));
  const a=el('a','title',r.t);a.href=url(r);a.target='_blank';a.rel='noopener noreferrer';
  a.addEventListener('click',()=>{if(!store.read[r.i]){store.read[r.i]=1;save();setTimeout(render,300);}});
  const det=el('div','details');
  det.append(el('span','',`신청 ${r.as||'미표기'} ~ ${r.ae||'미표기'}`),el('span','',`지원 ${r.ss||'미표기'} ~ ${r.se||'미표기'}`),el('span','',[r.r||'지역 미표기',r.g,r.p&&`진행 ${r.p}`].filter(Boolean).join(' · ')));
  if(r.f)det.append(el('span','',`발견 ${when(r.f)}`));
  body.append(top,a,det);
  const act=el('div','card-actions');
  const star=el('button','bookmark'+(fav?' on':''),fav?'★':'☆');star.setAttribute('aria-label',fav?'즐겨찾기 해제':'즐겨찾기 추가');star.setAttribute('aria-pressed',String(fav));
  star.onclick=()=>{if(store.fav[r.i])delete store.fav[r.i];else store.fav[r.i]=r;save();render();};
  const d=dday(r.ae);
  const label=r.s==='신청중'&&d!==null&&d>=0?(d===0?'오늘 마감':`D-${d}`):r.s==='신청예정'?'신청예정':(r.s||'기간 확인');
  const dl=el('span','deadline'+(r.s==='신청중'&&d!==null&&d>=0&&d<=7?' urgent':r.s==='신청중'||r.s==='신청예정'?'':' done'),label);
  const rb=el('button','read-toggle',read?'읽음 ✓':'읽음으로');rb.setAttribute('aria-label',read?'읽지 않음으로 변경':'읽음으로 변경');
  rb.onclick=()=>{if(store.read[r.i])delete store.read[r.i];else store.read[r.i]=1;save();render();};
  act.append(star,dl,rb);c.append(body,act);return c;
}

// ── 이벤트
function selectView(v){
  view=v;shown=PAGE;$('#sort').value=DEFAULT_SORT[v];
  for(const b of $('#views').children){b.classList.toggle('selected',b.dataset.view===v);b.setAttribute('aria-current',b.dataset.view===v?'page':'false');}
  render();
  if(v==='all')ensureArchive().then(render,()=>render());
}
$('#views').onclick=e=>{const b=e.target.closest('button');if(b)selectView(b.dataset.view);};
$('#categories').onclick=e=>{const b=e.target.closest('button');if(!b)return;category=b.dataset.c;shown=PAGE;for(const x of $('#categories').children){x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));}render();};
let typing;
for(const id of ['qTitle','qOrg'])$('#'+id).addEventListener('input',()=>{clearTimeout(typing);typing=setTimeout(()=>{shown=PAGE;render();},200);});
for(const id of ['from','to','target','status','progress','sort'])$('#'+id).addEventListener('change',()=>{shown=PAGE;render();});
$('#filterToggle').onclick=()=>{const open=$('#filters').classList.toggle('open');$('#filterToggle').setAttribute('aria-expanded',String(open));};
$('#resetFilters').onclick=()=>{for(const id of ['qTitle','qOrg','from','to','target','status','progress'])$('#'+id).value='';shown=PAGE;render();};
$('#more').onclick=()=>{shown+=PAGE;render();};
$('#markAll').onclick=()=>{for(const r of open.filter(isNew))store.read[r.i]=1;save();render();toast('새로 발견한 공고를 모두 읽음으로 표시했습니다.');};
// 폰에서 다시 열었을 때 5분이 지났으면 새 데이터 확인
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-loadedAt>5*60000)load();});

setupCategories();setupSelects();load();
