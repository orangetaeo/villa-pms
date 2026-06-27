# 계약: P0-5② 서버측 세션 무효화 (비밀번호 변경 시 타 디바이스 세션 무효화)

> 보안 강화 에픽 잔여 항목. 정본 docs/SECURITY-HARDENING-PLAN-2026-06-27.md §3 P0-5②.
> worktree: `wt/sec-session-invalidation`. 작성자=BE(오케스트레이터), 평가자=QA(분리).

## 배경·문제

현재 비밀번호 변경 시 무효화는 클라이언트 `signOut()`(현재 디바이스)만 처리한다. **진짜 갭:**
(a) 클라 `signOut()`은 신뢰 불가(악성/오작동 클라가 호출 안 하면 그만),
(b) **탈취된 타 디바이스 세션은 비밀번호 변경 후에도 JWT maxAge(7일)까지 유효.**

## 범위 (in scope)

1. **스키마(additive):** `User.passwordChangedAt DateTime?` 추가. 라이브 Neon은 raw SQL `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`(prisma db push 금지, 드리프트 방지).
2. **비번 변경 3경로에서 `passwordChangedAt = now()` 갱신** (기존 사용자 비번 교체 = 세션 무효화 트리거):
   - `app/api/account/password/route.ts` (본인 self 변경)
   - `app/api/users/[id]/route.ts` RESET_PASSWORD (운영자 초기화)
   - `app/api/auth/reset-password/route.ts` (Zalo 코드 자가재설정)
   - (계정 *생성* 경로 vendor/signup/users-create는 기존 세션 없음 → 범위 밖)
3. **`auth.ts` JWT 콜백 서버측 무효화:**
   - 로그인 시 `token.pwdAt = passwordChangedAt(ms) ?? 0` 저장.
   - 후속 요청(스로틀 60초)마다 DB `passwordChangedAt` 재조회 → 토큰 발급 baseline보다 **새로우면 `null` 반환(세션 무효)**.
   - **그랜드파더:** 본 기능 이전 발급된 토큰(`token.pwdAt` 없음)은 무효화하지 않고 현재 baseline 채택(1회).
4. **순수 헬퍼 `lib/session-invalidation.ts`** — `isPasswordSessionStale()`·`shouldRecheckPassword()` (단위 테스트 가능하게 분리).
5. **회귀 불변식** — tests에 "비번 변경 → 타 디바이스 토큰 stale" 단위 테스트.

## 테스트 가능한 완료 기준

- [ ] `isPasswordSessionStale(tokenPwdAt, dbMs)`: tokenPwdAt undefined → false(그랜드파더); dbMs > tokenPwdAt → true; dbMs ≤ tokenPwdAt 또는 null → false.
- [ ] `shouldRecheckPassword(lastCk, now)`: undefined → true; now-lastCk ≥ 60s → true; 미만 → false.
- [ ] 3개 비번 변경 경로의 `update.data`에 `passwordChangedAt: new Date()` 포함(grep 검증).
- [ ] auth.ts JWT 콜백: 로그인 시 pwdAt 저장, 후속 stale 시 null 반환, 그랜드파더 무효화 안 함.
- [ ] **누수 0:** passwordChangedAt이 공급자/게스트/공개 응답 select에 노출 안 됨(원래 User select 화이트리스트 유지).
- [ ] typecheck 0, 기존 보안 회귀 스위트 통과, build 통과.

## 검증 방법

- 단위 테스트(헬퍼 + 3경로 grep) `npm run test`.
- typecheck + build.
- QA 독립 평가(작성자≠평가자): 누수·락아웃(그랜드파더·null 처리)·throttle 경계.

## 수정 금지 구역

- 다른 세션 작업 파일 없음(git status 확인). 공유 파일은 schema.prisma(이 세션 전담 additive 1줄), auth.ts(이 작업 전용).

## 마이그레이션

- additive nullable 컬럼 1개. 라이브 적용 = `prisma/add-password-changed-at.ts`(IF NOT EXISTS, 멱등). 구코드 무영향(select 미참조).
