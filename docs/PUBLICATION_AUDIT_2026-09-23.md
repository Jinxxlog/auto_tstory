# 공개 전 검사 기록 — 2026-09-23

## 범위와 결론

대상은 기존 `Jinxxlog/auto_tstory`의 로컬 main과 미커밋 R0.1/R7.1/R2/R3 변경이다. 시작 HEAD/원격 main은 `f460832d71e9e76e7ebe3d3c3b541109fdb54734`. GitHub API의 `private: false`와 원격 ref를 직접 확인했다. 새 저장소를 만들거나 과거 기록을 변경하지 않는다. 최종 업로드 결과는 PROJECT_PLAN의 이번 작업 기록 및 GitHub 커밋을 기준으로 확인한다.

자체 정규식 검사와 경로·호출부 검토에서 **공개 대상 및 기존 도달 가능한 13개 커밋/138개 고유 blob의 비밀값 탐지 0건**. 이는 알려지지 않은 형식까지 비밀정보 부재를 보증하는 결과가 아니다. 이번에 발견한 인증정보는 모두 Git 제외 경로에 있으며 값을 출력하거나 복사하지 않았다.

## 방법과 한계

- 최초 공개 후보 109개 경로의 텍스트 검토 및 바이너리 유무 검사. 문서 추가 후 최종 stage를 다시 검사한다.
- 프로젝트에서 생성물·의존성·일부 브라우저 캐시를 제외한 5,572개 파일 경로를 순회하고 32MiB 이하 파일 내용에서 키·JWT·암호 리터럴·접속 URL·서비스 계정 패턴을 검사. 32MiB 초과 16개는 내용 검사 제외. `.git`, `node_modules`, `.next`, out/dist, Cache/Code Cache/GPU 계열 캐시는 범위 밖이며 공개 대상에서도 제외한다.
- `git rev-list --all`과 각 commit의 `git ls-tree`/`git cat-file`로 현재 파일에서 삭제된 blob도 검사. reflog·도달 불가능 객체·다른 사람의 fork/별도 원격 branch는 완전 조사 대상이 아니다. 현재 원격 main은 로컬 HEAD와 같음을 확인했다.
- API/provider 키, PEM private key, JWT, credential-bearing DB URL, 문자 리터럴 secret, Firebase service account, `.env`, 인증 파일, Android keystore/key.properties, Apple 인증서/provisioning 패턴을 확인. 원본 내용이나 일치 문자열을 로그로 내보내지 않는 검사다.
- 공개 소스·테스트·문서에서 관리자 계정, 금융 주문/증권 인증, 사용자 DB·원본 사진·참고 글 본문 묶음은 발견하지 않았다. Git 작성자 메타데이터와 기존 문서의 공개 블로그 주소는 기존 공개 식별정보이며 익명 저장소라고 표현하지 않는다. 이미지 안의 개인정보/OCR, 암호화된 브라우저 DB 내용 전체 판독은 수행하지 않았다.
- 로컬 검사 원본은 `.local/publication-audit.json`, 의존성 감사 결과는 `.local/publication-npm-audit.json`에만 보관한다. 이 문서에는 경로·종류·집계만 기록한다.

## 발견한 민감 자료

| 경로 | 정보 종류 | 조치/판단 |
| --- | --- | --- |
| `.local/tistory-auth.json`, `.local/tistory-profile/` | 티스토리 브라우저 세션/쿠키 | 기존 `.local/` 제외 유지, 내용 공개 금지 |
| `.local/naver-auth.json`, 네이버 전용 프로필 | 네이버 세션 | 동일 |
| `.local/codex-writing/auth.json` | AI 로그인 access/refresh 계열 토큰 | 동일; 환경변수로 옮겨도 공개하지 않으며 공식 인증 저장소 유지 |
| `.local/codex-writing/logs_2.sqlite`, `logs_2.sqlite-wal` | JWT 패턴이 들어 있는 Codex 내부 로그 | 앱이 stderr를 버려도 공급자 자체 로그에는 남을 수 있음; Git/지원 자료로 공유 금지, 보존·정리 정책 후속 검토 |
| `.local/gemini-r1-home/.gemini/oauth_creds.json` | 과거 Gemini 실험 OAuth 인증 | 실험 중단과 인증 파일 삭제는 별개; 자동 삭제/폐기하지 않음 |
| `data/`, `backups/`, `.local/`의 격리 DB·사진·진단 | 사용자 원고·이미지·자료·계정 화면 가능 | 전부 공개 제외, 실제 원고 제목/본문은 보고서에 전재하지 않음 |

루트 `.env`나 공개 대상에 하드코딩된 실제 API 키를 찾지 못했으므로 키 이동·재발급을 실행하지 않았다. `.env.example`은 경로 설정만 값 없는 주석으로 추가했다. IDE 설정, keystore, 인증서, 일반 서비스 계정 파일명 규칙을 `.gitignore`에 보강했다. 기존 추적 파일은 ignore만으로 제거되지 않으므로 최종 stage 경로도 확인한다.

**기록에서 실제 비밀값이 확인되는 경우의 대응**: push 중단 → 사용자에게 경로/종류만 보고 → 소유자가 해당 키·세션 폐기/재발급 → 안전한 소스만 담은 새 공개 저장소 검토. 기존 기록 rewrite/force-push는 임의 수행하지 않는다. 이번 도달 가능한 기록 검사에서는 이 중단 조건이 발견되지 않았다.

## 외부 자료와 라이선스

공개 후보에 외부 이미지·폰트·DB·실제 사용자 원본 바이너리는 없다. `public/` 디렉터리도 없다. `src/app/globals.css`의 `Noto Sans KR`는 CSS 글꼴 이름이며 font 파일/원격 import를 배포하지 않는다. 합성 사진은 `scripts/create-fixtures.ts`, `scripts/web-blocks-check.ts`, `scripts/r3-private-check.ts`에서 코드로 만들고 `.local/`에 보관한다. 참고 URL은 링크이며 가져온 전문은 로컬 DB에 저장된다. 테스트의 예문은 합성 검사 자료다. AI 생성 코드의 원 출처를 코드만으로 완전히 증명할 수는 없다.

| 직접 의존성 | 설치된 package.json의 license | 실제 호출 근거 |
| --- | --- | --- |
| next / react / react-dom | MIT | build/start, `src/app/page.tsx`, Next의 React renderer |
| cheerio | MIT | `fetchReference`의 본문 추출, `Publisher.verify` |
| marked / sanitize-html | MIT | `renderMarkdown` |
| playwright | Apache-2.0 | `TistoryProbe.start`, Naver probe, UI 검사 |
| sharp | Apache-2.0 | `importImage`, `thumbnail`, `Publisher.verify` |
| tsx | MIT | `scripts/run.mjs`의 worker `--import tsx` |

이 표는 설치된 메타데이터 확인이며 법률 검토나 전이 의존성 고지의 완결성을 뜻하지 않는다. 이번 업로드는 소스·lockfile이며 패키지/Chrome/Node 실행 파일을 재배포하지 않는다. 실행 파일·패키지를 묶은 설치 배포판은 전이 의존성 LICENSE/NOTICE, Sharp의 native 구성요소 등을 포함해 별도 검토해야 한다. 현재 소스 공개 후보에서 출처가 불분명한 별도 재배포 자료는 발견하지 않았다. 소유자 라이선스는 새로 선택하지 않았고 `UNLICENSED`를 유지했다.

## 이번 실행 결과

| 항목 | 결과 |
| --- | --- |
| Node / 직접 의존성 | Node 22.20.0, 선언 패키지 모두 설치. `npm ls --depth=0`에 sharp 관련 `@emnapi/runtime`, `@img/sharp-wasm32` extraneous 2개; 공개 제외, 자동 prune하지 않음 |
| 운영 의존성 감사 | `npm audit --omit=dev --json`: 알려진 취약점 0. 검사 시점 DB 결과이며 보안 보증 아님 |
| 정적 검사 | `npm run typecheck`, 추가 `tsc --noEmit --noUnusedLocals --noUnusedParameters` 통과. ESLint 설정/명령 없음 |
| 기존 테스트 | `npm test` 32/32 통과 |
| 빌드 | `npm run build` 통과 |
| 빌드 자료 유출 검사 | `npm run test:build-artifacts`: 추적 파일 9개 중 사용자 자료/인증/백업 경로 0 |
| UI/HTTP 회귀 | `npm run test:writing` 통과: 3유형 모의 생성/편집/재작성/비공개 큐, 390px 가로 넘침 없음. 외부 생성·발행 없음 |
| 복구 UI 회귀 | `npx tsx scripts/web-recovery-check.ts` 통과: URL/후보/미발행 종료, 다른 글·공개 글 거절, 모의 읽기 요청만 발생. 실제 티스토리 검증 아님 |
| 합성 진단 | `.local/analysis-check.ts`: 전체 상태 조회 증가 측정 및 사진 적용 중 상태 기록 실패 재현. 결과는 기술 분석 보고서 참조 |
| 이번 미실행 | 실제 AI 로그인/생성·실제 블로그 게시/재확인·Docker·다른 PC·설치 재검증. 계정/원본 자료 변경이나 불필요한 사용량 소비가 필요한 범위로 기존 기록과 구분 |

최초 네트워크 조회는 sandbox 소켓 제한으로 실패했다. 허용된 네트워크 실행으로 동일한 읽기 요청을 재실행해 공개 여부/remote ref/npm 감사를 확인했으며 GitHub 인증을 우회하지 않았다.
