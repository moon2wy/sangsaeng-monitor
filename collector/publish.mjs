// docs/data 변경분을 GitHub에 올린다. 인증은 PC의 Git 자격 증명(Git Credential Manager)을 그대로 쓴다.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const ID=['-c','user.name=sangsaeng-collector','-c','user.email=sangsaeng-collector@users.noreply.github.com'];

export async function git(repo,args,{timeout=120000}={}){
  const {stdout}=await exec('git',['-C',repo,...args],{timeout,windowsHide:true,maxBuffer:8*1024*1024});
  return stdout.trim();
}

// 원격의 코드 변경(Claude가 올린 수정 등)을 먼저 받는다. 코드 변경은 다음 실행부터 적용된다.
export async function pull(repo){
  await git(repo,[...ID,'pull','--rebase','--autostash','--quiet']);
}

export async function aheadCount(repo){
  try{return Number(await git(repo,['rev-list','--count','@{u}..HEAD']))||0;}catch{return 0;}
}

// 데이터 폴더만 커밋한다. 다른 파일(코드)은 건드리지 않는다.
export async function publish(repo,dataPath,message){
  await git(repo,['add','--all','--',dataPath]);
  let staged=true;
  try{await git(repo,['diff','--cached','--quiet','--',dataPath]);staged=false;}catch{}
  if(staged)await git(repo,[...ID,'commit','--quiet','-m',message,'--',dataPath]);
  if(!staged&&!(await aheadCount(repo)))return false;
  try{await git(repo,[...ID,'pull','--rebase','--autostash','--quiet']);}
  catch(e){try{await git(repo,['rebase','--abort']);}catch{}throw e;}   // 충돌 시 rebase 중간 상태로 남지 않게
  await git(repo,['push','--quiet','origin','HEAD'],{timeout:300000});
  return true;
}
