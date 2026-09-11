import { randomUUID } from 'node:crypto';
import type { openStore } from './store';
import type { StyleSource,StyleJob,StyleProfile,StyleKind,StyleRules } from './style-model';
import { parseStyle } from '../services/style/content';
const kinds=['common','project','technical','ps'];
export function styleStore(store: ReturnType<typeof openStore>) {
  const db=store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS style_sources (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS style_jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS style_profiles (id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(id,version));
    INSERT OR IGNORE INTO migrations VALUES (3);`);
  const sources=():StyleSource[]=>db.prepare('SELECT body FROM style_sources ORDER BY rowid DESC').all().map(r=>JSON.parse(String(r.body)));
  const jobs=():StyleJob[]=>db.prepare('SELECT body FROM style_jobs ORDER BY rowid DESC').all().map(r=>JSON.parse(String(r.body)));
  const profiles=():StyleProfile[]=>db.prepare('SELECT body FROM style_profiles p WHERE version=(SELECT MAX(version) FROM style_profiles q WHERE q.id=p.id) ORDER BY rowid DESC').all().map(r=>JSON.parse(String(r.body)));
  const job=(id:string)=>{const value=jobs().find(j=>j.id===id);if(!value)throw new Error('문체 분석 작업이 없습니다.');return value;};
  const put=(value:StyleJob)=>db.prepare('INSERT OR REPLACE INTO style_jobs VALUES (?,?)').run(value.id,JSON.stringify(value));
  function tx<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}
  return {sources,jobs,profiles,job,put,
    saveSource(input:unknown) { const v=input as StyleSource;if(!v || typeof v.title!=='string'||!v.title.trim()||v.title.length>200||typeof v.body!=='string'||v.body.trim().length<80||v.body.length>50000||!kinds.includes(v.kind)||typeof v.url!=='string'||v.url.length>3000)throw new Error('대표 글 제목·유형·본문(80~50,000자)을 확인하세요.');
      if(v.url){const u=new URL(v.url);if(u.protocol!=='https:'||u.username||u.password)throw new Error('출처는 HTTPS 주소만 지원합니다.');}
      if(v.id&&!sources().some(s=>s.id===v.id))throw new Error('수정할 대표 글이 없습니다.');
      const value:StyleSource={id:v.id||randomUUID(),title:v.title.trim(),body:v.body.trim(),url:v.url,kind:v.kind,origin:['url','draft'].includes(v.origin)?v.origin:'manual',createdAt:new Date().toISOString()};db.prepare('INSERT OR REPLACE INTO style_sources VALUES (?,?)').run(value.id,JSON.stringify(value));return value;
    },
    removeSource(id:string){db.prepare('DELETE FROM style_sources WHERE id=?').run(id);},
    enqueue(ids:unknown, model:string,name:string,kind:StyleKind){return tx(()=>{
      if(!Array.isArray(ids)||ids.length<1||ids.length>20||new Set(ids).size!==ids.length||typeof name!=='string'||!name.trim()||name.length>100||!kinds.includes(kind))throw new Error('대표 글 1~20개, 문체 이름과 유형을 확인하세요.');
      if(jobs().some(j=>['queued','running'].includes(j.state)))throw new Error('진행 중인 문체 분석을 먼저 마치세요.');
      const selected=ids.map(id=>sources().find(s=>s.id===id));if(selected.some(s=>!s))throw new Error('선택한 대표 글이 없습니다.');
      const value:StyleJob={id:randomUUID(),state:'queued',step:'문체 분석 대기',name:name.trim(),kind,model,sources:selected as StyleSource[],attempts:0,cancel:false,createdAt:new Date().toISOString()};put(value);return value;
    });},
    cancel(id:string){const v=job(id);if(!['queued','running'].includes(v.state))throw new Error('진행 중인 분석만 취소할 수 있습니다.');put({...v,cancel:true,...(v.state==='queued'?{state:'cancelled' as const,step:'취소됨'}:{step:'취소 요청 중'})});},
    retry(id:string){return tx(()=>{const v=job(id);if(v.state!=='failed'||v.attempts>=2)throw new Error('실패한 분석은 한 번만 재시도할 수 있습니다.');if(jobs().some(j=>['queued','running'].includes(j.state)))throw new Error('다른 분석을 먼저 마치세요.');put({...v,state:'queued',cancel:false,step:'재시도 대기'});});},
    finish(id:string,output:StyleRules,usage?:StyleJob['usage']){const v=job(id);if(v.state!=='running')return;put({...v,state:v.cancel?'cancelled':'succeeded',step:v.cancel?'취소됨':'분석 완료 · 규칙을 검토하고 확정하세요.',...(v.cancel?{}:{output}),usage});},
    saveProfile(input:unknown){return tx(()=>{const v=input as {id?:string;version:number;jobId?:string;name:string;kind:StyleKind;rules:string};
      if(!v||typeof v.name!=='string'||!v.name.trim()||v.name.length>100||!kinds.includes(v.kind)||!Number.isSafeInteger(v.version))throw new Error('문체 이름과 버전을 확인하세요.');
      const old=v.id?profiles().find(p=>p.id===v.id):undefined;const analysis=v.jobId?job(v.jobId):undefined;
      if(v.id&&(!old||old.version!==v.version))throw new Error('문체가 변경되었습니다. 최신 버전을 다시 여세요.');
      if(!old&&(!analysis?.output||analysis.state!=='succeeded'||v.version!==0))throw new Error('완료된 분석 결과가 필요합니다.');
      const rules=parseStyle(JSON.stringify({...((old||analysis!.output) as StyleRules),rules:v.rules}));
      const value:StyleProfile={...rules,id:old?.id||randomUUID(),version:(old?.version||0)+1,name:v.name.trim(),kind:v.kind,sources:old?.sources||analysis!.sources,createdAt:new Date().toISOString()};db.prepare('INSERT INTO style_profiles VALUES (?,?,?)').run(value.id,value.version,JSON.stringify(value));return value;
    });},
    history(id:string):StyleProfile[]{return db.prepare('SELECT body FROM style_profiles WHERE id=? ORDER BY version DESC').all(id).map(r=>JSON.parse(String(r.body)));},
    recover(){for(const v of jobs().filter(j=>j.state==='running'))put({...v,state:v.cancel?'cancelled':'failed',step:'실행기 중단 · 자동 재분석하지 않습니다.'});},
  };
}
