import type { Draft, OutlineItem, WritingInput } from './model';
import { draftBlocks, withBlocks } from './blocks';

export const expandedKind = (kind: Draft['kind']) => ['travel', 'information', 'free'].includes(kind);
export const emptyWriting = (): WritingInput => ({ place: '', dates: '', itinerary: '', experience: '', costs: '', audience: '', scope: '', checkedAt: '', mood: '' });
export function generationMaterial(draft: Draft) {
  const writing = draft.writing;
  return {
    writing: !writing ? undefined : draft.kind === 'travel' ? { place: writing.place, dates: writing.dates, itinerary: writing.itinerary, experience: writing.experience, costs: writing.costs } : draft.kind === 'information' ? { audience: writing.audience, scope: writing.scope, checkedAt: writing.checkedAt } : draft.kind === 'free' ? { mood: writing.mood } : undefined,
    material: draft.kind === 'ps' ? draft.material : ['technical', 'information'].includes(draft.kind) && draft.material ? { topic: draft.material.topic, interpretation: draft.material.interpretation, referenceIds: draft.material.referenceIds } : undefined,
  };
}
export function validateWriting(value: unknown): WritingInput {
  if (!value || typeof value !== 'object') throw new Error('글 작성 자료를 확인하세요.');
  const input = value as Record<string, unknown>; const output = emptyWriting();
  for (const key of Object.keys(output) as (keyof WritingInput)[]) {
    if (typeof input[key] !== 'string' || input[key].length > (['itinerary', 'experience'].includes(key) ? 10000 : 2000)) throw new Error('글 작성 자료의 길이를 확인하세요.');
    output[key] = input[key] as string;
  }
  return output;
}
export function outlineItems(draft: Draft): OutlineItem[] {
  return draftBlocks(draft).map((block, index) => draft.outline?.find(item => item.blockId === block.id) || {
    blockId: block.id, title: block.type === 'image' ? block.group || `사진 ${index + 1}` : block.markdown.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').slice(0, 200) || `본문 ${index + 1}`, purpose: '',
  });
}
// This is a review freshness token, not a security signature. No author text is exposed in it.
export function outlineToken(draft: Draft) {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  const value = JSON.stringify(canonical({ kind: draft.kind, summary: draft.summary, writing: draft.writing, material: draft.material, blocks: draftBlocks(draft), outline: outlineItems(draft) }));
  let hash = 2166136261; for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return `r3-${(hash >>> 0).toString(16)}-${value.length}`;
}
export const outlineReviewed = (draft: Draft) => !!draft.outline?.length && draft.reviewedOutline === outlineToken(draft);
export function validateOutline(value: unknown): OutlineItem[] {
  if (!Array.isArray(value) || value.length > 250 || value.some(item => !item || typeof item.blockId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(item.blockId) || typeof item.title !== 'string' || item.title.length > 200 || typeof item.purpose !== 'string' || item.purpose.length > 2000) || new Set(value.map(item => item.blockId)).size !== value.length) throw new Error('개요 입력을 확인하세요.');
  return value.map(({ blockId, title, purpose }) => ({ blockId, title, purpose }));
}
export function seedOutline(draft: Draft): Draft {
  const blocks = draftBlocks(draft);
  // Existing body, photos, locks and IDs are never replaced by a template.
  if (blocks.some(block => block.locked || (block.type === 'text' && block.markdown.trim()))) return { ...draft, outline: outlineItems(draft), reviewedOutline: undefined };
  const labels = draft.kind === 'travel' ? ['여행의 시작', '일정과 장면', '경험과 마무리'] : draft.kind === 'information' ? ['주제와 범위', '설명과 비교', '활용과 확인할 내용'] : ['이야기의 시작', '담고 싶은 이야기', '마무리'];
  const texts = labels.map((title, index) => ({ id: `outline-${index}-${crypto.randomUUID()}`, type: 'text' as const, markdown: `## ${title}` }));
  const photos = blocks.filter(block => block.type === 'image');
  const result = withBlocks(draft, [texts[0], texts[1], ...photos, texts[2]]);
  return { ...result, outline: outlineItems(result), reviewedOutline: undefined };
}
