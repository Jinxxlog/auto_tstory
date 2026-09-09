# auto_tstory

기존 글의 문체를 반영해 원고를 작성하고 티스토리에 전송하는 로컬 웹앱을 개발하는 프로젝트입니다. 현재는 **P0: 브라우저 자동화 가능성 검증** 단계이며 AI 생성과 웹앱은 아직 구현되지 않았습니다.

상세 계획과 최신 작업 기록: [PROJECT_PLAN.md](PROJECT_PLAN.md).

## P0 실행

Node.js 22.20 이상과 Google Chrome이 필요합니다. 첫 설치:

```bash
npm ci
npm run typecheck
npm test
npm run test:browser
```

`test:browser`는 임시 로컬 웹페이지와 별도 테스트 프로필에서 한글 입력, 쿠키·로컬 저장소 재사용, PNG 두 장 선택을 확인합니다. 티스토리에 접속하거나 글을 저장하지 않습니다. 검사 자료는 `.local/smoke-profile-*/`에 격리하며 실제 티스토리 검증 원고·검사 기록을 덮어쓰지 않습니다.

실제 티스토리 검증용 원고와 PNG 두 장은 `npm run p0:fixtures`로 준비합니다. 기존 테스트 원고 식별자는 유지합니다.

로그인 브라우저 실행:

```bash
npm run p0 -- --blog https://블로그이름.tistory.com
```

주소를 생략하면 티스토리 로그인 화면부터 열립니다. 평소 사용하는 Chrome과 별도의 `.local/tistory-profile/`을 사용합니다. 로그인·추가 인증은 열린 브라우저에서 직접 처리하고, 비밀번호나 인증번호를 터미널에 입력하지 마세요.

| 터미널 명령 | 동작 |
| --- | --- |
| `status` | 현재 탭의 주소 확인. 인증 쿼리·해시는 출력하지 않음 |
| `blog https://이름.tistory.com` | 검증할 블로그의 관리 화면으로 이동 |
| `checkpoint` | 로그인된 관리 홈에서 인증 상태를 `.local/`에 저장 |
| `inspect` | 선택한 블로그 화면의 본문·컨트롤 구조 검사 |
| `editor` | 관리 화면의 글쓰기 링크 열기 |
| `screenshot` | 선택한 블로그 화면을 `.local/last-page.png`에 저장 |
| `restart` | 전용 브라우저를 정상 종료·재실행해 관리 화면 접근 확인 |
| `quit` | 전용 브라우저와 도구 종료 |

로그인 완료 후 관리 홈에서 `checkpoint`를 실행하세요. 프로필에 남지 않는 세션 쿠키도 `.local/tistory-auth.json`에 저장하고 다음 실행에 복원합니다. `restart`는 관리 홈에서 인증 상태를 저장한 뒤 재시작합니다. 서버가 만료·취소한 세션은 복원 파일이 있어도 다시 로그인해야 합니다.

현재 도구는 글을 발행하지 않습니다. 실제 에디터를 관찰한 뒤 본문·이미지·카테고리 입력과 비공개 저장 기능을 추가합니다. 브라우저 재시작은 작성 중 내용을 잃을 수 있으므로 편집 중에는 실행하지 마세요.

## 로컬 자료와 Git

`.env*`, `.local/`, `data/`, DB, 로그, 테스트 보고서는 Git에서 제외합니다. 화면 검사 결과에는 블로그 본문이 포함될 수 있으므로 `.local/`에만 저장합니다. 별도로 만든 파일을 커밋할 때도 내용을 확인하세요.

```bash
git status
git add README.md src scripts tests package.json package-lock.json tsconfig.json PROJECT_PLAN.md
git diff --cached
git commit -m "변경 내용"
git push
```
