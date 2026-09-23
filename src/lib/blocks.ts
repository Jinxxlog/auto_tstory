import type { Draft, DraftBlock, ImageBlock } from './model';

export const maxDraftImages = 50;
export const maxRequestImages = 10;
export function draftBlocks(draft: Draft): DraftBlock[] {
  if (draft.schemaVersion === 2 && draft.blocks) return draft.blocks;
  return [{ id: `legacy-text-${draft.id || 'new'}`, type: 'text', markdown: draft.markdown }, ...draft.images.map(image => ({ id: `legacy-image-${image.id}`, type: 'image' as const, imageId: image.id, note: '', caption: image.caption, description: '', group: '' }))];
}
export function imageBlocks(draft: Draft): ImageBlock[] { return draftBlocks(draft).filter((block): block is ImageBlock => block.type === 'image'); }
export function withBlocks(draft: Draft, blocks: DraftBlock[]): Draft {
  const photos = blocks.filter((block): block is ImageBlock => block.type === 'image');
  return { ...draft, schemaVersion: 2, blocks, markdown: blocks.map(block => block.type === 'text' ? block.markdown : block.description).filter(Boolean).join('\n\n'), images: photos.map(block => ({ id: block.imageId, caption: block.caption })), cover: photos.some(block => block.imageId === draft.cover) ? draft.cover : null };
}
export function validateBlocks(input: unknown): DraftBlock[] {
  if (!Array.isArray(input) || !input.length || input.length > 250) throw new Error('본문 블록은 1~250개여야 합니다.');
  const text = (value: unknown, max: number) => { if (typeof value !== 'string' || value.length > max) throw new Error('블록 입력 길이를 확인하세요.'); return value; };
  const blocks: DraftBlock[] = input.map(block => {
    if (!block || typeof block !== 'object' || typeof block.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(block.id)) throw new Error('본문 블록 ID를 확인하세요.');
    if (block.locked !== undefined && typeof block.locked !== 'boolean') throw new Error('블록 잠금을 확인하세요.');
    const lock = block.locked === undefined ? {} : { locked: block.locked };
    if (block.type === 'text') return { ...lock, id: block.id, type: 'text', markdown: text(block.markdown, 100000) };
    if (block.type !== 'image' || typeof block.imageId !== 'string' || !/^[a-f0-9-]{36}$/.test(block.imageId)) throw new Error('사진 블록 참조를 확인하세요.');
    return { ...lock, id: block.id, type: 'image', imageId: block.imageId, note: text(block.note, 4000), caption: text(block.caption, 500), description: text(block.description, 10000), group: text(block.group, 200) };
  });
  if (new Set(blocks.map(block => block.id)).size !== blocks.length) throw new Error('본문 블록 ID가 중복되었습니다.');
  const photos = blocks.filter(block => block.type === 'image');
  if (photos.length > maxDraftImages || new Set(photos.map(block => block.imageId)).size !== photos.length) throw new Error('사진은 중복 없이 최대 50장입니다.');
  if (blocks.reduce((size, block) => size + (block.type === 'text' ? block.markdown.length : block.description.length), 0) > 100000) throw new Error('전체 본문은 100,000자 이하입니다.');
  return blocks;
}
