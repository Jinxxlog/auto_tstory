import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBlogUrl, safeUrl } from '../src/services/tistory/config.js';

test('blog URLs normalize to the HTTPS origin', () => {
  assert.equal(normalizeBlogUrl('example-blog.tistory.com/123'), 'https://example-blog.tistory.com');
});

test('rejects credential-bearing URLs, other domains, ports and insecure URLs', () => {
  for (const value of ['https://tistory.com.evil.test', 'https://u:p@blog.tistory.com', 'http://blog.tistory.com', 'https://blog.tistory.com:3000', 'https://www.tistory.com', 'https://localhost']) {
    assert.throws(() => normalizeBlogUrl(value), value);
  }
});

test('status URLs omit authentication query parameters and fragments', () => {
  assert.equal(safeUrl('https://accounts.kakao.com/login?token=secret#code'), 'https://accounts.kakao.com/login');
});
