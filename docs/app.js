'use strict';
const $=s=>document.querySelector(s);
const CATS=[['3','교육'],['1','금융'],['2','인력'],['4','창업'],['5','특허'],['6','판로'],['7','기타'],['8','기술'],['9','컨설팅'],['10','네트워킹']];
const CAT=Object.fromEntries(CATS);
// 상생누리 검색 화면과 같은 구분. '평가'는 사이트 검색 메뉴에는 없지만 목록 데이터에 있어 함께 둔다.
const TARGETS=['협력사 지원','계열사 오픈','부분 오픈','전체 오픈'];
const STATUSES=['신청예정','신청중','신청완료'];
const PROGRESSES=['예정','모집중','진행중','평가','종료'];
const REGIONS=['전국','서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주'];
const TRACK={review:'검토 중',applied:'지원함',skip:'제외'};
const TITLES={open:'진행 중인 공고',interest:'관심 공고',new:'새로 발견한 공고',mine:'내 공고',all:'전체 공고'};
const DEFAULT_SORT={open:'deadline',interest:'deadline',new:'found',mine:'track',all:'registered'};
const PAGE=30,DAY=86400000,STALE_HOURS=30,STRIP_DAYS=14,URGENT=3;
const WD=['일','월','화','수','목','금','토'];

let meta=null,open=[],archive=null,archiveLoading=null,view='open',category='',dueDate='',shown=PAGE,loadedAt=0;
let defaults={keywords:[],orgs:[]},editing=null;

// ── 기기별 저장 (읽음·즐겨찾기·검토 상태·관심 설정). 저장소가 막혀 있어도 화면은 동작한다.
const KEY='sangsaeng-moa:v1';
let store={read:{},fav:{},track:{},interest:null};
try{const s=JSON.parse(localStorage.getItem(KEY)||'null');if(s&&typeof s==='object')store={read:s.read||{},fav:s.fav||{},track:s.track||{},interest:s.interest||null};}catch{}
function save(){try{localStorage.setItem(KEY,JSON.stringify(store));}catch{toast('이 브라우저에서는 저장할 수 없어 새로고침하면 사라집니다.');}}
const interest=()=>store.interest||defaults;

// ── 유틸
const fmt=n=>Number(n).toLocaleString('ko-KR');
const kstToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const kstDateOf=iso=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
const isDate=v=>/^\d{4}-\d\d-\d\d$/.test(v||'');
const dayNum=v=>Date.parse(v+'T00:00:00Z')/DAY;
function dday(v){return isDate(v)?dayNum(v)-dayNum(kstToday()):null;}
function addDays(v,n){return new Date(Date.parse(v+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);}
function short(v){if(!isDate(v))return'미표기';const [y,m,d]=v.split('-');return y===kstToday().slice(0,4)?`${+m}.${+d}`:`${y.slice(2)}.${+m}.${+d}`;}
const range=(a,b)=>!a&&!b?'미표기':`${short(a)} – ${short(b)}`;
function when(v){return v?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'아직 없음';}
function ago(v){if(!v)return'';const m=Math.round((Date.now()-new Date(v))/60000);if(m<60)return`${Math.max(m,1)}분 전`;const h=Math.round(m/60);return h<48?`${h}시간 전`:`${Math.round(h/24)}일 전`;}
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function svg(path){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');for(const d of path){const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',d);s.append(p);}return s;}
const STAR=['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z'];
const CHECK=['M4.5 12.5l4.5 4.5L19.5 6.5'];
const NOTE=['M5 4.5h14v15H5z','M8.5 9h7','M8.5 12.5h7','M8.5 16h4'];
function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,3200);}
const url=r=>{const [p,b]=r.i.split(':');return`https://www.winwinnuri.or.kr/pg/businessView.do?pageNumber=1&prgIdH=${encodeURIComponent(p)}&bizIdH=${encodeURIComponent(b)}&returnUrl=%2Fpg%2FselectPgSearchList.do`;};
const isRecent=r=>!!r.f&&Date.now()-new Date(r.f)<(meta?.newDays||14)*DAY;
const isNew=r=>isRecent(r)&&!store.read[r.i];
const isRead=r=>!!store.read[r.i];
const trackOf=r=>store.track[r.i]?.s||'';
const isSkipped=r=>trackOf(r)==='skip';
const splitList=v=>[...new Set(String(v).split(/[,\n]/).map(x=>x.trim()).filter(Boolean))];
function interestHit(r){
  const {keywords,orgs}=interest(),t=(r.t||'').toLowerCase(),o=r.o||'';
  return keywords.some(k=>t.includes(k.toLowerCase()))||orgs.some(k=>o.includes(k));
}

async function getJSON(path,v){
  const res=await fetch(`${path}?v=${encodeURIComponent(v)}`,{cache:'no-cache'});
  if(!res.ok)throw Error(`${path} ${res.status}`);
  return res.json();
}

// ── 불러오기
function refreshSnapshots(list){for(const r of list){if(store.fav[r.i])store.fav[r.i]=r;if(store.track[r.i])store.track[r.i].r=r;}}
async function load(){
  try{
    const [m,cfg]=await Promise.all([getJSON('data/meta.json',Date.now()),getJSON('config.json',Date.now()).catch(()=>null)]);
    if(cfg?.interest)defaults={keywords:splitList((cfg.interest.keywords||[]).join(',')),orgs:splitList((cfg.interest.orgs||[]).join(','))};
    const changed=!meta||m.lastAttempt!==meta.lastAttempt||m.lastSuccess!==meta.lastSuccess;
    meta=m;loadedAt=Date.now();
    if(changed){open=await getJSON('data/open.json',m.lastAttempt||'0');archive=null;archiveLoading=null;}
    refreshSnapshots(open);save();
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
    archiveLoading=Promise.all(years.map(y=>getJSON(`data/archive-${y}.json`,meta.lastAttempt||'0'))).then(parts=>{
      archive=parts.flat();refreshSnapshots(archive);save();
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
  for(const [id,label,values] of [['target','전체',TARGETS],['status','전체',STATUSES],['progress','전체',PROGRESSES],['region','전체',REGIONS]]){
    const s=$('#'+id);s.append(new Option(label,''));for(const v of values)s.append(new Option(v,v));
  }
}
function mineRows(){
  const map=new Map();
  for(const r of Object.values(store.fav))if(r)map.set(r.i,r);
  for(const [id,t] of Object.entries(store.track))if(t?.r)map.set(id,map.get(id)||t.r);
  return [...map.values()];
}
function sourceRows(){
  const hide=!$('#showSkipped').checked;
  if(view==='open')return hide?open.filter(r=>!isSkipped(r)):open;
  if(view==='interest')return open.filter(r=>interestHit(r)&&(!hide||!isSkipped(r)));
  if(view==='new')return open.filter(r=>isRecent(r)&&(!hide||!isSkipped(r)));
  if(view==='mine')return mineRows();
  return archive?open.concat(archive):open;
}
function readFilters(){
  const v=id=>$('#'+id).value.trim();
  let from=v('from'),to=v('to');if(from&&to&&from>to)[from,to]=[to,from];
  return {title:v('qTitle').toLowerCase(),org:v('qOrg').toLowerCase(),from,to,g:v('target'),s:v('status'),p:v('progress'),rg:v('region')};
}
function regionHit(r,rg){
  if(!rg)return true;
  const parts=(r.r||'').split(',').map(x=>x.trim());
  return rg==='전국'?r.r==='전국':parts.includes(rg)||r.r==='전국';
}
// skip: 건수 계산 때 제외할 필터 키(g/s/p/rg)
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
  if(skip!=='rg'&&!regionHit(r,f.rg))return false;
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
function renderInterestBar(){
  const bar=$('#interestBar');bar.hidden=view!=='interest';
  if(view!=='interest')return;
  const {keywords,orgs}=interest(),form=$('#interestForm');
  $('#interestSummary').replaceChildren(
    el('span','lbl','키워드'),...(keywords.length?keywords.map(k=>el('span','tag',k)):[el('span','none','없음')]),
    el('span','lbl','기관'),...(orgs.length?orgs.map(k=>el('span','tag',k)):[el('span','none','없음')]));
  if(form.hidden){$('#kwInput').value=keywords.join(', ');$('#orgInput').value=orgs.join(', ');}
  $('#interestNote').textContent=store.interest?'이 기기에서 바꾼 설정입니다.':'기본 설정입니다. 바꾸면 이 기기에만 저장됩니다.';
}
function groupKey(r,sort,today){
  if(sort==='deadline'){
    if(r.s==='신청중'&&isDate(r.ae)&&r.ae>=today)return r.ae;
    if(r.s==='신청예정')return '~upcoming';
    return '~closed';
  }
  if(sort==='found')return r.f?kstDateOf(r.f):'~base';
  if(sort==='track')return '~t-'+(trackOf(r)||'fav');
  return isDate(r.d)?r.d:'~none';
}
const SPECIAL={'~upcoming':'신청 시작 전','~closed':'마감되었거나 기간 미표기','~base':'기준 수집 때 있던 공고','~none':'등록일 미표기','~t-review':'검토 중','~t-applied':'지원함','~t-fav':'즐겨찾기만','~t-skip':'제외'};
function groupHead(key,sort,count,today){
  const h=el('div','ghead'),t=el('h2');let wd='',dd='';
  if(key.startsWith('~'))t.textContent=SPECIAL[key];
  else{
    const diff=dayNum(key)-dayNum(today),w=WD[new Date(key+'T00:00:00Z').getUTCDay()];
    const label=diff===0?'오늘':diff===1&&sort==='deadline'?'내일':diff===-1?'어제':`${+key.slice(5,7)}월 ${+key.slice(8)}일`;
    const yr=key.slice(0,4)!==today.slice(0,4)?`${key.slice(0,4)}년 `:'';
    if(sort==='deadline'&&diff<=URGENT){t.append(el('mark','hl-due',label));h.classList.add('urgent');}else t.textContent=yr+label;
    wd=(diff===0||diff===1||diff===-1)?`${+key.slice(5,7)}월 ${+key.slice(8)}일 ${w}요일`:`${w}요일`;
    dd=sort==='deadline'?(diff===0?'오늘 마감':`D-${diff}`):sort==='found'?'발견':'등록';
  }
  h.append(t);if(wd)h.append(el('span','wd',wd));
  h.append(el('span','dd',dd),el('span','gc',`${fmt(count)}건`));
  return h;
}
function sortRows(rows,sort){
  const dl=r=>{const d=dday(r.ae);return d!==null&&d>=0&&r.s==='신청중'?d:1e9;};
  const byReg=(a,b)=>(b.d||'').localeCompare(a.d||'')||b.i.localeCompare(a.i);
  if(sort==='deadline'){
    const rank=r=>dl(r)<1e9?dl(r):r.s==='신청예정'?1e8:1e9,m=new Map(rows.map(r=>[r.i,rank(r)]));
    rows.sort((a,b)=>m.get(a.i)-m.get(b.i)||(m.get(a.i)===1e8?(a.as||'').localeCompare(b.as||''):0)||byReg(a,b));
  }else if(sort==='found')rows.sort((a,b)=>(b.f||'').localeCompare(a.f||'')||byReg(a,b));
  else if(sort==='track'){const o={review:0,applied:1,'':2,skip:3};rows.sort((a,b)=>o[trackOf(a)]-o[trackOf(b)]||dl(a)-dl(b)||byReg(a,b));}
  else rows.sort(byReg);
  return rows;
}
let lastRows=[];
function render(){
  if(!meta)return;
  const applying=open.filter(r=>r.s==='신청중');
  const visible=open.filter(r=>!isSkipped(r));
  const counts={openCount:visible.length,interestCount:visible.filter(interestHit).length,newCount:visible.filter(isNew).length,
    mineCount:mineRows().length,allCount:meta.open+Object.values(meta.archive||{}).reduce((a,b)=>a+b,0)};
  for(const [id,v] of Object.entries(counts))$('#'+id).textContent=v?fmt(v):'';
  renderSync();renderStrip(applying);renderInterestBar();

  // 목록 — 선택지마다 '그 필터를 뺀 나머지 조건' 기준 건수를 표시
  const base=sourceRows(),sort=$('#sort').value,f=readFilters();
  for(const [id,key] of [['target','g'],['status','s'],['progress','p']]){
    const c={};for(const r of base)if(match(r,f,key))c[r[key]]=(c[r[key]]||0)+1;
    for(const o of $('#'+id).options)if(o.value)o.textContent=`${o.value} (${fmt(c[o.value]||0)})`;
  }
  {const rest=base.filter(r=>match(r,f,'rg'));for(const o of $('#region').options)if(o.value)o.textContent=`${o.value} (${fmt(rest.filter(r=>regionHit(r,o.value)).length)})`;}
  const active=[f.org,f.from||f.to,f.g,f.s,f.p,f.rg,$('#showSkipped').checked].filter(Boolean).length;
  $('#filterCount').textContent=active?` ${active}`:'';$('#filterToggle').classList.toggle('on',active>0);

  const rows=sortRows(base.filter(r=>match(r,f)),sort);lastRows=rows;
  $('#viewTitle').textContent=TITLES[view];
  $('#markAll').hidden=!(view==='new'&&counts.newCount>0);
  const chip=$('#dateChip');chip.hidden=!dueDate;
  if(dueDate)chip.textContent=`${+dueDate.slice(5,7)}월 ${+dueDate.slice(8)}일 마감만 ✕`;
  const loadingArchive=view==='all'&&!archive;
  $('#resultCount').textContent=loadingArchive?'지난 공고까지 불러오는 중':`${fmt(rows.length)}건`;
  $('#exportBtn').disabled=!rows.length;
  const list=$('#cards');
  if(!rows.length&&!loadingArchive){
    list.replaceChildren(view==='new'?empty(`최근 ${meta.newDays}일 동안 새로 발견한 공고가 없습니다`,'수집기가 새 공고를 찾으면 여기에 먼저 보입니다.')
      :view==='mine'&&!counts.mineCount?empty('아직 담아 둔 공고가 없습니다','공고 오른쪽 별을 누르거나 메모 버튼으로 검토 상태를 정하면 여기에 모입니다.')
      :view==='interest'&&!interest().keywords.length&&!interest().orgs.length?empty('관심 키워드와 기관이 비어 있습니다','위의 관심 설정 바꾸기에서 단어나 기관명을 넣으세요.')
      :empty('조건에 맞는 공고가 없습니다','필터를 줄이거나 다른 검색어를 넣어 보세요.'));
  }else{
    const today=kstToday(),gc=new Map();
    for(const r of rows){const k=groupKey(r,sort,today);gc.set(k,(gc.get(k)||0)+1);}
    const out=[];let cur=null,box=null;
    for(const r of rows.slice(0,shown)){
      const k=groupKey(r,sort,today);
      if(k!==cur){cur=k;const g=el('section','group');box=el('div','items');g.append(groupHead(k,sort,gc.get(k),today),box);out.push(g);}
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
function iconButton(cls,path,label,pressed,onclick){
  const b=el('button','icon'+(cls?' '+cls:''));b.append(svg(path));
  b.setAttribute('aria-label',label);b.title=label;if(pressed!==null)b.setAttribute('aria-pressed',String(pressed));
  b.onclick=onclick;return b;
}
function card(r,sort){
  const read=isRead(r),fav=!!store.fav[r.i],fresh=isNew(r),tr=store.track[r.i],st=tr?.s||'';
  const item=el('article','item'+(read?' read':'')+(st==='skip'?' skipped':''));
  const main=el('div','item-main'),meta=el('p','meta');
  meta.append(el('span','cat',CAT[r.c]||'기타'));
  if(st)meta.append(el('span','track t-'+st,TRACK[st]));
  const b=badge(r,sort);if(b)meta.append(el('span','badge',b));
  if(fresh)meta.append(el('span','newtag','NEW'));
  if(view!=='interest'&&interestHit(r))meta.append(el('span','itag','관심'));
  if(r.o)meta.append(el('span','org',r.o));
  const a=el('a','title');a.href=url(r);a.target='_blank';a.rel='noopener noreferrer';
  a.append(el(fresh?'mark':'span',fresh?'hl-new':'',r.t));
  a.addEventListener('click',()=>{if(!store.read[r.i]){store.read[r.i]=1;save();setTimeout(render,300);}});
  const facts=el('dl','facts');
  facts.append(fact('신청',range(r.as,r.ae)),fact('지원',range(r.ss,r.se)),fact('지역',r.r||'미표기'),fact('대상',r.g||'미표기'),fact('진행',r.p||'미표기'));
  if(r.f&&sort!=='found')facts.append(fact('발견',when(r.f)));
  main.append(meta,a,facts);
  if(tr?.m&&editing!==r.i)main.append(el('p','memo',tr.m));
  if(editing===r.i)main.append(editor(r));
  const act=el('div','acts');
  act.append(
    iconButton(fav?'on':'',STAR,fav?'즐겨찾기에서 빼기':'즐겨찾기에 넣기',fav,()=>{if(store.fav[r.i]){delete store.fav[r.i];toast('즐겨찾기에서 뺐습니다.');}else{store.fav[r.i]=r;toast('즐겨찾기에 넣었습니다.');}save();render();}),
    iconButton((st||tr?.m?'has ':'')+(editing===r.i?'open':''),NOTE,'검토 상태와 메모',editing===r.i,()=>{editing=editing===r.i?null:r.i;render();}),
    iconButton(read?'read-on':'',CHECK,read?'읽지 않음으로 바꾸기':'읽음으로 표시',read,()=>{if(store.read[r.i])delete store.read[r.i];else store.read[r.i]=1;save();render();}));
  item.append(main,act);return item;
}
function setTrack(r,patch){
  const cur=store.track[r.i]||{s:'',m:''},next={...cur,...patch,r,at:new Date().toISOString()};
  if(!next.s&&!next.m)delete store.track[r.i];else store.track[r.i]=next;
  save();
}
function editor(r){
  const tr=store.track[r.i]||{s:'',m:''},box=el('div','editor');
  const seg=el('div','seg');seg.setAttribute('role','group');seg.setAttribute('aria-label','검토 상태');
  for(const [k,label] of [['','없음'],...Object.entries(TRACK)]){
    const b=el('button',tr.s===k?'on':'',label);b.setAttribute('aria-pressed',String(tr.s===k));
    b.onclick=()=>{setTrack(r,{s:k});if(k==='skip'&&!$('#showSkipped').checked&&view!=='mine'){editing=null;toast('제외했습니다. 필터에서 "제외한 공고도 보기"를 켜면 다시 보입니다.');}render();};
    seg.append(b);
  }
  const memo=el('textarea');memo.rows=2;memo.placeholder='메모 (예: 자격 요건 확인 필요, 11/10 팀장 보고)';memo.value=tr.m||'';memo.setAttribute('aria-label','메모');
  let t;memo.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(()=>setTrack(r,{m:memo.value.trim()}),400);});
  const done=el('button','ghost small','닫기');done.onclick=()=>{setTrack(r,{m:memo.value.trim()});editing=null;render();};
  const foot=el('div','editor-foot');foot.append(el('small','','이 기기에만 저장됩니다'),done);
  box.append(seg,memo,foot);
  setTimeout(()=>{if(document.activeElement===document.body)memo.focus({preventScroll:true});},0);
  return box;
}

// ── 내보내기: 지금 보이는 조건의 공고 전체
function exportRows(){
  const today=kstToday();
  return lastRows.map(r=>{const d=dday(r.ae);return {
    '분야':CAT[r.c]||'기타','기관':r.o||'','공고명':r.t||'','신청 시작':r.as||'','신청 마감':r.ae||'',
    '남은 날':r.s==='신청중'&&d!==null&&d>=0?(d===0?'오늘':`D-${d}`):(r.s||''),
    '지원기간':r.ss||r.se?`${r.ss||''} ~ ${r.se||''}`:'','지역':r.r||'','대상':r.g||'','진행단계':r.p||'',
    '검토 상태':TRACK[trackOf(r)]||'','메모':store.track[r.i]?.m||'','링크':url(r)};});
}
function download(name,text,type){
  const blob=new Blob([text],{type}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=name;a.hidden=true;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},4000);
}
async function copyTable(){
  const rows=exportRows();if(!rows.length)return;
  const cols=Object.keys(rows[0]).filter(c=>c!=='링크'),esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const html='<table border="1" style="border-collapse:collapse;font-size:10pt"><thead><tr>'+cols.map(c=>`<th style="background:#eef1f5;padding:4px 6px">${esc(c)}</th>`).join('')+'</tr></thead><tbody>'+
    rows.map(r=>'<tr>'+cols.map(c=>`<td style="padding:4px 6px">${c==='공고명'?`<a href="${esc(r['링크'])}">${esc(r[c])}</a>`:esc(r[c])}</td>`).join('')+'</tr>').join('')+'</tbody></table>';
  const tsv=[cols.join('\t'),...rows.map(r=>cols.map(c=>String(r[c]).replace(/[\t\n]/g,' ')).join('\t'))].join('\n');
  try{
    if(window.ClipboardItem&&navigator.clipboard?.write)await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([tsv],{type:'text/plain'})})]);
    else await navigator.clipboard.writeText(tsv);
    toast(`${fmt(rows.length)}건을 표로 복사했습니다. 한글·엑셀·메일에 붙여넣으세요.`);
  }catch{toast('복사하지 못했습니다. 엑셀로 받기를 이용하세요.');}
}
function downloadCsv(){
  const rows=exportRows();if(!rows.length)return;
  const cols=Object.keys(rows[0]),q=v=>`"${String(v).replace(/"/g,'""')}"`;
  const csv='﻿'+[cols.map(q).join(','),...rows.map(r=>cols.map(c=>q(r[c])).join(','))].join('\r\n');
  download(`sangsaeng-moa_${view}_${kstToday()}.csv`,csv,'text/csv;charset=utf-8');
  toast(`${fmt(rows.length)}건을 엑셀 파일(CSV)로 받았습니다.`);
}

// ── 이벤트
function selectView(v){
  view=v;shown=PAGE;editing=null;$('#sort').value=DEFAULT_SORT[v];
  for(const b of $('#views').children){b.classList.toggle('selected',b.dataset.view===v);b.setAttribute('aria-current',b.dataset.view===v?'page':'false');}
  render();
  if(v==='all')ensureArchive().then(render,()=>render());
}
$('#views').onclick=e=>{const b=e.target.closest('button');if(b)selectView(b.dataset.view);};
$('#categories').onclick=e=>{const b=e.target.closest('button');if(!b)return;category=b.dataset.c;shown=PAGE;for(const x of $('#categories').children){x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));}render();};
$('#strip').onclick=e=>{const b=e.target.closest('.day');if(!b||b.disabled)return;dueDate=dueDate===b.dataset.date?'':b.dataset.date;shown=PAGE;if(dueDate&&!['open','interest'].includes(view))selectView('open');else render();};
$('#dateChip').onclick=()=>{dueDate='';shown=PAGE;render();};
let typing;
for(const id of ['qTitle','qOrg'])$('#'+id).addEventListener('input',()=>{clearTimeout(typing);typing=setTimeout(()=>{shown=PAGE;render();},200);});
for(const id of ['from','to','target','status','progress','region','sort','showSkipped'])$('#'+id).addEventListener('change',()=>{shown=PAGE;render();});
$('#filterToggle').onclick=()=>{const o=$('#filters').classList.toggle('open');$('#filterToggle').setAttribute('aria-expanded',String(o));};
$('#resetFilters').onclick=()=>{for(const id of ['qTitle','qOrg','from','to','target','status','progress','region'])$('#'+id).value='';$('#showSkipped').checked=false;dueDate='';shown=PAGE;render();};
$('#more').onclick=()=>{shown+=PAGE;render();};
$('#markAll').onclick=()=>{for(const r of open.filter(isNew))store.read[r.i]=1;save();render();toast('새로 발견한 공고를 모두 읽음으로 표시했습니다.');};
// 관심 설정
$('#interestEdit').onclick=()=>{const f=$('#interestForm');f.hidden=!f.hidden;$('#interestEdit').setAttribute('aria-expanded',String(!f.hidden));if(!f.hidden){renderInterestBar();$('#kwInput').focus();}};
$('#interestForm').onsubmit=e=>{e.preventDefault();store.interest={keywords:splitList($('#kwInput').value),orgs:splitList($('#orgInput').value)};save();$('#interestForm').hidden=true;render();toast('관심 설정을 저장했습니다.');};
$('#interestReset').onclick=()=>{store.interest=null;save();$('#interestForm').hidden=true;render();toast('기본 관심 설정으로 되돌렸습니다.');};
// 내보내기 메뉴
$('#exportBtn').onclick=e=>{e.stopPropagation();const m=$('#exportMenu');m.hidden=!m.hidden;$('#exportBtn').setAttribute('aria-expanded',String(!m.hidden));
  if(!m.hidden)$('#exportInfo').textContent=`지금 목록 ${fmt(lastRows.length)}건 (더 보기로 펼치지 않은 것 포함)`;};
document.addEventListener('click',e=>{if(!e.target.closest('.export')){$('#exportMenu').hidden=true;$('#exportBtn').setAttribute('aria-expanded','false');}});
$('#copyTable').onclick=()=>{$('#exportMenu').hidden=true;copyTable();};
$('#downloadCsv').onclick=()=>{$('#exportMenu').hidden=true;downloadCsv();};
// 폰에서 다시 열었을 때 5분이 지났으면 새 데이터 확인
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-loadedAt>5*60000)load();});

setup();load();
