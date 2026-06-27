# 계약: T-sec-hardening-p1b — 보안 강화 에픽 P1 후속(S4·S5·S6·S8조사)

## 배경
docs/SECURITY-HARDENING-PLAN-2026-06-27.md P1 잔여. P0(#104)·P1(#106) 머지 후속.

## 범위 (wt/sec-p1b, origin/main 기준)
- **P1-S4 rate-limit 추상화**: `lib/rate-limit.ts` — `RateLimitStore` 인터페이스 + `MemoryRateLimitStore`(기본) + `setRateLimitStore()`(후속 Redis 주입점). 동작 보존(호출부·전 테스트 무변경). 런북 `docs/ops/rate-limit-lockout.md`
- **P1-S6 로깅 위생**: 점검 결과 **이미 위생적**(시크릿·해시·평문비번 console 로깅 0건, 클라 응답은 타입 도메인 에러 메시지·스택 미노출). 회귀 테스트 추가(security-invariants 불변식 4)
- **P1-S5 CSP 집계**: `/api/csp-report`가 위반을 SecurityEvent(`CSP_REPORT`)에 영속(디렉티브·차단호스트·문서경로만, 원문·쿼리 미저장). `lib/csp-report.ts` 파서(2포맷). 전환 런북 `docs/ops/csp-enforce-transition.md`. **enforce 플립은 관찰 후(보류)**
- **P1-S8 조사**: `role === "ADMIN"` 직접비교 잔존 = 주석 1건뿐(S-RBAC가 이미 capability 헬퍼로 전면 치환 완료). 중앙 헬퍼 전면 치환(98라우트)은 churn·회귀 위험으로 **보류**
- 테스트: rate-limit-store·csp-report + security-invariants 확장

## 완료 기준
- typecheck 0 · vitest 2127 통과(신규 8+불변식1) · build 통과 ✅
- rate-limit: 기존 9테스트 + 추상화 위임 검증, 동작 보존 ✅
- CSP: 파서가 쿼리(PII·토큰) 제외, 2포맷 추출, SecurityEvent 영속 ✅
- 로깅: 시크릿/해시 console 0건 + 회귀 차단 ✅

## 보류(문서화) — 위험·관찰 필요
- **P0-5②** 타디바이스 세션 무효화(passwordChangedAt): jwt 콜백 per-request DB조회 성능·락아웃 위험 → 별도 신중 작업
- **P1-S8 전면 치환**: 98라우트 중앙 헬퍼 치환은 회귀 위험 → 헬퍼·회귀테스트 안정 후 점진
- **P1-S5 enforce 플립**·**P1-S4 Redis 구현**: 각각 관찰·스케일아웃 결정 후
- **P0-4** 시크릿 git히스토리 스캔·교체 = OPS
