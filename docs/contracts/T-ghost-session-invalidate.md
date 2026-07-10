# T-ghost-session-invalidate — 삭제·비활성 계정 유령 세션 무효화

- 상태: **완료** (2026-07-10, PR #219 머지·배포 8d29d89·프로덕션 E2E PASS)
- 심각도: **P0** — 하드 삭제된 계정의 JWT 세션이 최대 7일간 유효. 화면·조회는 전부 열리고, 감사로그가 걸린 모든 변경 API(빌라 승인 등)는 `AuditLog_userId_fkey` FK 위반 500으로 실패.
- 발단: 김태진 신고 "5678 빌라 승인 버튼을 눌러도 승인이 안 된다" — 구 계정(0702635421, 오늘 하드 삭제)의 세션이 기기에 남아 있었음. 06:57~07:00 승인 시도 전부 P2003 롤백(라이브 로그 실측), 07:00:33 테오 계정 승인 성공.

## 원인

`auth.ts` jwt 콜백의 서버측 세션 무효화(보안 P0-5②)가 **passwordChangedAt만** 재확인. 사용자 행이 아예 없으면(`u === null`) dbMs=null→0 처리되어 오히려 "유효"로 통과 — 삭제된 계정 세션이 영원히 살아남는다. isActive=false·소프트삭제(deletedAt)도 동일하게 기존 세션이 유지됨(로그인만 차단).

## 수정 범위 (이 파일 외 1개만)

- `auth.ts` — pwd 재확인 조회 select에 `isActive`·`deletedAt` 추가, `!u || !u.isActive || u.deletedAt`이면 두 분기(그랜드파더 포함) 모두 `return null`(세션 무효). 재확인 주기(60초) 내 차단.

## 완료 기준 (QA)

- [x] 테스트 계정(01000000098) 로그인 → 세션 살아있는 채 하드 삭제 → 70초 후 /villas 접근 시 /login 강제 로그아웃 (프로덕션 실측 PASS)
- [x] 정상 계정 로그인·/dashboard 탐색 회귀 없음 (배포 후 실측)
- [x] tsc·next build 통과

## 수정 금지 구역

- middleware.ts, app/api/villas/[id]/route.ts (감사로그 트랜잭션 원자성은 의도된 설계 — 변경하지 않음)
