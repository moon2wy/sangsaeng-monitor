// DB → 웹페이지용 정적 JSON (docs/data). 진행 중 공고는 open.json, 지난 공고는 등록연도별 archive-YYYY.json.
import {readFileSync,writeFileSync,readdirSync,unlinkSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {meta} from './lib.mjs';

export const NEW_DAYS=14;
const DAY=86400000;

export function kstDate(d=new Date()){
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}

// 짧은 키로 줄여서 전송량을 줄인다. 원문 URL은 화면에서 prgId:bizId로 만든다.
function compact(d,firstSeen,baseline){
  const r={i:d.id,t:d.title,c:d.categoryCode,o:d.organization,r:d.region,g:d.target,as:d.applyStart,ae:d.applyEnd,ss:d.supportStart,se:d.supportEnd,s:d.applyStatus,p:d.progress,d:d.registered};
  if(!baseline)r.f=firstSeen;
  return r;
}

export function isOpen(r,today,now){
  if(r.s==='신청중'||r.s==='신청예정')return true;
  if(/^\d{4}-\d\d-\d\d$/.test(r.ae)&&r.ae>=today)return true;
  return !!r.f&&now-new Date(r.f)<NEW_DAYS*DAY;
}

export function buildSite(db,now=new Date()){
  const today=kstDate(now),open=[],archive={};
  const rows=db.prepare('SELECT data,first_seen,baseline FROM notices WHERE active=1 ORDER BY id').all();
  for(const row of rows){
    const r=compact(JSON.parse(row.data),row.first_seen,row.baseline);
    if(isOpen(r,today,now)){open.push(r);continue;}
    const y=/^\d{4}/.test(r.d)?r.d.slice(0,4):'etc';
    (archive[y]||=[]).push(r);
  }
  const runs=db.prepare('SELECT started,finished,status,message,count FROM runs ORDER BY id DESC LIMIT 5').all().map(x=>({...x}));
  const metaJson={
    schema:1,
    baselineAt:meta(db,'baselineAt')||null,
    lastAttempt:meta(db,'lastAttempt')||null,
    lastSuccess:meta(db,'lastSuccess')||null,
    lastAdded:Number(meta(db,'lastAdded')||0),
    sourceTotal:Number(meta(db,'sourceTotal')||0),
    newDays:NEW_DAYS,
    open:open.length,
    archive:Object.fromEntries(Object.keys(archive).sort().reverse().map(y=>[y,archive[y].length])),
    runs
  };
  const files={'open.json':open};
  for(const [y,list] of Object.entries(archive))files[`archive-${y}.json`]=list;
  // meta.json은 마지막에 써서, 데이터 파일보다 먼저 새 버전을 가리키지 않게 한다.
  files['meta.json']=metaJson;
  return files;
}

// 내용이 바뀐 파일만 쓴다. 더 이상 없는 archive 파일은 지운다. 바뀐 파일명 목록을 돌려준다.
export function writeSite(dir,files){
  mkdirSync(dir,{recursive:true});
  const changed=[];
  for(const [name,value] of Object.entries(files)){
    const path=join(dir,name),text=JSON.stringify(value)+'\n';
    const old=existsSync(path)?readFileSync(path,'utf8').replace(/\r\n/g,'\n'):null;
    if(old===text)continue;
    writeFileSync(path,text);changed.push(name);
  }
  for(const name of readdirSync(dir)){
    if(/^archive-.+\.json$/.test(name)&&!files[name]){unlinkSync(join(dir,name));changed.push(name);}
  }
  return changed;
}
