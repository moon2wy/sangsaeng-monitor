import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDB,normalize,commitSnapshot,meta,setMeta} from '../collector/lib.mjs';
import {collect,checkRobots,listPath} from '../collector/collector.mjs';
const raw=(id='1')=>({prgId:'100',bizId:id,bizNm:'테스트 전용 공고',bizAreaSecd:'3',membrCorpNm:'테스트 기관'});
function fixture(fn){return async()=>{const dir=mkdtempSync(join(tmpdir(),'monitor-test-'));const db=openDB(join(dir,'test.sqlite'));try{await fn(db);}finally{db.close();rmSync(dir,{recursive:true,force:true});}};}
test('첫 기준 수집 NEW 0 / 재수집 중복 0 / 이후 최초 발견만 신규',fixture(db=>{
  assert.deepEqual(commitSnapshot(db,[normalize(raw())],1),{baseline:true,added:0,count:1});
  assert.equal(commitSnapshot(db,[normalize(raw())],1).added,0);
  assert.equal(commitSnapshot(db,[normalize(raw()),normalize(raw('2'))],2).added,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notices').get().n,2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notices WHERE baseline=0 AND read=0').get().n,1);
}));
test('동일 프로그램의 다른 모집차수는 서로 다른 공고',()=>assert.notEqual(normalize(raw('1')).id,normalize(raw('2')).id));
test('수정 공고는 신규로 재생성하지 않고 읽음·즐겨찾기 보존',fixture(db=>{
  commitSnapshot(db,[normalize(raw())],1);db.exec('UPDATE notices SET read=1,favorite=1');
  const row=normalize({...raw(),bizNm:'변경된 제목'});commitSnapshot(db,[row],1);
  const saved=db.prepare('SELECT * FROM notices').get();assert.equal(saved.read,1);assert.equal(saved.favorite,1);assert.equal(saved.baseline,1);assert.match(saved.data,/변경된 제목/);
}));
test('불완전·중복 스냅샷은 기존 데이터 및 기준점을 변경하지 않음',fixture(db=>{
  commitSnapshot(db,[normalize(raw())],1);const baseline=meta(db,'baselineAt');
  assert.throws(()=>commitSnapshot(db,[normalize(raw('2'))],2));
  assert.throws(()=>commitSnapshot(db,[normalize(raw('2')),normalize(raw('2'))],2));
  assert.equal(meta(db,'baselineAt'),baseline);assert.equal(db.prepare('SELECT id FROM notices').get().id,'100:1');
}));
test('사라진 공고 이력 보존 / 재등장 시 신규 오판 없음',fixture(db=>{
  commitSnapshot(db,[normalize(raw()),normalize(raw('2'))],2);commitSnapshot(db,[normalize(raw('2'))],1);
  assert.equal(db.prepare("SELECT active FROM notices WHERE id='100:1'").get().active,0);
  assert.equal(commitSnapshot(db,[normalize(raw()),normalize(raw('2'))],2).added,0);
}));
test('잘못된 응답과 알 수 없는 분야는 거부',()=>{assert.throws(()=>normalize({...raw(),bizAreaSecd:'99'}));assert.throws(()=>normalize({...raw(),bizId:'<script>'}));});
test('robots 허용·차단·HTML 응답·긴 요청 간격',()=>{
  checkRobots('User-agent: *\nDisallow: /bd/\nAllow: /');
  assert.throws(()=>checkRobots('User-agent: *\nDisallow: /pg/'));
  assert.throws(()=>checkRobots('User-agent: *\nDisallow: /*Program*'));
  assert.throws(()=>checkRobots('User-agent: *\nDisallow: /pg/selectPgProgramAjax.do$'));
  assert.throws(()=>checkRobots('User-agent: *\nDisallow: /pg/selectPgProgramAjax.do?pageNumber=2'));
  assert.throws(()=>checkRobots('<html>로그인</html>'));
  assert.throws(()=>checkRobots('User-agent: *\nCrawl-delay: 10'));
});
test('수집기 전체 완료 후에만 기준 확정',fixture(async db=>{
  const res=await collect(db,{wait:async()=>{},fetchText:async path=>path==='/robots.txt'?'User-agent: *\nAllow: /':JSON.stringify({total:1,rows:[raw()]})});
  assert.equal(res.baseline,true);assert.equal(db.prepare('SELECT status FROM runs').get().status,'success');
}));
test('서버 오류 시 기존 데이터 보존, 연속 요청 제한',fixture(async db=>{
  commitSnapshot(db,[normalize(raw())],1);await assert.rejects(collect(db,{wait:async()=>{},fetchText:async()=>{throw Error('HTTP 429');}}),/429/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notices').get().n,1);assert.equal(meta(db,'collectLock'),'');
  await assert.rejects(collect(db),/12시간/);
}));
test('동시 수집 차단',fixture(async db=>{
  setMeta(db,'collectLock',new Date().toISOString());await assert.rejects(collect(db),/이미 수집/);
}));
test('수집 중 목록 변경은 실패로 기록하고 기준 확정하지 않음',fixture(async db=>{
  let n=0;await assert.rejects(collect(db,{wait:async()=>{},fetchText:async p=>p==='/robots.txt'?'User-agent: *\nAllow: /':JSON.stringify({total:1,rows:[raw(String(++n))]})}),/변경/);
  assert.equal(meta(db,'baselineAt'),undefined);assert.equal(db.prepare('SELECT COUNT(*) n FROM notices').get().n,0);
}));
test('실제 API 파라미터 이름과 분야 필터',()=>{const p=new URL(listPath(2,'3'),'https://example.test');assert.equal(p.searchParams.get('pageNumber'),'2');assert.equal(p.searchParams.get('pageSize'),'100');assert.equal(p.searchParams.get('bizAreaSecd'),'3');});
test('robots 다중 User-agent 그룹과 전용 규칙',()=>{
  assert.throws(()=>checkRobots('User-agent: *\nUser-agent: OtherBot\nDisallow: /pg/'));
  assert.throws(()=>checkRobots('User-agent: *\nAllow: /\nUser-agent: SangsaengPersonalMonitor\nDisallow: /pg/'));
  checkRobots('User-agent: OtherBot\nDisallow: /\nUser-agent: *\nDisallow: /bd/');
});
test('100건 다음 페이지를 검증하고 모든 고유 ID를 저장',fixture(async db=>{
  const rows=Array.from({length:101},(_,i)=>raw(String(i+1)));
  await collect(db,{wait:async()=>{},fetchText:async p=>p==='/robots.txt'?'User-agent: *\nAllow: /':JSON.stringify({total:101,rows:p.includes('pageNumber=2&')?rows.slice(100):rows.slice(0,100)})});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notices').get().n,101);
}));
test('페이지 반복 시 부분 결과도 저장하지 않음',fixture(async db=>{
  const rows=Array.from({length:100},(_,i)=>raw(String(i+1)));
  await assert.rejects(collect(db,{wait:async()=>{},fetchText:async p=>p==='/robots.txt'?'User-agent: *\nAllow: /':JSON.stringify({total:200,rows})}),/중복/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notices').get().n,0);
}));
