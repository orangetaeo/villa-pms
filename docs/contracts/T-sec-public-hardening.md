# 계약: T-sec-public-hardening — 공개 표면 하드닝 (Phase 1 보안)

## 배경
Phase 1 보안 2차. ① 공개 가예약(HOLD) 엔드포인트가 **미인증·DB 트랜잭션**인데 rate limit 없음
→ 요청 폭주(DoS·로그 스팸) 위험. ② HTTP 보안 헤더 전무 → 클릭재킹·MIME 스니핑·**토큰 referrer 누수**
(공개 제안 URL의 token이 외부 링크 클릭 시 Referer로 유출) 위험.

권한 누수(T4.1)·인증 rate limit(T4.8)과 다른 표면. next.config.ts는 현재 clean(Zalo 세션 커밋 완료).

## 범위 (수정 파일 — 이 세션 전용)
- `next.config.ts` (수정·**headers() 추가만**) — 보안 헤더 5종(HSTS·nosniff·X-Frame-Options SAMEORIGIN·Referrer-Policy·X-DNS-Prefetch-Control). 기존 images·serverExternalPackages 무변경
- `app/api/p/[token]/hold/route.ts` (수정) — 처리 전 토큰+IP rate limit(lib/rate-limit 재사용). 초과 시 429
- `docs/contracts/T-sec-public-hardening.md`(본 파일), `TASKS.md`(T4.8 백로그 행 갱신 또는 신규 1줄)

## 수정 금지 구역 (다른 세션 점유 — 무접촉)
- lib/hold.ts·cleaning·proposal·zalo-*·schema.prisma·messages·package.json·railway.toml·(admin)/layout·settings/page·instrumentation.ts·app/api/zalo/* (Zalo·QA 세션)
- lib/rate-limit.ts·auth.ts는 **import/재사용만**(T4.8 완료분, 무수정)

## 보안 헤더 (보수적 — 앱 동작 무영향, CSP는 본 패스 제외)
- Strict-Transport-Security: max-age=63072000; includeSubDomains  (Railway HTTPS)
- X-Content-Type-Options: nosniff
- X-Frame-Options: SAMEORIGIN  (클릭재킹)
- Referrer-Policy: strict-origin-when-cross-origin  (제안 token 외부 referrer 누수 차단 — 핵심)
- X-DNS-Prefetch-Control: off

## HOLD rate limit
- 토큰당 15회/10분(경로값 — 스푸핑 불가, 1차) + IP당 30회/10분(best-effort). 초과 시 429 `{error:"too_many_requests"}`
- 참고: 제안 ACTIVE→USED 가드로 토큰당 성공 HOLD는 1건 — 본 제한은 폭주/플러드 완화 목적

## 완료 기준
1. `/manifest.webmanifest` 등 모든 응답에 보안 헤더 5종 부착(헤더 정의 확인)
2. HOLD: 토큰/IP 한도 초과 시 429, 한도 내 정상 흐름·기존 검증·교차토큰 차단 회귀 0
3. Referrer-Policy로 제안 token referrer 미노출 정책 적용
4. `npm run typecheck` 내 파일 0, 기존 HOLD 동작 회귀 0
5. CSP는 본 패스 제외(인라인/CDN 호환성 검증 필요 — 후속)

## 검증
- next.config 헤더 정의 점검, HOLD 라우트 한도 코드 경로, typecheck
- 후속 QA 독립 평가
