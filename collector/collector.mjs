import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { ORIGIN,normalize,commitSnapshot,meta,setMeta } from './lib.mjs';
const exec=promisify(execFile);
export const INTERVAL=12*60*60*1000;
export const DELAY=2000;
const UA='SangsaengPersonalMonitor/2.0 (+personal-public-list-monitor; 12h; 2s-delay)';
export async function request(path){
  const url=new URL(path,ORIGIN);
  if(url.origin!==ORIGIN)throw Error('허용하지 않은 출처');
  const {stdout}=await exec(process.platform==='win32'?'curl.exe':'curl',['--silent','--show-error','--max-time','30','--max-filesize','5242880','--user-agent',UA,'--header','Accept: application/json,text/plain','--write-out','\n%{http_code}',url.href],{maxBuffer:6*1024*1024,windowsHide:true});
  const i=stdout.lastIndexOf('\n'),status=Number(stdout.slice(i+1));
  if(status!==200)throw Error(`HTTP ${status}: 자동 재시도 없이 중단 (로그인/차단/제한 우회 없음)`);
  return stdout.slice(0,i);
}
// Fail closed when robots changes, becomes HTML, or specifies restrictions for this agent.
export function checkRobots(text){
  if(!/^user-agent:/im.test(text)||/<html/i.test(text))throw Error('robots.txt 검증 실패');
  const groups=[];let group={agents:[],rules:[]};
  for(const line of text.split(/\r?\n/)){
    const m=line.replace(/#.*/,'').trim().match(/^([^:]+):\s*(.*)$/);if(!m)continue;
    const key=m[1].toLowerCase(),v=m[2].trim();
    if(key==='user-agent'){
      if(group.rules.length){groups.push(group);group={agents:[],rules:[]};}
      group.agents.push(v.toLowerCase());
    }else{group.rules.push([key,v]);}
  }
  groups.push(group);
  const matching=groups.filter(g=>g.agents.some(a=>a==='*'||UA.toLowerCase().includes(a)));
  if(!matching.length)throw Error('robots 규칙 확인 불가');
  // Conservatively honor all matching disallows, including a generic group.
  for(const g of matching)for(const [key,v] of g.rules){
    if(key==='crawl-delay'&&Number(v)>DELAY/1000)throw Error('robots의 요청 간격이 기본값보다 큽니다. 설정 재검토 필요');
    if(key==='disallow'&&v){
      // Query-specific disallows conservatively block this endpoint altogether.
      const rule=v.split('?')[0],anchored=rule.endsWith('$');
      const pattern=(anchored?rule.slice(0,-1):rule).replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*');
      const regex=new RegExp('^'+pattern+(anchored?'$':''));
      if(['/pg/selectPgProgramAjax.do','/pg/businessView.do'].some(p=>regex.test(p)))throw Error('robots.txt가 프로그램 수집을 제한합니다.');
    }
  }
}
export function listPath(page,category='0'){
  return '/pg/selectPgProgramAjax.do?'+new URLSearchParams({pageNumber:String(page),pageSize:'100',pageType:'gth',orderType:'3',needRstId:'N',bizAreaSecd:category,supoTrgt:'0',applyStep:'0',progStep:'0',bizArea:'0',clsBizOpenYn:''});
}
export async function collect(db,{onProgress=()=>{},force=false,fetchText=request,wait=sleep}={}){
  const now=new Date(),last=meta(db,'lastAttempt');
  if(!force&&last&&now-new Date(last)<INTERVAL)throw Error('12시간 수집 간격이 아직 지나지 않았습니다.');
  // SQLite lease prevents concurrent collectors across processes. A crashed run expires after 2h.
  db.exec('BEGIN IMMEDIATE');
  try{const lock=meta(db,'collectLock');if(lock&&now-new Date(lock)<2*60*60*1000)throw Error('이미 수집 중입니다.');setMeta(db,'collectLock',now.toISOString());setMeta(db,'lastAttempt',now.toISOString());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  const run=db.prepare('INSERT INTO runs(started,status,message,count) VALUES(?,?,?,0)').run(now.toISOString(),'running','robots 확인');
  try{
    checkRobots(await fetchText('/robots.txt'));await wait(DELAY);
    const rows=[],seen=new Set();let total=null;
    for(let page=1;page<=1000;page++){
      const body=await fetchText(listPath(page));let data;try{data=JSON.parse(body);}catch{throw Error('JSON이 아닌 응답: 로그인 또는 서비스 상태 확인 필요');}
      if(!Number.isSafeInteger(data.total)||data.total<1||!Array.isArray(data.rows)||data.rows.length>100)throw Error('목록 응답 형식 검증 실패');
      if(total===null)total=data.total;
      if(data.total!==total)throw Error('수집 중 원본 건수가 바뀌었습니다. 부분 결과를 저장하지 않습니다.');
      const expected=Math.min(100,total-(page-1)*100);
      if(data.rows.length!==expected)throw Error('페이지 행 수 불일치');
      for(const raw of data.rows){const r=normalize(raw);if(seen.has(r.id))throw Error('페이지 중복/이동 감지. 기존 데이터 유지');seen.add(r.id);rows.push(r);}
      const message=`${page}/${Math.ceil(total/100)} 페이지 · ${rows.length.toLocaleString()}/${total.toLocaleString()}건`;
      db.prepare('UPDATE runs SET message=?,count=? WHERE id=?').run(message,rows.length,run.lastInsertRowid);onProgress(message);
      if(rows.length===total)break;
      if(page===1000)throw Error('페이지 상한 초과');
      await wait(DELAY);
    }
    // Check head again to catch a shifted listing during a long scan.
    await wait(DELAY);const head=JSON.parse(await fetchText(listPath(1)));
    if(head.total!==total||JSON.stringify(head.rows.map(r=>normalize(r).id))!==JSON.stringify(rows.slice(0,100).map(r=>r.id)))throw Error('수집 중 첫 페이지가 변경되었습니다. 다음 수집 때 재확인');
    const result=commitSnapshot(db,rows,total);
    db.prepare('UPDATE runs SET finished=?,status=?,message=?,count=? WHERE id=?').run(new Date().toISOString(),'success',result.baseline?'첫 기준 데이터 저장 (NEW 0건)':`신규 ${result.added}건`,total,run.lastInsertRowid);
    return result;
  }catch(e){db.prepare('UPDATE runs SET finished=?,status=?,message=? WHERE id=?').run(new Date().toISOString(),'error',e.message,run.lastInsertRowid);throw e;}
  finally{setMeta(db,'collectLock','');}
}
