'use client';
import { useState } from 'react';
import type { Draft } from '../lib/model';
import type { AiConnection } from '../lib/ai-model';
import type { PhotoAnalysisJob } from '../lib/photo-analysis';
import { imageBlocks } from '../lib/blocks';
type Props = { draft: Draft; dirty: boolean; online: boolean; connection: AiConnection; jobs: PhotoAnalysisJob[]; request: (action: string, values?: object) => Promise<any>; refresh: () => Promise<void>; lock: (busy: boolean) => void; applied: (draft: Draft) => void };
export function PhotoAnalysisPanel({ draft, dirty, online, connection, jobs, request, refresh, lock, applied }: Props) {
  const [selected, setSelected] = useState<string[]>([]); const [model, setModel] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const photos = imageBlocks(draft); const ids = selected.filter(id => photos.some(photo => photo.imageId === id && !photo.locked)); const models = connection.models.filter(model => model.images); const modelId = models.find(item => item.id === model)?.id || models[0]?.id || '';
  const own = jobs.filter(job => job.draftId === draft.id); const active = own.some(job => ['queued','running'].includes(job.state));
  async function run(action: string, values: object) { setBusy(true); lock(true); setMessage(''); try { const value = await request(action, values); if (action === 'photo-apply') applied(value); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : '사진 분석 요청 실패'); } finally { setBusy(false); lock(false); } }
  if (!photos.length) return null;
  return <section className="panel photo-analysis"><details><summary>선택 사진 분석 · 한 번에 최대 10장</summary><p>장소·날짜 묶음 또는 개별 사진을 선택하세요. 선택 사진과 작성 메모를 ChatGPT에 전달합니다. 이미지 내용·모델·메모·묶음이 같으면 기존 분석을 재사용합니다. 실제 경험과 사실은 직접 검토하세요.</p>
    <label>사진 분석 모델<select value={modelId} onChange={event => setModel(event.target.value)}>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
    <div className="button-row">{Array.from(new Set(photos.map(photo => photo.group))).filter(Boolean).map(group => <button key={group} onClick={() => setSelected(photos.filter(photo => photo.group === group && !photo.locked).slice(0, 10).map(photo => photo.imageId))}>{group} · 앞 10장 선택</button>)}</div>
    <div className="photo-selection">{photos.map((photo, index) => <label key={photo.id}><input type="checkbox" checked={ids.includes(photo.imageId)} disabled={photo.locked || (!ids.includes(photo.imageId) && ids.length >= 10)} onChange={event => setSelected(event.target.checked ? [...ids, photo.imageId] : ids.filter(id => id !== photo.imageId))}/>{index + 1}. {photo.caption || '사진'}{photo.locked && ' · AI 잠금'}{photo.group && ` · ${photo.group}`}</label>)}</div>
    <button disabled={busy || dirty || !online || !draft.id || !ids.length || !modelId || active || connection.state !== 'connected'} onClick={() => void run('photo-analyze', { id: draft.id, model: modelId, ids })}>선택 {ids.length}장 분석</button><p className="help">저장 후 분석할 수 있습니다. 전체 원고 업로드 상한은 50장, 한 번의 AI 요청은 10장입니다. 결과는 자동 적용·발행하지 않습니다.</p>
    {message && <p role="status">{message}</p>}{own.map(job => <div className="ai-result" key={job.id}><p>{job.message} · 원고 v{job.version} · 재사용 {job.cached}장</p>{job.usage && <small>사용량 {job.usage.total} 토큰</small>}{job.results.map(result => <div key={result.id}><strong>{result.caption}</strong><p>{result.description}</p>{result.uncertainty && <p>확인할 내용: {result.uncertainty}</p>}</div>)}{job.state === 'succeeded' && <button disabled={busy || dirty || !!job.appliedVersion || draft.version !== job.version} onClick={() => void run('photo-apply', { id: job.id })}>{job.appliedVersion ? `v${job.appliedVersion}에 적용됨` : '검토한 캡션·긴 설명 적용'}</button>}{['queued','running'].includes(job.state) && <button disabled={busy || job.cancel} onClick={() => void run('photo-cancel', { id: job.id })}>사진 분석 취소</button>}</div>)}
  </details></section>;
}
