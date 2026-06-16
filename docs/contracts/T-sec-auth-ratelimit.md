# 계약: T-sec-auth-ratelimit — 인증 무차별 대입·가입 스팸 방어 (Phase 1 보안)

## 배경
Phase 1 보안 점검: 로그인(`authorize`)·자가 가입(`signupAction`)에 **rate limiting 전무** →
무차별 대입(brute force)·크리덴셜 스터핑·자동 계정 스팸에 노출. 비밀번호는 bcrypt(12)지만
시도 횟수 제한이 없어 온라인 공격이 가능.

권한 누수 전수(T4.1)와는 다른 보안 차원(인증 하드닝)이라 무중복.

## 범위 (수정 파일 — 이 세션 전용)
- `lib/rate-limit.ts` (신규) — 인메모리 슬라이딩 윈도우 리미터(now 주입 가능, 순수) + `clientIp(headers)`
- `lib/rate-limit.test.ts` (신규) — vitest
- `auth.ts` (수정) — authorize에 전화번호·IP 윈도우 검사. 한도 초과 시 bcrypt 생략 후 null 반환(잠금), 성공 시 카운터 리셋
- `app/(auth)/signup/actions.ts` (수정) — IP당 가입 한도, 초과 시 기존 `serverError` 코드 반환(신규 i18n 키 불요 — messages 핫 회피)
- `docs/contracts/T-sec-auth-ratelimit.md`(본 파일)

## 수정 금지 구역 (다른 세션 점유 — 무접촉)
- next.config.ts·package.json·schema.prisma·railway.toml·messages/*.json·(admin)/layout.tsx·(admin)/settings/page.tsx·lib/cleaning·hold·proposal·lib/zalo-*·instrumentation.ts·app/api/zalo/* (Zalo 인프라 세션)
- HTTP 보안 헤더(next.config.ts headers)는 해당 파일 점유로 **본 계약 제외** — 점유 해소 후 별도 태스크

## 한도(기본값)
- 로그인/전화번호: 10분당 5회, 로그인/IP: 10분당 20회 → 초과 시 null(잠금), 성공 시 phone 키 리셋
- 가입/IP: 1시간당 5회 → 초과 시 serverError

## 완료 기준 (테스트 가능)
1. lib/rate-limit.ts: 윈도우 내 max 초과 시 allowed=false·retryAfterMs>0, 윈도우 경과 후 회복, resetRateLimit 동작 — now 주입 결정적 테스트
2. clientIp: x-forwarded-for 첫 IP 추출·x-real-ip 폴백·없으면 null
3. 로그인: 동일 전화번호 6번째 시도부터 bcrypt 호출 없이 차단(잠금), 성공 시 카운터 리셋 — 코드 경로 확인
4. 가입: 동일 IP 6번째부터 serverError, 정상 계정 생성 경로 무변경
5. `npx vitest run lib/rate-limit.test.ts` 통과, `npm run typecheck` 내 파일 0
6. 기존 로그인·가입 정상 흐름 회귀 0(한도 내)

## 한계(명시)
- 인메모리 — Railway 단일 인스턴스 가정. 다중 인스턴스 확장 시 Redis 등 공유 스토어 필요(주석·후속 백로그).

## 검증
- vitest(윈도우·리셋·IP 파싱), typecheck, 코드 경로 점검
- 후속 QA 독립 평가
