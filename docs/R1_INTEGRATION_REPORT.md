# R1 네이버·Gemini 연동 가능성 검증 보고서

검증일: 2026-09-11 (Asia/Seoul)

## 판정

| 연동 | 판정 | 다음 단계 |
| --- | --- | --- |
| 네이버 블로그 | 조건부 지원 가능 | R2 블록 원고를 만든 뒤 R5에서 별도 발행 어댑터로 제품화 |
| Gemini 소비자 계정 웹 로그인 | 보류 | 앱에 내장하지 않고 수동 결과 가져오기를 우선 검토 |

## 네이버 블로그

### 실제 확인 결과

- 티스토리와 분리된 `.local/naver-profile/` 전용 Chrome에서 사용자가 직접 로그인했다. 갱신 쿠키는 `.local/naver-auth.json`에만 저장하며 Git에서 제외한다.
- SmartEditor의 `mainFrame` 안에서 제목과 `문단 → 사진 → 캡션 → 문단 → 사진 → 캡션 → 문단` 순서를 입력했다.
- 합성 PNG 두 장을 화면의 사진 첨부 기능으로 올렸다. 첫 사진의 대표 표시, 캡션 두 개, 사용자 선택 카테고리 `강좌`를 저장 전에 확인했다.
- 공개 범위 기본값은 `전체공개`였다. 자동화가 `비공개` 라디오를 명시적으로 선택하고 실제 체크 상태를 확인한 뒤 한 번만 발행했다. 에디터의 `저장`은 임시저장이고 발행 창의 `발행`은 게시 동작으로 구분했다.
- 저장 직후 화면 전환 대기가 시간 초과했지만 중복 발행 방지 기록 때문에 다시 누르지 않았다. 현재 URL과 제목을 조회해 동일 글이 이미 생성됐음을 확인하고 결과를 복구했다.
- 저장된 글을 다시 열어 제목, 세 문단, 두 사진, 두 캡션, 교차 순서, `강좌`, `비공개` 표시를 확인했다.
- 쿠키가 없는 별도 브라우저 컨텍스트에서는 제목과 R1 식별자가 노출되지 않고 블로그 홈으로 돌아가 비공개 접근 차단을 확인했다.
- 로컬 증거는 `.local/r1-naver-publication.json`과 `.local/r1-naver-page.png`에 있으며 공개 Git에는 포함하지 않는다.

### 지원 조건과 경계

- 네이버의 현재 공식 API 목록에는 이 프로젝트에 필요한 완전한 글쓰기 API가 없어 화면 자동화가 필요하다. [네이버 Open API 목록](https://developers.naver.com/docs/common/openapiguide/apilist.md)
- SmartEditor 도움말은 별도 도구나 도우미 프로그램을 지원하지 않는다고 안내한다. 따라서 정식 어댑터도 네이버가 보장하는 연동으로 표시하지 않고, UI 변경 때 멈추는 조건부 기능으로 제공한다. [SmartEditor ONE 지원 환경](https://help.naver.com/service/5593/contents/15506)
- 사진은 공식 안내의 50장·총 100MB·지원 확장자 제한을 제품 검증 규칙에 반영한다. 대량 사진 성능 목표와 플랫폼 상한은 별도로 표시한다. [사진 첨부 안내](https://help.naver.com/service/5593/contents/15523)
- CAPTCHA나 추가 인증은 우회하지 않는다. 화면에서 감지하면 `needs_attention`으로 멈추고 사용자가 처리한 뒤 재개한다. [글쓰기 CAPTCHA 안내](https://help.naver.com/service/5593/contents/15411)
- 선택자 불일치, 업로드 수 불일치, 카테고리 또는 비공개 상태 불명확 시 발행 버튼을 누르지 않는다. 발행 요청 뒤 결과가 불명확하면 같은 원고를 재발행하지 않고 기존 글 조회만 허용한다.

## Gemini

### 실제 확인 결과

- 공식 Gemini CLI `0.59.0`을 임시로 고정해 별도 인증 폴더에서 Google 로그인을 완료했다.
- 로그인 후 서비스가 개인용 Gemini Code Assist 클라이언트 지원 종료와 Antigravity CLI 이전을 요구해 텍스트 생성 단계로 진행할 수 없었다.
- Google의 공식 공지는 소비자용 Gemini CLI를 2026-06-18에 종료하고 Antigravity CLI로 전환했다고 설명한다. [Google Developers Blog 공지](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)
- 공식 Antigravity CLI `1.2.1` Windows 바이너리를 내려받아 공개 SHA-256과 일치함을 확인하고 첫 실행의 약관·데이터 사용 선택 화면까지 확인했다. 선택적 데이터 공유에는 동의하지 않았고 실행을 종료했다.
- Antigravity headless 모드는 JSON 출력 등 기술적 자동화 기능을 제공한다. 그러나 소비자 약관은 제3자 소프트웨어·도구·서비스를 통한 서비스 접근 또는 비Google 제품과 함께 사용하는 행위를 제한한다. 이 로컬 웹앱과 배포판에 소비자 로그인을 연결하는 용도로 채택하지 않는다. [Antigravity headless 문서](https://antigravity.google/docs/cli/headless/) · [Antigravity 추가 약관](https://antigravity.google/terms)
- Gemini FAQ도 제3자 도구가 OAuth 인증을 가져다 쓰는 방식을 금지하며 제3자 통합에는 API 키나 Vertex AI를 안내한다. [Gemini CLI FAQ](https://geminicli.com/docs/resources/faq/)
- 임시 Gemini CLI 패키지는 제거했다. 인증 값, 토큰, CLI 홈과 다운로드 파일은 Git에 포함하지 않는다. 유료 API나 Vertex AI로 자동 전환하지 않았다.

### 판정 영향

- 현재 요구인 “Gemini 계정으로 웹 로그인해 앱에서 사용”은 정식 제품 연동으로 진행하지 않는다. 텍스트·사진·다중 이미지·원고 스키마·부분 재작성·문체 분석 실험은 정책 경계에서 중단했으므로 성공으로 기록하지 않는다.
- R4의 기존 완료 기준은 충족할 수 없다. 사용자가 나중에 별도 API 비용을 선택하면 Gemini API 또는 Vertex AI를 새 범위로 검토할 수 있다.
- 추가 결제 없이 진행하려면 앱이 프롬프트와 선택 사진 패키지를 내보내고 사용자가 공식 Gemini/Antigravity에서 만든 결과를 직접 가져오는 흐름이 대안이다.

## R2 이후 반영 사항

- R2의 블록 원고는 네이버에서 확인한 문단·사진·캡션 교차 순서를 원본으로 삼는다. 플랫폼별 카테고리 ID와 하위 카테고리 표시를 분리해 저장한다.
- 발행 대상마다 공개 범위를 명시하며 기본값은 비공개로 유지한다. 네이버는 화면 기본값이 전체공개이므로 저장 직전 실제 선택 상태를 반드시 다시 검사한다.
- R5 네이버 어댑터는 로그인 프로필, 카테고리 조회, 블록 입력, 대표 사진, 단일 발행 시도, 저장 결과 복구, 비로그인 검증을 각각 상태 단계로 둔다.
- R4는 소비자 Gemini 로그인 어댑터 구현 대신 수동 결과 가져오기 설계를 검토한다. ChatGPT 기반 기존 생성 기능은 그대로 유지한다.
