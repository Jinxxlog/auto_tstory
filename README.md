# auto_tstory

기존 글의 문체를 반영해 원고를 작성하고 티스토리에 전송하는 로컬 웹앱을 개발하는 프로젝트입니다. **P0: 브라우저 자동화 가능성 검증을 완료했습니다.** 현재 제공하는 것은 개발용 CLI이며, AI 생성과 웹앱은 아직 구현되지 않았습니다.

실제 블로그의 `테스트` 카테고리에 비공개 글 1개를 저장하고, 제목·문단·목록·코드·표·이미지 2장·대표 이미지 보존을 확인했습니다. 비로그인 접근 차단과 브라우저 재시작 후 인증 재사용도 확인했습니다. 장기간 무인 운영과 다른 스킨·계정에서의 동작은 검증 범위에 포함되지 않습니다.

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

브라우저 재시작은 작성 중 내용을 잃을 수 있으므로 편집 중에는 실행하지 마세요. 인증된 관리·편집 화면에서는 갱신된 쿠키를 주기적으로 저장합니다. 이 파일은 암호화된 비밀 저장소가 아니며 현재 PC의 사용자 파일 권한으로 보호됩니다.

## 에디터 검증 명령

아래 명령은 `npm run p0`로 실행한 터미널에 한 줄씩 입력합니다. 각 단계의 결과와 화면을 확인한 뒤 다음 단계로 진행하세요. **`action save-private <카테고리>`는 실제 티스토리에 비공개 글을 저장합니다.**

| 순서 | 명령 | 동작 |
| --- | --- | --- |
| 1 | `editor` | 관리 홈에서 새 글 열기 |
| 2 | `action category-menu` | 카테고리 목록 표시 |
| 3 | `action category-select 테스트` | 정확한 이름으로 카테고리 선택 |
| 4 | `action mode-html` | HTML 모드로 전환 |
| 5 | `action fill-fixture` | 빈 원고에 고정 테스트 제목과 HTML 입력 |
| 6 | `action attach-menu` | 첨부 메뉴 열기 |
| 7 | `action upload-fixtures` | 테스트 PNG 두 장 첨부 |
| 8 | `inspect` | 업로드 완료와 본문의 이미지 마커 2개 확인 (`.local/last-inspection.json`) |
| 9 | `action mode-basic` | 기본모드로 전환 |
| 10 | `action image-one-select` | 본문의 첫 이미지 선택 |
| 11 | `action representative-select` | 선택한 이미지를 대표로 지정 |
| 12 | `action publish-options` | 발행 설정 열기, 실제 저장은 하지 않음 |
| 13 | `action cover-state` | 대표 이미지와 비공개 선택 상태 확인 |
| 14 | `action save-private 테스트` | 제목·본문·이미지·카테고리·비공개 설정 확인 후 저장 |
| 15 | `action open-saved` | 관리 목록에서 저장 결과를 확인하고 글 열기 |
| 16 | `action verify-saved` | 저장된 내용과 대표 이미지 확인, 로컬 결과 기록 |

P0는 비공개가 선택되어 있지 않으면 저장을 거부합니다. 같은 원고의 저장 시도가 기록되어 있으면 다시 입력·저장하지 않으므로, 시간 초과가 발생해도 먼저 관리 목록을 확인하세요. 공개 발행 기능은 제공하지 않습니다.

현재 생성된 테스트 글은 다시 만들 필요가 없습니다. 관리 홈에서 `action post-list` → `action open-saved` → `action verify-saved`로 재확인할 수 있습니다.

보조 명령: `action preview`, `action preview-verify`, `action preview-close`, `action body-inspect`, `action anonymous-check`, `action session-check`, `action back-to-manager`. 자동 저장 복구 확인창에서는 `action dialog-info`로 내용을 확인하고, 이 도구의 테스트 원고라면 `action restore-fixture`로 복구합니다. 다른 확인창은 자동 승인하지 않습니다.

대표 이미지는 기본모드에서 본문 이미지를 선택하는 방법을 사용합니다. 별도 대표 이미지 파일 업로드는 검증 중 문제가 있어 최종 명령에서 제외했습니다. 저장 결과의 대표 이미지 확인에는 현재 블로그 스킨의 `.article-header`도 사용하므로 다른 스킨에서는 검증 어댑터를 조정해야 할 수 있습니다.

## 로컬 자료와 Git

`.env*`, `.local/`, `data/`, DB, 로그, 테스트 보고서는 Git에서 제외합니다. 화면 검사 결과에는 블로그 본문이 포함될 수 있으므로 `.local/`에만 저장합니다. 별도로 만든 파일을 커밋할 때도 내용을 확인하세요.

```bash
git status
git add README.md src scripts tests package.json package-lock.json tsconfig.json PROJECT_PLAN.md
git diff --cached
git commit -m "변경 내용"
git push
```
