'use client';
import { useState } from 'react';
import { jobLabels, type Job } from '../lib/model';

export function JobCard({ job, busy, online, request }: {
  job: Job; busy: boolean; online: boolean;
  request: (action: string, values: object) => Promise<void>;
}) {
  const [url, setUrl] = useState(job.snapshot.candidatePostUrl || '');
  const [confirmed, setConfirmed] = useState(false);
  const knownUrl = job.snapshot.postUrl || job.result;
  const recoverable = !!job.snapshot.draft && ['unknown', 'needs_attention', 'needs_login', 'failed'].includes(job.state);
  const canVerify = !!knownUrl && (recoverable || job.state === 'succeeded');
  const canCancel = job.kind !== 'verify' && !knownUrl && !job.snapshot.candidatePostUrl && ['queued', 'needs_login', 'failed'].includes(job.state);
  return <section className="panel job" aria-label={job.snapshot.draft?.title || '블로그 연결 작업'}>
    <div className="job-details">
      <span className={`state state-${job.state}`}>{jobLabels[job.state] || job.state}</span>
      <small>{new Date(job.createdAt).toLocaleString('ko-KR')}</small>
      <h3>{job.kind === 'connect' ? '블로그 연결 · 카테고리 새로고침' : job.snapshot.draft?.title}</h3>
      <p>{job.step}</p>
      {job.snapshot.draft && <small>{job.snapshot.draft.category} · 버전 {job.snapshot.draft.version} · 비공개</small>}
      {knownUrl && /^https:\/\/[a-z0-9-]+\.tistory\.com\//.test(knownUrl) && <a href={knownUrl} target="_blank" rel="noreferrer">저장된 글 보기 ↗</a>}
      {recoverable && <p><a href={`${job.snapshot.blog}/manage/posts`} target="_blank" rel="noreferrer">티스토리 글 관리</a>에서 전송 당시 제목·본문·카테고리를 확인하세요. 재확인은 기존 글만 읽으며 새 글을 만들지 않습니다.</p>}
      {recoverable && !knownUrl && <div className="job-recovery">
        <label>확인할 기존 글 주소<input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder={`${job.snapshot.blog}/123`} disabled={busy} /></label>
        <p className="help">관리·편집 화면 주소 대신 저장된 글 주소를 입력하세요. 원고와 비공개 설정이 일치해야 연결됩니다.</p>
        <button disabled={busy || !online || !url.trim()} onClick={() => void request('verify', { id: job.id, url: url.trim() })}>기존 글 연결 · 확인</button>
        <details>
          <summary>관리 목록에 글이 없나요?</summary>
          <p>다른 페이지와 검색 결과까지 확인하세요. 미발행 확인은 사용자의 판단으로 기록하며, 작업 종료만으로 재전송하지 않습니다.</p>
          <label className="recovery-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} />글 관리에서 이 원고가 게시되지 않았음을 확인했습니다.</label>
          <button disabled={busy || !confirmed} onClick={() => void request('resolve-unpublished', { id: job.id, confirmed: true })}>미발행 확인 · 작업 종료</button>
        </details>
      </div>}
      {job.snapshot.unpublishedConfirmedAt && <p className="help">미발행 확인은 사용자 판단으로 기록되었습니다. 다시 전송하려면 원고를 저장해 새 버전을 만든 뒤 별도로 전송하세요.</p>}
    </div>
    <div className="job-actions">
      {canVerify && <button disabled={busy || !online} onClick={() => void request('verify', { id: job.id })}>저장 결과 다시 확인</button>}
      {!canVerify && ['needs_login', 'failed'].includes(job.state) && !(job.kind === 'verify' && !job.snapshot.candidatePostUrl) && <button disabled={busy || !online} onClick={() => void request('resume', { id: job.id })}>{job.state === 'needs_login' ? '로그인 완료 · 재개' : '재시도'}</button>}
      {canCancel && <button disabled={busy} onClick={() => void request('cancel', { id: job.id })}>취소</button>}
    </div>
  </section>;
}
