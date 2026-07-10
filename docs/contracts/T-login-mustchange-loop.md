# T-login-mustchange-loop — 임시비밀번호 계정 로그인 무한 루프 수정

- 상태: 진행 (2026-07-10, 세션: login-loop-fix worktree)
- 심각도: **P0** — mustChangePassword=true인 모든 계정(임시비번 발급·관리자 생성 계정)이 프로덕션에서 로그인 불가
- 발단: 김태진(01081934171, OWNER 승격 직후) 로그인 시 "로그인 창만 계속 나온다" 신고

## 원인 (프로덕션 실측으로 확정)

1. 로그인 서버 액션이 `signIn("credentials", { redirectTo: "/" })`로 서버측 리다이렉트.
2. Next가 **같은 POST 요청 안에서** "/"를 내부 재디스패치 → 미들웨어의 임시비번 게이트가 "/"→"/account" 307.
3. 이 내부 재요청에는 **방금 발급된 세션 쿠키가 실리지 않음** → (admin) layout `auth()`=null → `redirect("/logout")` → 쿠키 전체 삭제 → /login. 무한 루프.
- 증거: 같은 세션 쿠키로 curl 실측 시 `GET /` → 307 `/account`, `GET /account` → **200 정상**. 브라우저 서버액션 경로에서만 실패. `mustChangePassword=false`로 바꾸면 동일 계정 정상 로그인(대조군).

## 수정 범위 (이 파일 외 2개만)

- `app/(auth)/login/actions.ts` — `redirect: false` + 성공 시 `{ success: true }` 반환. 서버측 리다이렉트 체인 제거.
- `app/(auth)/login/LoginForm.tsx` — `state.success` 시 `window.location.href = "/"` (기존 패스키 로그인과 동일 패턴). 성공 후 버튼 잠금 유지.

## 완료 기준 (QA)

- [ ] mustChangePassword=true 테스트 계정(01000000099)으로 프로덕션 로그인 → **/account 비밀번호 변경 화면 도달**
- [ ] mustChangePassword=false 일반 로그인 → /dashboard 정상 (회귀 없음)
- [ ] 잘못된 비밀번호 → 오류 문구 표시 (회귀 없음)
- [ ] 검증 후 테스트 계정 삭제

## 수정 금지 구역

- middleware.ts, auth.ts (원인 아님 — 게이트·세션 로직은 정상)
