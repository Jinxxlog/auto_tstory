# 프로젝트 작업 지침

- 작업을 시작하기 전에 `PROJECT_PLAN.md`를 읽고 현재 상태, 결정 사항, 다음 작업을 확인한다.
- 작업이 끝나면 `PROJECT_PLAN.md`의 현재 상태, 단계별 체크리스트, 검증 결과, 작업 기록, 다음 작업을 실제 결과에 맞게 갱신한다.
- 계획과 구현 완료를 구분한다. 실행하지 않은 검증이나 실제로 성공하지 않은 티스토리 동작을 성공으로 기록하지 않는다.
- 설계를 변경하면 이유와 영향을 결정 기록에 남긴다. 사용자 지시가 이 문서나 계획보다 우선한다.
- 티스토리 로그인 상태, 쿠키, API 키, 실제 사용자 원본 자료를 Git이나 일반 로그에 포함하지 않는다.
- 현재 개발 범위와 발행 모드는 `PROJECT_PLAN.md`를 따른다. 초기 검증은 비공개 테스트 글 기준이다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
