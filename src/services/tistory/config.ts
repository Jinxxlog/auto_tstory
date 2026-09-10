import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const localRoot = path.join(projectRoot, '.local');

export { normalizeBlogUrl } from './url.js';

export function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.origin === 'null' ? `${url.protocol}${url.pathname}` : `${url.origin}${url.pathname}`;
  } catch { return 'unavailable'; }
}
