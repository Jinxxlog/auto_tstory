export function normalizeBlogUrl(value: string): string {
  const url = new URL(value.includes('://') ? value : `https://${value}`);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('HTTPS 티스토리 블로그 주소를 입력하세요.');
  if (!/^[a-z0-9-]+\.tistory\.com$/.test(url.hostname) || ['www.tistory.com', 'notice.tistory.com'].includes(url.hostname)) throw new Error('블로그이름.tistory.com 주소를 사용하세요.');
  return url.origin;
}

/** Only canonical saved-post URLs, never an editor, credentials or redirect query. */
export function normalizePostUrl(value: string, blog: string): string {
  const url = new URL(value);
  const pathname = decodeURIComponent(url.pathname);
  if (url.origin !== normalizeBlogUrl(blog) || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || /[\\\u0000-\u001f]/.test(pathname) || !/^\/(?:[1-9]\d*|entry\/[^/]+)\/?$/.test(pathname)) throw new Error('이 작업의 블로그에 저장된 글 주소를 입력하세요. 관리·편집 주소나 쿼리/해시는 사용할 수 없습니다.');
  url.pathname = url.pathname.replace(/\/$/, '');
  return url.href;
}
