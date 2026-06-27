# 계약: P1-S8 중앙 가드 헬퍼 전면 치환 + 인증 누락 정적 검사

> 보안 강화 에픽 잔여. 정본 docs/SECURITY-HARDENING-PLAN-2026-06-27.md §4 P1-S8.
> worktree: `wt/sec-guard-replace`(origin/main #115 포함). 작성자=BE, 평가자=QA(분리).

## 배경

lib/api-guard.ts(requireAuth/requireCapability, P0-6 #104)가 존재하나 **실제 채택 라우트 0개**(테스트만 import). 96개 mutation 라우트가 수작업 `auth()`+401+capability 검사 반복 → 신규 라우트 누락 위험.

## 범위 (in scope)

1. **인증 mutation 라우트 94개를 헬퍼로 치환** — **기존 capability 검사를 1:1 번역(의미 보존)**:
   - `const session = await auth(); if(!session) 401; if(!CAPFN(session.user.role)) 403`
     → `const g = await requireCapability(CAPFN, "CAPFN", req); if(!g.ok) return g.response; const session = g.session;`
   - 로그인만: `requireAuth(req)`.
   - **핸들러 본문은 무변경**(`const session = g.session`로 기존 session 참조 보존). CARE 라우트(SUPPLIER 스코프·소유권·응답필터·상태전이·LEDGER)의 본문 로직 절대 손대지 않음.
   - SUPPLIER/VENDOR 역할 직접검사 라우트(6개)는 requireAuth로 바꾸고 기존 role 검사 유지(전용 capability fn 없음).
   - **어떤 권한이 필요한지 재판단 금지** — 기존 코드의 capability를 그대로. (RBAC 정밀화는 P1-S1에서 완료)
2. **정적 누락검사 테스트** `tests/mutation-route-guard.test.ts` — app/api/**/route.ts의 모든 POST/PUT/PATCH/DELETE export 파일이 (a) requireAuth/requireCapability 사용 OR (b) 공개 화이트리스트(아래) 중 하나임을 강제. 신규 무가드 라우트 차단.
3. **공개 화이트리스트(24)**: /api/cron/*(8, CRON_SECRET), /api/g/*·/api/p/*(게스트·제안 토큰), /api/auth/forgot-password·reset-password, /api/vendor-signup·partner-signup, /api/csp-report, /api/zalo/ext/*(webhook HMAC), /api/locale(선택적 auth).

## 테스트 가능한 완료 기준

- [ ] 인증 mutation 라우트 100% requireAuth/requireCapability 경유(grep: 화이트리스트 외 raw `auth()` 0).
- [ ] 정적 누락검사 테스트 통과(의도적 무가드 라우트 주입 시 실패 = 공허통과 방지).
- [ ] **capability 매핑 무변경** — 치환 전후 각 라우트의 요구 권한 동일(QA가 인벤토리표와 대조).
- [ ] typecheck 0, 전체 vitest 통과, build 통과.
- [ ] 누수 0(응답 필터·SUPPLIER 스코프 등 본문 로직 회귀 없음).

## 검증 방법

- typecheck + 전체 vitest + build.
- QA 독립 평가: 인벤토리표 대조(권한 변경 0)·CARE 라우트 본문 무변경·공개 화이트리스트 정확성·정적테스트 공허통과 여부.

## 수정 금지 구역

- 다른 세션 작업 없음. 이 세션이 app/api/** mutation 라우트 + lib/api-guard.ts(무변경 예정) + tests/ 전담.

## 마이그레이션

- 없음(코드 표준화만).
