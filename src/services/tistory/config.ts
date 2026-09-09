import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const localRoot = path.join(projectRoot, '.local');

export function normalizeBlogUrl(value: string): string {
  const url = new URL(value.includes('://') ? value : `https://${value}`);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('HTTPS 티스토리 블로그 주소를 입력하세요.');
  }
  if (!/^[a-z0-9-]+\.tistory\.com$/.test(url.hostname) || ['www.tistory.com', 'notice.tistory.com'].includes(url.hostname)) {
    throw new Error('P0에서는 블로그이름.tistory.com 주소를 사용하세요.');
  }
  return url.origin;
}

export function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch { return 'unavailable'; }
}
