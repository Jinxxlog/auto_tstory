export interface TestDraft {
  id: string;
  title: string;
  html: string;
  visibility: 'private';
  images: string[];
  checks: string[];
}

/** Fixed synthetic content: no user photos, code or personal information. */
export function createTestDraft(now = new Date()): TestDraft {
  const id = `P0-${now.toISOString().replace(/[:.]/g, '-')}`;
  return {
    id,
    title: `[P0 비공개 테스트] 자동화 서식 검증 ${id}`,
    visibility: 'private',
    images: ['p0-image-1.png', 'p0-image-2.png'],
    html: [
      '<h2>자동화 검증 안내</h2>',
      `<p>이 글은 티스토리 입력·이미지·서식 보존을 확인하는 비공개 테스트 글입니다. 식별자: ${id}</p>`,
      '<p>한글과 English, 숫자 123, 특수문자 &amp; &lt; &gt;가 유지되는지 확인합니다.</p>',
      '<h2>목록과 강조</h2>',
      '<ul><li>첫 번째 항목</li><li><strong>굵은 글씨</strong>와 <em>기울임</em></li></ul>',
      '<h2>코드</h2>',
      '<pre><code class="language-javascript">function sum(a, b) {\n  return a + b;\n}\nconsole.log(sum(2, 3)); // 5</code></pre>',
      '<h2>표</h2>',
      '<table><tbody><tr><th>항목</th><th>기대값</th></tr><tr><td>이미지</td><td>2장</td></tr><tr><td>공개 범위</td><td>비공개</td></tr></tbody></table>',
      '<h2>이미지</h2>',
      '<p>아래에 테스트 이미지 1, 2를 순서대로 첨부합니다. 첫 이미지를 대표 이미지로 선택합니다.</p>',
    ].join('\n'),
    checks: ['title', 'paragraph', 'list', 'code', 'table', 'two-images', 'image-order', 'cover', 'category', 'private', 'reopen'],
  };
}
