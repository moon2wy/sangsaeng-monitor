import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export const CATEGORIES = {'3':'교육','1':'금융','2':'인력','4':'창업','5':'특허','6':'판로','7':'기타','8':'기술','9':'컨설팅','10':'네트워킹'};
export const ORIGIN='https://www.winwinnuri.or.kr';
export function openDB(path) {
  mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notices(id TEXT PRIMARY KEY,data TEXT NOT NULL,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,baseline INTEGER NOT NULL,read INTEGER NOT NULL DEFAULT 0,favorite INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY,started TEXT,finished TEXT,status TEXT,message TEXT,count INTEGER);`);
  return db;
}
export function meta(db,key){return db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;}
export function setMeta(db,key,value){db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));}
export function normalize(r){
  if(!/^\d+$/.test(r.prgId)||!/^\d+$/.test(r.bizId)||typeof r.bizNm!=='string'||!r.bizNm.trim()||!CATEGORIES[r.bizAreaSecd])throw Error('목록 응답 형식 또는 지원분야가 변경되었습니다.');
  const str=v=>typeof v==='string'?v:'';
  return {id:`${r.prgId}:${r.bizId}`,prgId:r.prgId,bizId:r.bizId,title:r.bizNm,category:CATEGORIES[r.bizAreaSecd],categoryCode:r.bizAreaSecd,organization:str(r.membrCorpNm),region:str(r.bizArea),target:str(r.supoTrgtSecdNm),applyStart:str(r.notiStYmd),applyEnd:str(r.notiEdYmd),supportStart:str(r.bizStYmd),supportEnd:str(r.bizEdYmd),applyStatus:str(r.applyStepNm),progress:str(r.progStepCodNm),registered:str(r.fstRegDt),url:`${ORIGIN}/pg/businessView.do?pageNumber=1&prgIdH=${r.prgId}&bizIdH=${r.bizId}&returnUrl=%2Fpg%2FselectPgSearchList.do`};
}
export function commitSnapshot(db,rows,expected,now=new Date().toISOString()){
  const unique=new Map(rows.map(r=>[r.id,r]));
  if(!expected||unique.size!==expected)throw Error(`수집 불완전: 고유 ${unique.size} / 원본 ${expected}. 기존 데이터 유지`);
  const baseline=!meta(db,'baselineAt');let added=0;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('UPDATE notices SET active=0');
    const has=db.prepare('SELECT id FROM notices WHERE id=?');
    const up=db.prepare(`INSERT INTO notices(id,data,first_seen,last_seen,baseline) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,last_seen=excluded.last_seen,active=1`);
    for(const r of unique.values()){if(!has.get(r.id))added++;up.run(r.id,JSON.stringify(r),now,now,baseline?1:0);}
    if(baseline)setMeta(db,'baselineAt',now);
    setMeta(db,'lastSuccess',now);setMeta(db,'sourceTotal',expected);setMeta(db,'lastAdded',baseline?0:added);
    db.exec('COMMIT');return {baseline,added:baseline?0:added,count:unique.size};
  } catch(e){db.exec('ROLLBACK');throw e;}
}
