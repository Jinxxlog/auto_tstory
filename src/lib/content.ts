import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import type { Draft, ImageBlock } from './model';
import { draftBlocks } from './blocks';
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export function renderMarkdown(markdown: string) {
  return sanitizeHtml(marked.parse(markdown, { async: false, gfm: true }), {
    allowedTags: ['p','br','h2','h3','h4','strong','em','del','blockquote','ul','ol','li','pre','code','table','thead','tbody','tr','th','td','a','hr'],
    allowedAttributes: { a: ['href','title'], code: ['class'] }, allowedSchemes: ['https','http'], allowProtocolRelative: false,
  });
}
export function renderDraft(draft: Draft, image: (block: ImageBlock) => string = block => `<figure data-image-id="${escapeHtml(block.imageId)}"><img src="/api/assets/${encodeURIComponent(block.imageId)}" alt="${escapeHtml(block.caption)}" loading="lazy"/><figcaption>${escapeHtml(block.caption)}</figcaption></figure>`) {
  return draftBlocks(draft).map(block => block.type === 'text' ? renderMarkdown(block.markdown) : image(block) + renderMarkdown(block.description)).join('\n');
}
