'use strict';
const $=s=>document.querySelector(s);
const CATS=[['3','교육'],['1','금융'],['2','인력'],['4','창업'],['5','특허'],['6','판로'],['7','기타'],['8','기술'],['9','컨설팅'],['10','네트워킹']];
const CAT=Object.fromEntries(CATS);
// 상생누리 검색 화면과 같은 구분. '평가'는 사이트 검색 메뉴에는 없지만 목록 데이터에 있어 함께 둔다.
const TARGETS=['협력사 지원','계열사 오픈','부분 오픈','전체 오픈'];
const STATUSES=['신청예정','신청중','신청완료'];
const PROGRESSES=['예정','모집중','진행중','평가','종료'];
const TITLES={open:'진행 중인 공고',new:'새로 발견한 공고',favorite:'즐겨찾기한 공고',all:'전체 공고'};
const DEFAULT_SORT={open:'deadline',new:'found',favorite:'deadline',all:'registered'};
const PAGE=30,DAY=86400000,STALE_HOURS=30,STRIP_DAYS=14,URGENT=3;
const WD=['일','월','화','수','목','금','토'];

let meta=null,open=[],archive=null,archiveLoading=null,view='open',category='',dueDate='',shown=PAGE,loadedAt=0;

// ── 기기별 저장 (읽음·즐겨찾기). 저장소가 막혀 있어도 화면은 동작한다.
const KEY='sangsaeng-moa:v1';
let store={read:{},fav:{}};
try{const s=JSON.parse(localStorage.getItem(KEY)||'null');if(s&&typeof s==='object')store={read:s.read||{},fav:s.fav||{}};}catch{}
function save(){try{localStorage.setItem(KEY,JSON.stringify(store));}catch{toast('이 브라우저에서는 저장할 수 없어 새로고침하면 사라집니다.');}}

// ── 유틸
const fmt=n=>Number(n).toLocaleString('ko-KR');
const kstToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const isDate=v=>/^\d{4}-\d\d-\d\d$/.test(v||'');
const dayNum=v=>Date.parse(v+'T00:00:00Z')/DAY;
function dday(v){return isDate(v)?dayNum(v)-dayNum(kstToday()):null;}
function addDays(v,n){return new Date(Date.parse(v+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);}
function short(v){if(!isDate(v))return'미표기';const [y,m,d]=v.split('-');return y===kstToday().slice(0,4)?`${+m}.${+d}`:`${y.slice(2)}.${+m}.${+d}`;}
const range=(a,b)=>!a&&!b?'미표기':`${short(a)} – ${short(b)}`;
function when(v){return v?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'아직 없음';}
function ago(v){if(!v)return'';const m=Math.round((Date.now()-new Date(v))/60000);if(m<60)return`${Math.max(m,1)}분 전`;const h=Math.round(m/60);return h<48?`${h}시간 전`:`${Math.round(h/24)}일 전`;}
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function svg(path,vb='0 0 24 24'){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox',vb);s.setAttribute('aria-hidden','true');for(const d of path){const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',d);s.append(p);}return s;}
const STAR=['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z'];
const CHECK=['M4.5 12.5l4.5 4.5L19.5 6.5'];
function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,3200);}
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
  }catch{
    const s=$('#sync');s.className='sync error';s.textContent='불러오기 실패';
    if(!open.length)$('#cards').replaceChildren(empty('공고 목록을 불러오지 못했습니다','인터넷 연결을 확인한 뒤 새로고침하세요.'));
  }
}
function ensureArchive(){
  if(archive)return Promise.resolve();
  if(!archiveLoading){
    const years=Object.keys(meta.archive||{});
    archiveLoading=Promise.all(years.map(y=>getJSON(`archive-${y}.json`,meta.lastAttempt||'0'))).then(parts=>{
      archive=parts.flat();
      for(const r of archive)if(store.fav[r.i])store.fav[r.i]=r;
      save();
    }).catch(e=>{archiveLoading=null;toast('지난 공고를 불러오지 못했습니다. 다시 눌러 주세요.');throw e;});
  }
  return archiveLoading;
}

// ── 필터
function setup(){
  const box=$('#categories');
  for(const [code,label] of [['','전체 분야'],...CATS]){
    const b=el('button',code?'':'selected',label);b.dataset.c=code;b.setAttribute('aria-pressed',String(!code));box.append(b);
  }
  for(const [id,label,values] of [['target','전체',TARGETS],['status','전체',STATUSES],['progress','전체',PROGRESSES]]){
    const s=$('#'+id);s.append(new Option(label,''));for(const v of values)s.append(new Option(v,v));
  }
}
function sourceRows(){
  if(view==='open')return open;
  if(view==='new')return open.filter(isRecent);
  if(view==='favorite')return [...new Map(Object.values(store.fav).filter(Boolean).map(r=>[r.i,r])).values()];
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
  if(dueDate&&r.ae!==dueDate)return false;
  if(f.title&&!(r.t||'').toLowerCase().includes(f.title))return false;
  if(f.org&&!(r.o||'').toLowerCase().includes(f.org))return false;
  if(f.from&&!(r.se&&r.se>=f.from))return false;
  if(f.to&&!(r.ss&&r.ss<=f.to))return false;
  if(skip!=='g'&&f.g&&r.g!==f.g)return false;
  if(skip!=='s'&&f.s&&r.s!==f.s)return false;
  if(skip!=='p'&&f.p&&r.p!==f.p)return false;
  return true;
}

// ── 화면
function renderSync(){
  const run=meta.runs?.[0],s=$('#sync');
  const hours=meta.lastSuccess?(Date.now()-new Date(meta.lastSuccess))/3600000:Infinity;
  let cls='sync',text=`${when(meta.lastSuccess)} 수집`,title=`마지막 수집 ${when(meta.lastSuccess)} (${ago(meta.lastSuccess)})`;
  if(run?.status==='error'){cls+=' error';text='최근 수집 실패';title=`${when(run.started)} 수집 실패: ${run.message}. 마지막 성공 ${ago(meta.lastSuccess)}`;}
  else if(hours>STALE_HOURS){cls+=' warn';text=`${ago(meta.lastSuccess)} 수집 · 수집기 확인 필요`;title='하루 넘게 새 수집이 없습니다. 회사 PC의 수집기가 켜져 있는지 확인하세요.';}
  s.className=cls;s.textContent=text;s.title=title;
  $('#baselineInfo').textContent=`${title}. 첫 기준 수집은 ${when(meta.baselineAt)}이고, 이때 있던 공고에는 NEW를 붙이지 않습니다. 상생누리 공개 목록 ${fmt(meta.sourceTotal)}건.`;
  $('#runs').replaceChildren(...(meta.runs||[]).map(r=>el('li','',`${when(r.started)} ${r.status==='success'?'성공':r.status==='error'?'실패':'진행 중'}: ${r.message}`)));
}
// 이번 주 월요일부터 2주 달력. 지난 날은 흐리게, 마감 건수가 많을수록 형광펜을 진하게.
function renderStrip(applying){
  const today=kstToday(),counts={};
  for(const r of applying)if(isDate(r.ae))counts[r.ae]=(counts[r.ae]||0)+1;
  const wdToday=new Date(today+'T00:00:00Z').getUTCDay();
  const monday=addDays(today,-((wdToday+6)%7));
  const days=Array.from({length:STRIP_DAYS},(_,i)=>addDays(monday,i));
  const future=days.filter(d=>d>=today);
  const max=Math.max(1,...future.map(d=>counts[d]||0));
  const [,m,d]=today.split('-');
  $('#today').textContent=`${+m}월 ${+d}일 ${WD[wdToday]}요일`;
  $('#dueTotal').textContent=fmt(future.reduce((a,x)=>a+(counts[x]||0),0));
  $('#strip').replaceChildren(...days.map(day=>{
    const past=day<today,n=past?0:(counts[day]||0),dd=dayNum(day)-dayNum(today);
    const b=el('button','day'+(past?' past':'')+(n?'':' zero')+(day===today?' today':'')+(!past&&dd<=URGENT&&n?' urgent':''));
    b.dataset.date=day;b.setAttribute('aria-pressed',String(dueDate===day));
    if(past){b.disabled=true;b.setAttribute('aria-label',`${+day.slice(5,7)}월 ${+day.slice(8)}일 (지난 날)`);}
    else b.setAttribute('aria-label',`${+day.slice(5,7)}월 ${+day.slice(8)}일 마감 ${n}건`);
    if(n)b.style.setProperty('--h',String(Math.max(.15,n/max)));
    b.append(el('span','date',String(+day.slice(8))),el('span','cnt',n?`${n}건`:'0'));
    return b;
  }));
}
// 묶음 머리: 마감일별/등록일별/발견일별
function groupKey(r,sort,today){
  if(sort==='deadline'){
    if(r.s==='신청중'&&isDate(r.ae)&&r.ae>=today)return r.ae;
    if(r.s==='신청예정')return '~upcoming';
    return '~closed';
  }
  if(sort==='found')return r.f?kstDateOf(r.f):'~base';
  return isDate(r.d)?r.d:'~none';
}
function kstDateOf(iso){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));}
function groupHead(key,sort,count,today){
  const h=el('div','ghead'),t=el('h2');let wd='',dd='';
  if(key.startsWith('~')){
    t.textContent={'~upcoming':'신청 시작 전','~closed':'마감되었거나 기간 미표기','~base':'기준 수집 때 있던 공고','~none':'등록일 미표기'}[key];
  }else{
    const diff=dayNum(key)-dayNum(today),w=WD[new Date(key+'T00:00:00Z').getUTCDay()];
    const label=diff===0?'오늘':diff===1&&sort==='deadline'?'내일':diff===-1?'어제':`${+key.slice(5,7)}월 ${+key.slice(8)}일`;
    const yr=key.slice(0,4)!==today.slice(0,4)?`${key.slice(0,4)}년 `:'';
    if(sort==='deadline'&&diff<=URGENT){const m=el('mark','hl-due',label);t.append(m);h.classList.add('urgent');}else t.textContent=yr+label;
    wd=(diff===0||diff===1||diff===-1)?`${+key.slice(5,7)}월 ${+key.slice(8)}일 ${w}요일`:`${w}요일`;
    dd=sort==='deadline'?(diff===0?'오늘 마감':`D-${diff}`):sort==='found'?'발견':'등록';
  }
  h.append(t);if(wd)h.append(el('span','wd',wd));
  h.append(el('span','dd',dd),el('span','gc',`${fmt(count)}건`));
  return h;
}
function render(){
  if(!meta)return;
  const applying=open.filter(r=>r.s==='신청중');
  const newCount=open.filter(isNew).length,favCount=Object.keys(store.fav).length;
  const total=meta.open+Object.values(meta.archive||{}).reduce((a,b)=>a+b,0);
  for(const [id,v] of Object.entries({openCount:open.length,newCount,favoriteCount:favCount,allCount:total}))$('#'+id).textContent=v?fmt(v):'';
  renderSync();renderStrip(applying);

  // 목록 — 선택지마다 '그 필터를 뺀 나머지 조건' 기준 건수를 표시
  const base=sourceRows(),sort=$('#sort').value,f=readFilters();
  for(const [id,key] of [['target','g'],['status','s'],['progress','p']]){
    const counts={};for(const r of base)if(match(r,f,key))counts[r[key]]=(counts[r[key]]||0)+1;
    for(const o of $('#'+id).options)if(o.value)o.textContent=`${o.value} (${fmt(counts[o.value]||0)})`;
  }
  const active=[f.org,f.from||f.to,f.g,f.s,f.p].filter(Boolean).length;
  $('#filterCount').textContent=active?` ${active}`:'';$('#filterToggle').classList.toggle('on',active>0);

  let rows=base.filter(r=>match(r,f));
  const dl=r=>{const d=dday(r.ae);return d!==null&&d>=0&&r.s!=='신청완료'?d:1e9;};
  const byReg=(a,b)=>(b.d||'').localeCompare(a.d||'')||b.i.localeCompare(a.i);
  if(sort==='deadline'){const rank=r=>r.s==='신청중'&&dl(r)<1e9?dl(r):r.s==='신청예정'?1e8:1e9;const m=new Map(rows.map(r=>[r.i,rank(r)]));rows.sort((a,b)=>m.get(a.i)-m.get(b.i)||(m.get(a.i)===1e8?(a.as||'').localeCompare(b.as||''):0)||byReg(a,b));}
  else if(sort==='found')rows.sort((a,b)=>(b.f||'').localeCompare(a.f||'')||byReg(a,b));
  else rows.sort(byReg);

  $('#viewTitle').textContent=TITLES[view];
  $('#markAll').hidden=!(view==='new'&&newCount>0);
  const chip=$('#dateChip');chip.hidden=!dueDate;
  if(dueDate)chip.textContent=`${+dueDate.slice(5,7)}월 ${+dueDate.slice(8)}일 마감만 ✕`;
  const loadingArchive=view==='all'&&!archive;
  $('#resultCount').textContent=loadingArchive?'지난 공고까지 불러오는 중':`${fmt(rows.length)}건`;
  const list=$('#cards');
  if(!rows.length&&!loadingArchive){
    list.replaceChildren(view==='new'?empty(`최근 ${meta.newDays}일 동안 새로 발견한 공고가 없습니다`,'수집기가 새 공고를 찾으면 여기에 먼저 보입니다.')
      :view==='favorite'&&!favCount?empty('즐겨찾기한 공고가 없습니다','공고 오른쪽 별을 누르면 이 기기에 저장됩니다.')
      :empty('조건에 맞는 공고가 없습니다','필터를 줄이거나 다른 검색어를 넣어 보세요.'));
  }else{
    const today=kstToday(),counts=new Map();
    for(const r of rows){const k=groupKey(r,sort,today);counts.set(k,(counts.get(k)||0)+1);}
    const out=[];let cur=null,box=null;
    for(const r of rows.slice(0,shown)){
      const k=groupKey(r,sort,today);
      if(k!==cur){cur=k;const g=el('section','group');box=el('div','items');g.append(groupHead(k,sort,counts.get(k),today),box);out.push(g);}
      box.append(card(r,sort));
    }
    list.replaceChildren(...out);
  }
  const more=$('#more');more.hidden=rows.length<=shown;more.textContent=`${fmt(Math.min(PAGE,rows.length-shown))}건 더 보기 (남은 ${fmt(rows.length-shown)}건)`;
}
function empty(title,body){const e=el('div','empty');e.append(el('b','',title),el('span','',body));return e;}
function badge(r,sort){
  const d=dday(r.ae);
  if(r.s==='신청중'&&d!==null&&d>=0)return sort==='deadline'?'':(d===0?'오늘 마감':`D-${d}`);
  if(r.s==='신청예정')return sort==='deadline'?`${short(r.as)} 신청 시작`:'신청 전';
  return sort==='deadline'?'':(r.s==='신청완료'?'마감':'');
}
function fact(k,v){const d=el('div');d.append(el('dt','',k),el('dd','',v));return d;}
function card(r,sort){
  const read=isRead(r),fav=!!store.fav[r.i],fresh=isNew(r);
  const item=el('article','item'+(read?' read':''));
  const main=el('div','item-main'),meta=el('p','meta');
  meta.append(el('span','cat',CAT[r.c]||'기타'));
  const b=badge(r,sort);if(b)meta.append(el('span','badge',b));
  if(fresh)meta.append(el('span','newtag','NEW'));
  if(r.o)meta.append(el('span','org',r.o));
  const a=el('a','title');a.href=url(r);a.target='_blank';a.rel='noopener noreferrer';
  a.append(el(fresh?'mark':'span',fresh?'hl-new':'',r.t));
  a.addEventListener('click',()=>{if(!store.read[r.i]){store.read[r.i]=1;save();setTimeout(render,300);}});
  const facts=el('dl','facts');
  facts.append(fact('신청',range(r.as,r.ae)),fact('지원',range(r.ss,r.se)),fact('지역',r.r||'미표기'),fact('대상',r.g||'미표기'),fact('진행',r.p||'미표기'));
  if(r.f&&sort!=='found')facts.append(fact('발견',when(r.f)));
  main.append(meta,a,facts);
  const act=el('div','acts');
  const star=el('button','icon'+(fav?' on':''));star.append(svg(STAR));
  star.setAttribute('aria-label',fav?'즐겨찾기에서 빼기':'즐겨찾기에 넣기');star.setAttribute('aria-pressed',String(fav));star.title=star.getAttribute('aria-label');
  star.onclick=()=>{if(store.fav[r.i]){delete store.fav[r.i];toast('즐겨찾기에서 뺐습니다.');}else{store.fav[r.i]=r;toast('즐겨찾기에 넣었습니다.');}save();render();};
  const rb=el('button','icon'+(read?' read-on':''));rb.append(svg(CHECK));
  rb.setAttribute('aria-label',read?'읽지 않음으로 바꾸기':'읽음으로 표시');rb.setAttribute('aria-pressed',String(read));rb.title=rb.getAttribute('aria-label');
  rb.onclick=()=>{if(store.read[r.i])delete store.read[r.i];else store.read[r.i]=1;save();render();};
  act.append(star,rb);
  item.append(main,act);return item;
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
$('#strip').onclick=e=>{const b=e.target.closest('.day');if(!b)return;dueDate=dueDate===b.dataset.date?'':b.dataset.date;shown=PAGE;if(dueDate&&view!=='open')selectView('open');else render();};
$('#dateChip').onclick=()=>{dueDate='';shown=PAGE;render();};
let typing;
for(const id of ['qTitle','qOrg'])$('#'+id).addEventListener('input',()=>{clearTimeout(typing);typing=setTimeout(()=>{shown=PAGE;render();},200);});
for(const id of ['from','to','target','status','progress','sort'])$('#'+id).addEventListener('change',()=>{shown=PAGE;render();});
$('#filterToggle').onclick=()=>{const o=$('#filters').classList.toggle('open');$('#filterToggle').setAttribute('aria-expanded',String(o));};
$('#resetFilters').onclick=()=>{for(const id of ['qTitle','qOrg','from','to','target','status','progress'])$('#'+id).value='';dueDate='';shown=PAGE;render();};
$('#more').onclick=()=>{shown+=PAGE;render();};
$('#markAll').onclick=()=>{for(const r of open.filter(isNew))store.read[r.i]=1;save();render();toast('새로 발견한 공고를 모두 읽음으로 표시했습니다.');};
// 폰에서 다시 열었을 때 5분이 지났으면 새 데이터 확인
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-loadedAt>5*60000)load();});

setup();load();
