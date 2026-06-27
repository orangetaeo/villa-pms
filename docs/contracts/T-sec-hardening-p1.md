# 계약: T-sec-hardening-p1 — 보안 강화 에픽 P1

## 배경
docs/SECURITY-HARDENING-PLAN-2026-06-27.md의 P1 항목. P0(PR #104 머지) 후속. 권한 세분화·표준화·CSRF·프롬프트 인젝션·PII 보존.

## 범위 (wt/sec-p1 worktree, origin/main+P0 기준)
- **P1-S9 CSRF**: `lib/csrf.ts`(assertSameOrigin — Origin 있으면 동일출처만, 없으면 통과) + 공개 mutation 7라우트(/p hold·roster·service-orders, /g agreement·passport·service-orders·signature)
- **P1-S2 비밀번호 정책**: `lib/password-policy.ts`(isStrongPassword 8자+숫자/특수, BCRYPT_ROUNDS=12 일원화) → signup·account/password·reset-password·partner-signup·vendor-signup·users(생성)·users/[id](temp) 적용
- **P1-S1 RBAC**: 조사 결과 기존 게이트 적절(승인=canSetPrice, 신용변경=isSystemAdmin, self-role상향 차단=ASSIGNABLE 제외, confirm=ADR-0013 §6.1 의도). 무리한 차단 회피, 불변식은 P1-S7로 고정
- **P1-S3 PII 보존**: `lib/passport-retention.ts`(mtime 90일 경과 purge·멱등) + `/api/cron/cleanup-passports`(CRON_SECRET 게이트·PII_PURGE 기록)
- **P1-S10 프롬프트 인젝션**: `lib/gemini.ts` 번역 프롬프트에 구분자(<<<BEGIN>>>/<<<END>>>) + 인젝션 가드 지시(buildTranslatePrompt)
- **P1-S7 회귀 스위트**: `tests/security-invariants.test.ts`(①미게이트 mutation 없음+허용목록 ②토큰라우트 CSRF/rate-limit ③ASSIGNABLE 권한상승 차단 ④오픈 리다이렉트 없음)
- 테스트: csrf·password-policy·passport-retention·gemini-injection·security-invariants

## 완료 기준
- typecheck 0 · vitest 2119 통과(신규 22) · next build 통과 ✅
- CSRF: 교차출처 403, 동일출처·Origin없음 통과(서버간 무영향) ✅
- 비번: aaaaaaaa 거부, 라운드 12 일원화, temp 정책충족 ✅
- PII cron: 90일 경과만 삭제·멱등·디렉터리부재 무작업 ✅
- 프롬프트: 사용자텍스트 구분자 래핑+가드 지시 ✅
- 회귀 스위트: 미게이트 mutation/오픈리다이렉트/권한상승 0 ✅
- 독립 QA PASS, 사업원칙 누수 0

## 수정 금지 구역
- 없음(worktree 격리). DB 변경 없음(P1은 스키마 무변경).

## 후속
P1-S4(rate-limit 추상화)·S5(CSP enforce)·S6(로깅 위생)·S8(전면 가드 치환)=후속. P0-4(시크릿 스캔)=OPS.
