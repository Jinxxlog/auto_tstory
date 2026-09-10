export function checkRequest(request: Request, mutation = false) {
  const url = new URL(request.url);
  const host = request.headers.get('host');
  // Next may canonicalize request.url to localhost even when Host is 127.0.0.1.
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !host || !/^(127\.0\.0\.1|localhost|\[::1\]):3000$/.test(host)) throw new Error('로컬 주소로만 접근할 수 있습니다.');
  const expectedOrigin = `http://${host}`;
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site' || (origin && origin !== expectedOrigin)) throw new Error('다른 사이트의 요청은 허용하지 않습니다.');
  if (mutation && (origin !== expectedOrigin || request.headers.get('x-tstory-request') !== 'local-web')) throw new Error('웹앱에서 다시 요청하세요.');
}
