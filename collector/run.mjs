// PC 수집기: 12시간마다 상생누리 공개 목록을 수집 → docs/data 갱신 → GitHub에 업로드.
// 사용: node collector/run.mjs           (계속 실행)
//       node collector/run.mjs --once    (지금 수집할 차례면 1회 수집·업로드 후 종료)
import net from 'node:net';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDB,meta} from './lib.mjs';
import {collect,INTERVAL} from './collector.mjs';
import {buildSite,writeSite} from './export.mjs';
import {git,pull,publish} from './publish.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=resolve(root,'docs','data');
const dbPath=resolve(process.env.DATA_DIR||resolve(root,'local-data'),'monitor.sqlite');
const once=process.argv.includes('--once');
const RETRY=10*60*1000;

const stamp=()=>new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false});
const log=(...a)=>console.log(`[${stamp()}]`,...a);
const short=e=>String(e?.stderr||e?.message||e).trim().split('\n').slice(-3).join(' / ').slice(0,300);

// 같은 PC에서 수집기를 두 번 켜지 않도록 로컬 포트로 단일 실행을 보장한다.
async function singleInstance(){
  const port=Number(process.env.LOCK_PORT||4317);
  return new Promise((ok,fail)=>{
    const s=net.createServer();
    s.once('error',e=>fail(e.code==='EADDRINUSE'?Error('수집기가 이미 실행 중입니다. 이 창은 닫아도 됩니다.'):e));
    s.listen(port,'127.0.0.1',()=>ok(s));
  });
}

let db,busy=false,pending=false;

async function upload(message){
  writeSite(dataDir,buildSite(db));
  try{
    if(await publish(root,'docs/data',message))log('GitHub 업로드 완료');
    pending=false;
  }catch(e){pending=true;log('GitHub 업로드 실패 (10분 뒤 다시 시도):',short(e));}
}

async function cycle(){
  if(busy)return;busy=true;
  try{
    try{await pull(root);}catch(e){log('GitHub에서 최신 코드 받기 실패 (수집은 계속):',short(e));}
    let message;
    try{
      const r=await collect(db,{onProgress:p=>log('수집 중',p)});
      message=r.baseline?'data: 첫 기준 수집':`data: 수집 성공 · 신규 ${r.added}건`;
      log('수집 성공',r.baseline?'(기준 데이터)':`신규 ${r.added}건`,`· 총 ${r.count.toLocaleString()}건`);
    }catch(e){
      log('수집 실패:',e.message);
      if(/이미 수집 중|간격/.test(e.message))return;
      message='data: 수집 실패 기록';
    }
    await upload(message);
  }finally{busy=false;}
}

function due(){const last=meta(db,'lastAttempt');return !last||Date.now()-new Date(last).getTime()>=INTERVAL;}
function nextText(){const last=meta(db,'lastAttempt');return last?new Date(new Date(last).getTime()+INTERVAL).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false}):'지금';}

async function main(){
  const lock=await singleInstance();
  db=openDB(dbPath);
  const shutdown=()=>{log('수집기를 종료합니다.');try{db.close();}catch{}lock.close();process.exit(0);};
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  log('상생 모아 수집기 시작 · DB',dbPath);

  // 시작할 때 GitHub 로그인을 확인한다(처음 한 번은 로그인 창이 뜰 수 있음).
  try{await git(root,['push','--dry-run','--quiet','origin','HEAD'],{timeout:300000});log('GitHub 연결 확인됨');}
  catch(e){log('GitHub 연결 확인 실패:',short(e),'→ README의 PC 설정 2단계를 확인하세요.');}

  if(once){
    if(due())await cycle();else log('아직 수집 차례가 아닙니다. 다음 수집:',nextText());
    db.close();lock.close();return;
  }
  if(due())await cycle();else log('다음 수집 예정:',nextText(),'(이 창을 열어 두세요)');
  let lastRetry=Date.now();
  setInterval(async()=>{
    if(due())return cycle();
    if(pending&&!busy&&Date.now()-lastRetry>=RETRY){lastRetry=Date.now();busy=true;try{await upload('data: 업로드 재시도');}finally{busy=false;}}
  },60000);
}

main().catch(e=>{console.error(e.message);process.exitCode=1;});
