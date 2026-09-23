'use client';
import { useRef, useState } from 'react';
import type { Asset, Draft, DraftBlock, ImageBlock } from '../lib/model';
import { draftBlocks, withBlocks, maxDraftImages } from '../lib/blocks';

type Props = { draft: Draft; assets: Asset[]; disabled: boolean; change: (draft: Draft) => void; refresh: () => Promise<void>; lock: (busy: boolean) => void };
export function BlockEditor({ draft, assets, disabled, change, refresh, lock }: Props) {
  const current = useRef(draft); current.current = draft;
  const [progress, setProgress] = useState(''); const [failed, setFailed] = useState<{ file: File; replace?: string; error: string }[]>([]);
  const [dragged, setDragged] = useState(''); const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null); const folderRef = useRef<HTMLInputElement>(null); const replaceRef = useRef<HTMLInputElement>(null); const replaceId = useRef('');
  const blocks = draftBlocks(draft);
  const commit = (next: DraftBlock[], cover = current.current.cover) => { const value = withBlocks({ ...current.current, cover }, next); current.current = value; change(value); };
  const update = (id: string, patch: Partial<DraftBlock>) => commit(draftBlocks(current.current).map(block => block.id === id ? { ...block, ...patch } as DraftBlock : block));
  const addText = (after?: string) => { const next = [...draftBlocks(current.current)]; next.splice(after ? next.findIndex(block => block.id === after) + 1 : next.length, 0, { id: crypto.randomUUID(), type: 'text', markdown: '' }); commit(next); };
  const move = (from: number, to: number) => { if (disabled || from < 0 || from === to || to < 0 || to >= blocks.length) return; const next = [...blocks]; next.splice(to, 0, next.splice(from, 1)[0]); commit(next); };
  async function upload(files: File[], replace?: string) {
    if (uploading) return;
    setUploading(true); lock(true); setFailed(previous => previous.filter(item => !files.includes(item.file)));
    try {
      for (const [index, file] of files.entries()) {
        try {
          if (!replace && current.current.images.length >= maxDraftImages) throw new Error('사진은 최대 50장입니다.');
          if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > 10 * 1024 * 1024) throw new Error('10MB 이하 PNG·JPEG·WebP 사진을 선택하세요.');
          const asset = await new Promise<Asset>((resolve, reject) => {
            const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/assets'); xhr.setRequestHeader('X-Tstory-Request', 'local-web'); xhr.timeout = 60000;
            xhr.upload.onprogress = event => setProgress(`${index + 1}/${files.length} · ${file.name} · ${event.lengthComputable ? Math.round(event.loaded / event.total * 100) : 0}%`);
            xhr.onerror = xhr.ontimeout = () => reject(new Error('전송 연결을 확인하고 재시도하세요.'));
            xhr.onload = () => { try { const value = JSON.parse(xhr.responseText); xhr.status === 200 ? resolve(value) : reject(new Error(value.error)); } catch { reject(new Error('사진 응답을 확인하지 못했습니다.')); } };
            const form = new FormData(); form.set('file', file); form.set('library', 'false'); xhr.send(form);
          });
          const next = [...draftBlocks(current.current)]; let cover = current.current.cover;
          if (replace) {
            const position = next.findIndex(block => block.id === replace && block.type === 'image'); if (position < 0) throw new Error('교체할 사진 블록이 없습니다.');
            const previous = next[position] as ImageBlock; next[position] = { ...previous, imageId: asset.id };
            if (cover === previous.imageId) cover = asset.id;
          } else { next.push({ id: crypto.randomUUID(), type: 'image', imageId: asset.id, note: '', caption: '', description: '', group: '' }); cover ||= asset.id; }
          commit(next, cover);
        } catch (error) { setFailed(previous => [...previous, { file, replace, error: error instanceof Error ? error.message : '사진 추가 실패' }]); }
        setProgress(`${index + 1}/${files.length} 처리 완료`);
      }
      await refresh();
    } finally { setUploading(false); lock(false); }
  }
  return <section className="panel block-editor"><div className="section-heading"><h2>본문과 사진 <small>{draft.images.length}/50장</small></h2><div className="button-row"><button disabled={disabled} onClick={() => addText()}>본문 블록 추가</button><button disabled={disabled} onClick={() => fileRef.current?.click()}>사진 선택</button><button disabled={disabled} onClick={() => folderRef.current?.click()}>폴더 가져오기</button></div></div>
    <p className="help">본문 블록은 소제목·인용·목록·코드·표를 Markdown으로 작성합니다. 사진과 본문을 끌거나 위/아래 버튼으로 배치하세요. 작성 메모와 묶음은 게시되지 않습니다.</p>
    <input ref={fileRef} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={event => { void upload(Array.from(event.target.files || [])); event.target.value = ''; }}/>
    <input ref={folderRef} hidden type="file" multiple {...{ webkitdirectory: '' }} onChange={event => { void upload(Array.from(event.target.files || []).filter(file => /\.(png|jpe?g|webp)$/i.test(file.name))); event.target.value = ''; }}/>
    <input ref={replaceRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void upload(Array.from(event.target.files || []), replaceId.current); event.target.value = ''; }}/>
    {progress && <p role="status">{progress}{!uploading && ' · 원고를 저장해주세요.'}</p>}
    {failed.length > 0 && <div role="alert"><ul>{failed.map((item, index) => <li key={index}>{item.file.name}: {item.error}<button disabled={uploading} onClick={() => void upload([item.file], item.replace)}>이 사진 재시도</button></li>)}</ul><p>성공한 사진은 유지됩니다. 원고에서 제외한 사진도 과거 버전을 위해 보관됩니다.</p></div>}
    <div className="blocks">{blocks.map((block, index) => <section className="draft-block" key={block.id} aria-label={`블록 ${index + 1}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); move(blocks.findIndex(item => item.id === dragged), index); setDragged(''); }}>
      <div className="block-tools"><strong draggable={!disabled} onDragStart={() => setDragged(block.id)}>{index + 1}. {block.type === 'text' ? '본문' : '사진'} ↕</strong><div><button disabled={disabled || index === 0} aria-label={`블록 ${index + 1} 위로`} onClick={() => move(index, index - 1)}>↑</button><button disabled={disabled || index === blocks.length - 1} aria-label={`블록 ${index + 1} 아래로`} onClick={() => move(index, index + 1)}>↓</button><button disabled={disabled || blocks.length === 1} onClick={() => commit(blocks.filter(item => item.id !== block.id))}>블록 제외</button></div></div>
      <label className="block-lock"><input type="checkbox" disabled={disabled} checked={!!block.locked} onChange={event => update(block.id, { locked: event.target.checked })}/>AI 수정 잠금 · 직접 편집은 가능</label>
      {block.type === 'text' ? <label>본문 {index + 1}<textarea className="markdown" disabled={disabled} rows={6} value={block.markdown} onChange={event => update(block.id, { markdown: event.target.value })}/></label> : <>
        <img className="block-thumbnail" loading="lazy" src={`/api/assets/${block.imageId}?size=thumb`} alt={assets.find(asset => asset.id === block.imageId)?.name || '원고 사진'}/>
        <div className="button-row"><button disabled={disabled} className={draft.cover === block.imageId ? 'selected' : ''} onClick={() => commit(blocks, block.imageId)}>{draft.cover === block.imageId ? '✓ 대표' : '대표로'}</button><button disabled={disabled} onClick={() => { replaceId.current = block.id; replaceRef.current?.click(); }}>사진 교체</button></div>
        <label>작성 메모 · 게시되지 않음<textarea aria-label="작성 메모 · 게시되지 않음" disabled={disabled} rows={2} maxLength={4000} value={block.note} onChange={event => update(block.id, { note: event.target.value })}/></label>
        <label>묶음 · 장소/날짜<input aria-label="묶음 · 장소/날짜" disabled={disabled} maxLength={200} value={block.group} onChange={event => update(block.id, { group: event.target.value })}/></label>
        <label>짧은 캡션<input aria-label="짧은 캡션" disabled={disabled} maxLength={500} value={block.caption} onChange={event => update(block.id, { caption: event.target.value })}/></label>
        <label>긴 본문 설명<textarea aria-label="긴 본문 설명" disabled={disabled} rows={3} maxLength={10000} value={block.description} onChange={event => update(block.id, { description: event.target.value })}/></label>
      </>}
      <button disabled={disabled} onClick={() => addText(block.id)}>이 뒤에 본문 추가</button>
    </section>)}</div>
    {assets.some(asset => asset.library) && <label>라이브러리에서 표지 가져오기<select disabled={disabled || draft.images.length >= maxDraftImages} value="" onChange={event => { const id = event.target.value; if (id) commit([...blocks, { id: crypto.randomUUID(), type: 'image', imageId: id, note: '', caption: '', description: '', group: '' }], id); }}><option value="">표지 선택</option>{assets.filter(asset => asset.library && !draft.images.some(image => image.id === asset.id)).map(asset => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></label>}
  </section>;
}
