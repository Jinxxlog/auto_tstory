'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { kindNames, type Asset, type Draft, type Job, type Settings } from '../lib/model';
import { JobCard } from './job-card';
import { EnvironmentPanel } from './environment-panel';
import { BlockEditor } from './block-editor';
import { PhotoAnalysisPanel } from './photo-analysis-panel';
import type { PhotoAnalysisJob } from '../lib/photo-analysis';
import { draftBlocks, withBlocks } from '../lib/blocks';
import { OutlinePanel } from './outline-panel';
import { WritingPanel } from './writing-panel';
import { MaterialPanel } from './material-panel';
import type { Reference } from '../lib/material';
import type { CodeCheck } from '../services/code-check';
import { AiPanel } from './ai-panel';
import { StylePanel, type StyleState } from './style-panel';
import type { AiConnection, AiJob } from '../lib/ai-model';

type State = { photos: PhotoAnalysisJob[]; references: Reference[]; checks: CodeCheck[]; styles: StyleState; ai: { connection: AiConnection; jobs: AiJob[] }; drafts: Draft[]; assets: Asset[]; jobs: Job[]; settings: Settings; workerOnline: boolean };
const emptyDraft = (): Draft => withBlocks({ id: '', version: 0, title: '', kind: 'project', summary: '', markdown: '', category: '', images: [], cover: null, updatedAt: '' }, [{id:'new-text',type:'text',markdown:''}]);
async function api(action: string, values: object = {}) {
  const response = await fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tstory-Request': 'local-web' }, body: JSON.stringify({ action, ...values }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
}
export default function Home() {
  const [state, setState] = useState<State>(); const [tab, setTab] = useState('drafts'); const [draft, setDraft] = useState<Draft>(emptyDraft); const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [html, setHtml] = useState(''); const [blog, setBlog] = useState(''); const [confirmPublish, setConfirmPublish] = useState(false);
  const libraryRef = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => { const response = await fetch('/api/app', { cache: 'no-store' }); if (!response.ok) throw new Error('로컬 앱 연결을 확인하세요.'); setState(await response.json()); }, []);
  useEffect(() => { void refresh().catch(error => setMessage(error.message)); const timer = setInterval(() => void refresh().catch(() => {}), 2500); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { if (state) setBlog(state.settings.blog); }, [state?.settings.blog]);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, [dirty]);
  useEffect(() => { let active = true; const timer = setTimeout(() => { void api('preview', { draft }).then(value => { if (active) setHtml(value.html); }).catch(() => {}); }, 300); return () => { active = false; clearTimeout(timer); }; }, [draft]);
  const edit = (value: Partial<Draft>) => { if (busy) return; setDraft(previous => ({ ...previous, ...value })); setDirty(true); setConfirmPublish(false); };
  async function perform(fn: () => Promise<void>) { setBusy(true); setMessage(''); try { await fn(); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : '작업 실패'); } finally { setBusy(false); } }
  const open = (value: Draft) => { if (busy) return; if (dirty && !window.confirm('저장하지 않은 변경을 버리고 원고를 열까요?')) return; setDraft(withBlocks(value, draftBlocks(value))); setDirty(false); setConfirmPublish(false); setTab('editor'); };
  async function uploadLibrary(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files).filter(file => /\.(png|jpe?g|webp)$/i.test(file.name));
    await perform(async () => {
      if (!selected.length) throw new Error('PNG·JPEG·WebP 사진을 선택하세요.');
      for (const file of selected) {
        const form = new FormData(); form.set('file', file); form.set('library', 'true');
        const response = await fetch('/api/assets', { method: 'POST', headers: { 'X-Tstory-Request': 'local-web' }, body: form }); const asset = await response.json(); if (!response.ok) throw new Error(`${file.name}: ${asset.error}`);
      }
      setMessage(`${selected.length}장의 표지를 가져왔습니다.`);
    });
  }
  const headings: Record<string, string> = { drafts: '나의 원고', editor: draft.id ? '원고 다듬기' : '새로운 이야기', library: '표지 라이브러리', jobs: '작업 내역', settings: '블로그 연결', style: '나의 문체' };
  return <div className="app-shell">
    <aside><a className="brand" href="/">글담<span>TISTORY STUDIO</span></a><div className="workspace-label">MY WORKSPACE</div><nav>{[['drafts','▤','나의 원고'],['style','✎','나의 문체'],['library','▧','표지 라이브러리'],['jobs','◷','작업 내역'],['settings','⚙','블로그 연결']].map(([key, icon, label]) => <button disabled={busy} key={key} className={tab === key || (key === 'drafts' && tab === 'editor') ? 'nav-active' : ''} onClick={() => setTab(key)}><span>{icon}</span>{label}</button>)}</nav><div className="local-card"><span className={`dot ${state?.workerOnline ? 'online' : ''}`} />{state?.workerOnline ? '로컬 실행기 연결됨' : '실행기 연결 대기'}<small>자료는 이 컴퓨터에 저장됩니다.</small></div><div className="phase">PHOTO WRITING</div></aside>
    <main><header><div><div className="eyebrow">WRITE SOMETHING WORTH SHARING</div><h1>{headings[tab]}</h1></div><span className="private-badge">● 비공개 저장 모드</span></header>
      {message && <div className="notice" role="status">{message}<button aria-label="알림 닫기" onClick={() => setMessage('')}>×</button></div>}
      {!state ? <div className="panel">작업 공간을 불러오는 중…</div> : <>
        {!state.settings.blog && <div className="notice onboarding"><div><strong>내 블로그 주소를 설정해주세요.</strong><p>로그인 없이도 원고를 먼저 작성하고 저장할 수 있습니다.</p></div><button onClick={() => setTab('settings')}>내 블로그 설정</button></div>}
        {tab === 'drafts' && <><div className="hero"><div className="eyebrow">YOUR NEXT STORY STARTS HERE</div><h2>기록을 모으고,<br />하나의 글로 완성하세요.</h2><p>프로젝트의 과정부터 작은 배움까지.<br />사진과 생각을 모아 나만의 티스토리 원고를 준비해보세요.</p><button className="primary" onClick={() => open(emptyDraft())}>＋ 새 원고 작성</button><div className="hero-decoration" aria-hidden="true">Aa<span>생각을 담는 공간</span></div></div><div className="section-heading"><h2>저장한 원고 <span>{state.drafts.length}</span></h2><p>AI 초안 · Markdown 편집</p></div>{!state.drafts.length ? <div className="empty"><span>✎</span><h3>첫 번째 원고를 기다리고 있어요</h3><p>제목과 본문을 쓰고 사진을 더해보세요.</p></div> : <div className="draft-grid">{state.drafts.map(item => <button className="draft-card" key={item.id} onClick={() => open(item)}>{item.cover ? <img src={`/api/assets/${item.cover}?size=thumb`} alt="원고 표지" /> : <div className="cover-placeholder">{item.kind === 'ps' ? '{ }' : 'Aa'}</div>}<div><small>{kindNames[item.kind]} · {item.category || '카테고리 미지정'}</small><h3>{item.title || '제목 없는 원고'}</h3><p>{item.summary || item.markdown.slice(0, 100) || '아직 작성한 내용이 없습니다.'}</p><span>v{item.version} · {new Date(item.updatedAt).toLocaleDateString('ko-KR')}</span></div></button>)}</div>}</>}
        {tab === 'editor' && <><div className="editor-toolbar"><span>{dirty ? '● 저장하지 않은 변경' : draft.id ? `저장됨 · 버전 ${draft.version}` : '새 원고'} </span><div><button disabled={busy} onClick={() => void perform(async () => { const saved = await api('save', { draft }); setDraft(saved); setDirty(false); setMessage('원고를 저장했습니다.'); })}>원고 저장</button><button className="primary" disabled={busy || dirty || !draft.id || !state.workerOnline} onClick={() => setConfirmPublish(true)}>비공개 전송</button></div></div>
          {confirmPublish && <div className="publish-review"><h3>이 원고를 비공개로 저장할까요?</h3><p>티스토리 · 사진/표/코드 지원 · 공개 발행 미지원<br/>사진 작성 메모와 묶음은 전송하지 않습니다.</p><p>{draft.title} · 버전 {draft.version}<br />{state.settings.blog} → {draft.category} · 사진 {draft.images.length}장</p><button className="primary" disabled={busy} onClick={() => void perform(async () => { await api('publish', { id: draft.id }); setConfirmPublish(false); setTab('jobs'); })}>확인하고 전송</button><button onClick={() => setConfirmPublish(false)}>돌아가기</button></div>}
          <section className="panel"><div className="field-row"><label>글 유형<select aria-label="글 유형" value={draft.kind} onChange={event => edit({ kind: event.target.value as Draft['kind'], styleProfileId: undefined })}>{Object.entries(kindNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label>카테고리<select aria-label="카테고리" value={draft.category} onChange={event => edit({ category: event.target.value })}><option value={draft.category}>{draft.category || '선택하세요'}</option>{state.settings.categories.filter(c => c !== draft.category).map(category => <option key={category}>{category}</option>)}</select></label></div><label>제목<input maxLength={150} placeholder="어떤 이야기를 기록할까요?" value={draft.title} onChange={event => edit({ title: event.target.value })} /></label><label>요약 · 작성 메모<textarea rows={3} placeholder="이 글에 꼭 담고 싶은 이야기와 메모를 적어주세요." value={draft.summary} onChange={event => edit({ summary: event.target.value })} /></label><p className="help">요약과 사진 작성 메모는 게시되지 않습니다. 본문·사진의 순서는 아래에서 편집하세요.</p></section>
          <WritingPanel draft={draft} disabled={busy} edit={edit} />
          <MaterialPanel key={draft.id} draft={draft} references={state.references || []} checks={state.checks || []} disabled={busy} dirty={dirty} online={state.workerOnline} edit={edit} request={api} refresh={refresh} />
          <OutlinePanel draft={draft} disabled={busy} change={value => edit(value)} />
          <AiPanel edit={edit} defaults={state.styles.defaults || {}} profiles={state.styles.profiles} lock={setBusy} draft={draft} dirty={dirty || busy} online={state.workerOnline} connection={state.ai.connection} jobs={state.ai.jobs} request={api} refresh={refresh} applied={value => { setDraft(value); setDirty(false); setConfirmPublish(false); }} />
          <div className="editor-columns"><section className="panel"><BlockEditor key={draft.id || "new"} draft={draft} assets={state.assets} disabled={busy} refresh={refresh} lock={setBusy} change={value => { setDraft(value); setDirty(true); setConfirmPublish(false); }} /></section>
          <section className="panel preview-panel"><div className="section-heading"><h2>미리보기</h2><span className="tag">비공개</span></div><h2 className="preview-title">{draft.title || '제목이 여기에 표시됩니다'}</h2><article dangerouslySetInnerHTML={{ __html: html }} /><p className="help">사진·캡션·긴 설명은 블록 순서대로 게시됩니다. 블로그 스킨에 따라 표시가 달라질 수 있습니다.</p></section></div>
          <PhotoAnalysisPanel draft={draft} dirty={dirty || busy} online={state.workerOnline} connection={state.ai.connection} jobs={state.photos || []} request={api} refresh={refresh} lock={setBusy} applied={value => { setDraft(value); setDirty(false); }} /></>}
        {tab === 'style' && <StylePanel data={state.styles} connection={state.ai.connection} online={state.workerOnline} drafts={state.drafts} request={api} refresh={refresh} />}
        {tab === 'library' && <><div className="section-heading"><p>여러 글에서 다시 사용할 표지 사진을 모아두세요.</p><button className="primary" disabled={busy} onClick={() => libraryRef.current?.click()}>＋ 표지 추가</button></div><input ref={libraryRef} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={event => { void uploadLibrary(event.target.files); event.target.value = ''; }} /><div className="draft-grid">{state.assets.filter(a => a.library).map(a => <div className="draft-card" key={a.id}><img src={`/api/assets/${a.id}?size=thumb`} alt={a.name} /><div><h3>{a.name}</h3><p>{Math.round(a.size / 1024)} KB · 원고 사진에서 선택할 수 있어요</p></div></div>)}</div>{!state.assets.some(a => a.library) && <div className="empty"><span>▧</span><h3>자주 쓰는 표지를 한곳에</h3><p>표지를 추가하면 원고마다 다시 업로드할 필요가 없어요.</p></div>}</>}
        {tab === 'settings' && <><section className="panel settings"><h2>티스토리 계정 연결</h2><p className="help">지원: 본문 사이 사진·표·코드·비공개 저장. 네이버 제품 연결·공개 발행은 아직 지원하지 않습니다.</p><p>전용 Chrome에서 직접 로그인하면 이 컴퓨터에서 연결을 재사용합니다.</p><label>블로그 주소<input value={blog} onChange={event => setBlog(event.target.value)} placeholder="https://my-blog.tistory.com" /></label><div className="button-row"><button disabled={busy || !blog.trim() || blog === state.settings.blog} onClick={() => void perform(async () => { await api('settings', { blog }); setMessage('블로그 주소를 저장했습니다.'); })}>주소 저장</button><button className="primary" disabled={busy || !state.workerOnline || !state.settings.blog || blog !== state.settings.blog} onClick={() => void perform(async () => { const job = await api('connect'); if (job.state === 'needs_login') await api('resume', { id: job.id }); setTab('jobs'); })}>로그인 확인 · 카테고리 새로고침</button></div><dl><dt>연결 상태</dt><dd>{state.settings.connection}</dd><dt>마지막 확인</dt><dd>{state.settings.checkedAt ? new Date(state.settings.checkedAt).toLocaleString('ko-KR') : '아직 확인하지 않았습니다'}</dd><dt>카테고리</dt><dd>{state.settings.categories.join(' · ') || '연결 후 불러옵니다'}</dd></dl><p className="help">로그인이 필요하면 열린 Chrome에서 로그인한 뒤 작업 내역의 ‘재개’를 눌러주세요. 비밀번호는 앱에 입력하지 않습니다.</p></section><EnvironmentPanel request={api} /></>}
        {tab === 'jobs' && <><p className="intro">브라우저 작업의 진행 상태와 저장 결과를 확인하세요.</p>{!state.workerOnline && <div className="notice">실행기가 꺼져 있습니다. 설치 폴더의 Start.cmd로 웹앱과 실행기를 함께 시작하세요.</div>}{!state.jobs.length && <div className="empty"><span>◷</span><h3>아직 실행한 작업이 없어요</h3><p>블로그를 연결하거나 원고를 비공개로 전송하면 여기에 표시됩니다.</p></div>}{state.jobs.map(job => <JobCard key={job.id} job={job} busy={busy} online={state.workerOnline} request={(action, values) => perform(async () => { await api(action, values); })} />)}</>}
      </>}
      <footer>글담 <span>당신의 기록이 다음 이야기의 시작이 되도록.</span></footer>
    </main>
  </div>;
}
