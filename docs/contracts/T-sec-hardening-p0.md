# 계약: T-sec-hardening-p0 — 보안 강화 에픽 P0 (출시 차단급)

## 배경
docs/SECURITY-HARDENING-PLAN-2026-06-27.md(정본)의 P0 항목 구현. 전수 보안점검(5영역+인젝션·외부공격 심층)에서 적발된 출시 차단급 갭과 구조적 보안 컴포넌트.

## 범위 (이 세션 — wt/sec-hardening worktree 격리)
- **P0-7 CSV 수식 인젝션**: `lib/csv.ts`(신규, csvCell 수식 prefix `=+-@\t\r` 무력화) + `app/api/revenue/export/route.ts`(로컬 csvCell→공용 치환)
- **P0-8 iCal SSRF**: `lib/ssrf-guard.ts`(신규, 내부IP·DNS리바인딩·리다이렉트 홉 재검증) + `lib/ical.ts`(fetchIcsText→safeFetch)
- **P0-1 SecurityEvent 감사채널**: `prisma/schema.prisma`(model SecurityEvent 추가) + `prisma/security-event-table.sql`(라이브 additive 적용) + `lib/security-event.ts`(신규, fire-and-forget·meta redaction) + `auth.ts`(로그인 실패/성공/rate-limit 기록)
- **P0-6 중앙 가드헬퍼**: `lib/api-guard.ts`(신규, requireAuth/requireCapability/notFoundIfMissing)
- **P0-3 게스트 rate-limit**: `lib/guest-rate-limit.ts`(신규) + `app/api/g/[token]/{agreement,passport,service-orders,signature}/route.ts`(4종 적용)
- **P0-5① 세션·쿠키**: `auth.ts`(httpOnly·sameSite·secure·maxAge 명시)
- **P0-2 Zalo salt**: `lib/zalo-credentials.ts`(레코드별 무작위 salt + 레거시 3세그먼트 폴백)
- 테스트: `lib/{csv,ssrf-guard,security-event,api-guard,guest-rate-limit,zalo-credentials}.test.ts`

## 완료 기준 (테스트 가능)
- typecheck 0 에러 / 전체 vitest 통과(2097+) / next build 통과 ✅
- SSRF: 169.254.169.254·내부대역(IPv4/IPv6/매핑)·리다이렉트 우회 차단, 공인 오탐 0 ✅
- CSV: 수식 prefix 셀 무력화, 공용 헬퍼 단일화 ✅
- SecurityEvent: 라이브 테이블 CRUD 검증, recordSecurityEvent throw 안 함, meta 민감값 redaction ✅
- 게스트 4종 rate-limit 토큰 추출 직후 적용, 업로드 저한도 ✅
- Zalo: 신형 왕복 + 레거시 폴백 복호화(봇 블랙아웃 0) ✅
- 독립 QA PASS(작성자≠평가자), 사업원칙 누수 0 ✅

## 수정 금지 구역
- 다른 세션 점유 영역 없음(worktree 격리, origin/main 기준 단독). 공유 Neon은 additive CREATE TABLE IF NOT EXISTS만(비파괴).

## 후속(이 계약 밖)
- SSRF IPv6 hex-매핑·fec0 보강은 본 PR에 포함(QA 적발 즉시 반영).
- P0-4(시크릿 히스토리 스캔·교체)=OPS, P0-5②(타디바이스 세션 무효화)=P1, P1-S8(전면 가드 치환)·P1-S9(CSRF)·P1-S10(프롬프트 인젝션) 등은 후속.
