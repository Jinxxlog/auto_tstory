'use client';
import type { Draft } from '../lib/model';
import { draftBlocks, withBlocks } from '../lib/blocks';
import { outlineItems, outlineReviewed, outlineToken, seedOutline } from '../lib/writing';

export function OutlinePanel({ draft, disabled, change }: { draft: Draft; disabled: boolean; change: (draft: Draft) => void }) {
  const blocks = draftBlocks(draft); const items = outlineItems(draft);
  const move = (index: number, to: number) => { const next = [...blocks]; next.splice(to, 0, next.splice(index, 1)[0]); change(withBlocks({ ...draft, outline: items }, next)); };
  return <section className="panel outline-panel"><h2>개요와 사진 배치 검토</h2><p>전체 초안을 만들기 전에 각 블록의 제목·목적과 사진 위치를 확인하세요. 아래 순서가 본문 순서입니다. 본문 편집기에서도 블록을 추가하거나 배치할 수 있습니다.</p><fieldset disabled={disabled}>
    <button onClick={() => change(seedOutline(draft))}>유형별 개요 준비</button><p className="help">본문이 비어 있을 때 기본 구성을 제안합니다. 이미 쓴 본문과 사진은 보존합니다. AI 요청 없이 직접 수정할 수 있습니다.</p>
    {items.map((item, index) => <div className="outline-row" key={item.blockId}><strong>{index + 1}. {blocks[index].type === 'image' ? '사진과 설명' : '본문'}{blocks[index].locked ? ' · AI 잠금' : ''}</strong>{blocks[index].type === 'image' && <img width={100} loading="lazy" src={`/api/assets/${blocks[index].imageId}?size=thumb`} alt={`개요 사진 ${index + 1}`}/>}<label>개요 제목 {index + 1}<input maxLength={200} value={item.title} onChange={event => change({ ...draft, outline: items.map((value, position) => position === index ? { ...value, title: event.target.value } : value) })}/></label><label>담을 내용 {index + 1}<textarea rows={2} maxLength={2000} value={item.purpose} onChange={event => change({ ...draft, outline: items.map((value, position) => position === index ? { ...value, purpose: event.target.value } : value) })}/></label><div className="button-row"><button disabled={disabled || index === 0} aria-label={`개요 ${index + 1} 위로`} onClick={() => move(index, index - 1)}>↑</button><button disabled={disabled || index === items.length - 1} aria-label={`개요 ${index + 1} 아래로`} onClick={() => move(index, index + 1)}>↓</button></div></div>)}
    <button className="primary" onClick={() => { const next = { ...draft, outline: items }; change({ ...next, reviewedOutline: outlineToken(next) }); }}>개요·사진 배치 검토 완료</button></fieldset><p role="status">{outlineReviewed(draft) ? '검토 완료 · 원고를 저장하면 전체 초안을 생성할 수 있습니다.' : '검토 필요 · 자료나 블록을 바꾸면 다시 확인해주세요.'}</p></section>;
}
