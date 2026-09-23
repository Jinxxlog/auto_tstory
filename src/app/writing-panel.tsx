'use client';
import type { Draft, WritingInput } from '../lib/model';
import { emptyWriting, expandedKind } from '../lib/writing';

export function WritingPanel({ draft, disabled, edit }: { draft: Draft; disabled: boolean; edit: (patch: Partial<Draft>) => void }) {
  if (!expandedKind(draft.kind)) return null;
  const writing = draft.writing || emptyWriting();
  const fields: [keyof WritingInput, string][] = draft.kind === 'travel'
    ? [['place', '여행 장소'], ['dates', '방문 날짜 · 모르면 비워두세요'], ['itinerary', '일정 · 이동 순서'], ['experience', '직접 경험한 내용'], ['costs', '실제 비용 · 기준 시점']]
    : draft.kind === 'information' ? [['audience', '정보 글 독자'], ['scope', '정보 설명 범위'], ['checkedAt', '자료 확인 시점']]
    : [['mood', '원하는 분위기']];
  return <section className="panel writing-panel"><h2>이 글의 작성 자료</h2><fieldset disabled={disabled}>{fields.map(([key, label]) => <label key={key}>{label}<textarea rows={key === 'experience' || key === 'itinerary' ? 3 : 2} maxLength={key === 'experience' || key === 'itinerary' ? 10000 : 2000} value={writing[key]} onChange={event => edit({ writing: { ...writing, [key]: event.target.value } })}/></label>)}</fieldset><p className="help">작성 자료는 직접 게시되지 않습니다. 사진만으로 방문일·가격·가게 이름·감정을 확정하지 않으며, 모르는 사실은 보완 질문으로 남깁니다.</p></section>;
}
