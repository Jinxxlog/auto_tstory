import { randomUUID } from 'node:crypto';
import type { openStore } from './store';
import type { AiConnection, AiJob, AiOutput } from './ai-model';
import { parseOutput } from '../services/ai/content';
import { styleStore } from './style-store';
import { snapshot } from '../services/style/content';
import { referenceStore } from '../services/references';

export function aiStore(store: ReturnType<typeof openStore>) {
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS ai_settings (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    INSERT OR IGNORE INTO migrations VALUES (2);`);
  const connection = (): AiConnection => { const row = db.prepare('SELECT body FROM ai_settings WHERE id=1').get(); return row ? JSON.parse(String(row.body)) : { state: 'disconnected', message: 'ChatGPT 계정을 연결하세요.', models: [] }; };
  const setConnection = (value: AiConnection) => db.prepare('INSERT OR REPLACE INTO ai_settings VALUES (1,?)').run(JSON.stringify(value));
  const jobs = (): AiJob[] => db.prepare('SELECT body FROM ai_jobs ORDER BY rowid DESC').all().map(r => JSON.parse(String(r.body)));
  const job = (id: string): AiJob => { const row = db.prepare('SELECT body FROM ai_jobs WHERE id=?').get(id); if (!row) throw new Error('생성 작업을 찾을 수 없습니다.'); return JSON.parse(String(row.body)); };
  const put = (value: AiJob) => db.prepare('INSERT OR REPLACE INTO ai_jobs VALUES (?,?)').run(value.id, JSON.stringify(value));
  function tx<T>(fn: () => T) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  return { connection, setConnection, jobs, job, put,
    connect() { if (jobs().some(j => j.state === 'running')) throw new Error('생성을 마치거나 취소한 뒤 연결하세요.'); setConnection({ state: 'connecting', message: 'ChatGPT 연결 확인 중', models: [] }); },
    enqueue(id: string, model: string, selection: string, instruction: string, profileId = '') { const styles=styleStore(store); const refs=referenceStore(store); return tx(() => {
      const draft = store.draft(id); const status = connection(); const selected = status.models.find(m => m.id === model);
      if (status.state !== 'connected' || !selected) throw new Error('ChatGPT를 연결하고 사용 가능한 모델을 선택하세요.');
      if (draft.kind === 'project' && draft.summary.trim().length < 20) throw new Error('실제 구현 내용과 배경을 요약에 20자 이상 적어주세요.');
      if (draft.kind === 'technical' && (!draft.material?.topic.trim() || draft.summary.trim().length < 20)) throw new Error('기술 주제와 설명 범위(요약 20자 이상)를 입력하세요.');
      if (draft.kind === 'ps' && (!draft.material || draft.material.problem.trim().length < 20 || !draft.material.constraints.trim() || !draft.material.language.trim())) throw new Error('문제 본문(20자 이상)·제약 조건·언어를 입력하세요. URL을 가져온 경우에도 문제 조건을 확인해 입력하세요.');
      const references = (draft.material?.referenceIds || []).map(refs.get);
      if (draft.images.length && !selected.images) throw new Error('사진 입력을 지원하는 모델을 선택하세요.');
      if (selection.length > 20000 || instruction.length > 4000 || (selection && (!instruction.trim() || draft.markdown.split(selection).length !== 2))) throw new Error('부분 재작성 구간은 본문에서 한 번만 등장해야 하며 수정 요청이 필요합니다.');
      const existing = jobs().find(j => j.draft.id === id && ['queued','running'].includes(j.state)); if (existing) return existing;
      const profile=profileId?styles.profiles().find(p=>p.id===profileId):undefined;if(profileId&&!profile)throw new Error('선택한 문체가 없습니다.');
      const value: AiJob = { id: randomUUID(), state: 'queued', step: '생성 대기', draft, model, selection, instruction, references, ...(profile?{style:snapshot(profile,draft.kind)}:{}), attempts: 0, cancel: false, createdAt: new Date().toISOString() }; put(value); return value;
    }); },
    cancel(id: string) { const value = job(id); if (!['queued','running'].includes(value.state)) throw new Error('진행 중인 생성만 취소할 수 있습니다.'); put({ ...value, cancel: true, ...(value.state === 'queued' ? { state: 'cancelled' as const, step: '취소됨' } : { step: '취소 요청 중' }) }); },
    retry(id: string) { return tx(() => { const value = job(id); if (value.state !== 'failed' || value.attempts >= 2) throw new Error('재시도는 실패한 작업당 한 번만 가능합니다.'); if (jobs().some(j => j.draft.id === value.draft.id && ['queued','running'].includes(j.state))) throw new Error('이 원고의 다른 생성을 먼저 마치세요.'); put({ ...value, state: 'queued', cancel: false, step: '재시도 대기' }); }); },
    finish(id: string, output: AiOutput, usage?: AiJob['usage']) { const value = job(id); if (value.state !== 'running') return; if (value.cancel) { put({ ...value, state: 'cancelled', step: '취소됨 · 생성 결과는 적용하지 않았습니다.', usage }); return; } put({ ...value, output, usage, state: 'succeeded', step: '생성 완료 · 검토 후 원고에 적용하세요.' }); },
    apply(id: string) { return tx(() => {
      const value = job(id); if (value.state !== 'succeeded' || !value.output || value.appliedVersion) throw new Error('적용 가능한 생성 결과가 없습니다.');
      const current = store.draft(value.draft.id); if (current.version !== value.draft.version) throw new Error('생성 후 원고가 수정되었습니다. 결과를 복사하거나 최신 원고로 다시 생성하세요.');
      // Validate persisted output without applying the selection replacement a second time.
      const output = parseOutput(JSON.stringify(value.output), { ...value, selection: '' });
      const saved = { ...current, title: output.title, markdown: output.markdown, images: current.images.map(i => ({ ...i, caption: output.captions.find(c => c.id === i.id)!.caption })), version: current.version+1, updatedAt: new Date().toISOString() };
      db.prepare('INSERT OR IGNORE INTO draft_versions VALUES (?,?,?)').run(current.id, current.version, JSON.stringify(current));
      db.prepare('UPDATE documents SET body=? WHERE id=?').run(JSON.stringify(saved), saved.id);
      db.prepare('INSERT INTO draft_versions VALUES (?,?,?)').run(saved.id, saved.version, JSON.stringify(saved));
      put({ ...value, appliedVersion: saved.version }); return saved;
    }); },
    recover() { for (const value of jobs().filter(j => j.state === 'running')) put({ ...value, state: value.cancel ? 'cancelled' : 'failed', step: '실행기가 중단되었습니다. 자동으로 다시 생성하지 않습니다.' }); const current = connection(); if (['login','connecting'].includes(current.state)) setConnection({ state: 'disconnected', models: [], message: '연결 확인을 다시 눌러주세요.' }); },
  };
}
