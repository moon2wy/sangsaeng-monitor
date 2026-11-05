import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openDB,normalize,commitSnapshot} from '../collector/lib.mjs';
import {buildSite,writeSite,isOpen} from '../collector/export.mjs';
import {publish} from '../collector/publish.mjs';

const raw=(id,extra={})=>({prgId:'100',bizId:String(id),bizNm:'테스트 전용 공고 '+id,bizAreaSecd:'3',membrCorpNm:'테스트 기관',fstRegDt:'2024-03-01',applyStepNm:'신청완료',notiEdYmd:'2024-04-01',...extra});
const tmp=()=>mkdtempSync(join(tmpdir(),'export-test-'));

test('진행 중/지난 공고 분리, 기준 수집은 발견일 없음, 이후 신규만 발견일 포함',()=>{
  const dir=tmp(),db=openDB(join(dir,'t.sqlite'));
  try{
    commitSnapshot(db,[normalize(raw(1)),normalize(raw(2,{applyStepNm:'신청중',notiEdYmd:'2026-12-31',fstRegDt:'2026-10-01'}))],2,'2026-11-01T00:00:00.000Z');
    commitSnapshot(db,[normalize(raw(1)),normalize(raw(2,{applyStepNm:'신청중',notiEdYmd:'2026-12-31',fstRegDt:'2026-10-01'})),normalize(raw(3))],3,'2026-11-05T00:00:00.000Z');
    const site=buildSite(db,new Date('2026-11-05T03:00:00Z'));
    const ids=site['open.json'].map(r=>r.i);
    assert.deepEqual(ids,['100:2','100:3']);           // 2: 신청중, 3: 신청완료지만 최근 발견
    assert.equal(site['open.json'][0].f,undefined);      // 기준 수집 공고
    assert.equal(site['open.json'][1].f,'2026-11-05T00:00:00.000Z');
    assert.deepEqual(site['archive-2024.json'].map(r=>r.i),['100:1']);
    assert.equal(site['meta.json'].lastAdded,1);
    // 15일 뒤에는 신청완료 신규 공고도 지난 공고로 이동
    const later=buildSite(db,new Date('2026-11-21T00:00:00Z'));
    assert.deepEqual(later['open.json'].map(r=>r.i),['100:2']);
    assert.equal(later['archive-2024.json'].length,2);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('마감일이 오늘 이후면 상태와 무관하게 진행 중',()=>{
  assert.equal(isOpen({s:'',ae:'2026-11-05'},'2026-11-05',Date.now()),true);
  assert.equal(isOpen({s:'',ae:'2026-11-04'},'2026-11-05',Date.now()),false);
  assert.equal(isOpen({s:'신청예정',ae:''},'2026-11-05',Date.now()),true);
});

test('바뀐 파일만 쓰고 사라진 연도 파일은 삭제, CRLF 체크아웃도 같은 내용으로 인식',()=>{
  const dir=tmp();
  try{
    assert.deepEqual(writeSite(dir,{'open.json':[],'archive-2020.json':[{i:'1'}],'meta.json':{a:1}}).sort(),['archive-2020.json','meta.json','open.json']);
    assert.deepEqual(writeSite(dir,{'open.json':[],'archive-2020.json':[{i:'1'}],'meta.json':{a:1}}),[]);
    writeFileSync(join(dir,'meta.json'),'{"a":1}\r\n');
    assert.deepEqual(writeSite(dir,{'open.json':[],'archive-2020.json':[{i:'1'}],'meta.json':{a:1}}),[]);
    assert.deepEqual(writeSite(dir,{'open.json':[],'meta.json':{a:1}}),['archive-2020.json']);
    assert.equal(existsSync(join(dir,'archive-2020.json')),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('데이터 폴더만 커밋·push하고, 원격에 먼저 올라온 코드 변경과 충돌 없이 합침',async()=>{
  const dir=tmp(),remote=join(dir,'remote.git'),pc=join(dir,'pc'),dev=join(dir,'dev');
  const g=(cwd,...a)=>execFileSync('git',['-c','user.name=t','-c','user.email=t@t','-c','init.defaultBranch=main',...a],{cwd,stdio:'pipe'}).toString().trim();
  try{
    g(dir,'init','--bare','-q',remote);
    g(dir,'clone','-q',remote,dev);writeFileSync(join(dev,'code.txt'),'v1\n');g(dev,'add','.');g(dev,'commit','-qm','init');g(dev,'push','-q','origin','HEAD:main');
    g(dir,'clone','-q',remote,pc);
    // 원격에 코드 변경이 먼저 올라감
    writeFileSync(join(dev,'code.txt'),'v2\n');g(dev,'commit','-qam','code');g(dev,'push','-q');
    // PC: 데이터 변경 + 커밋되지 않은 다른 파일은 건드리지 않음
    mkdirSync(join(pc,'docs','data'),{recursive:true});writeFileSync(join(pc,'docs','data','meta.json'),'{}\n');writeFileSync(join(pc,'scratch.txt'),'x');
    assert.equal(await publish(pc,'docs/data','data: test'),true);
    g(dev,'pull','-q');
    assert.equal(readFileSync(join(dev,'docs','data','meta.json'),'utf8'),'{}\n');
    assert.equal(existsSync(join(dev,'scratch.txt')),false);
    assert.equal(readFileSync(join(pc,'code.txt'),'utf8'),'v2\n');
    assert.equal(await publish(pc,'docs/data','data: none'),false);   // 변경 없으면 아무것도 안 함
  }finally{rmSync(dir,{recursive:true,force:true});}
});
