import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export function renderMarkdown(markdown: string) {
  return sanitizeHtml(marked.parse(markdown, { async: false, gfm: true }), {
    allowedTags: ['p','br','h2','h3','h4','strong','em','del','blockquote','ul','ol','li','pre','code','table','thead','tbody','tr','th','td','a','hr'],
    allowedAttributes: { a: ['href','title'], code: ['class'] }, allowedSchemes: ['https','http'], allowProtocolRelative: false,
  });
}
