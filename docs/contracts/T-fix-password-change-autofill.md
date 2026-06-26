# 계약서: 비밀번호 변경 화면 자동완성 오발송 수정 (T-fix-password-change-autofill)

## 배경 (QA 재현 완료, 2026-06-25)
- 증상: 임시 비번으로 로그인 직후 /profile(공급자)·/account(운영자) 비밀번호 변경에서
  "현재 비밀번호가 올바르지 않습니다"(WRONG_PASSWORD) 발생.
- 프로덕션 재현 결과: 임시 비번 로그인 성공 + 변경 API 200 성공 → **백엔드·해시·세션 정상**.
- 근본 원인: 브라우저가 도메인에 저장해 둔 옛 비밀번호를 "현재 비밀번호" 칸에
  autofill → 화면엔 점으로 보이나 옛(무효) 비번이 전송됨 → WRONG_PASSWORD.
  (에러가 PASSWORD_TOO_SHORT 아닌 WRONG_PASSWORD인 점이 '비어있지 않은 틀린 값' 전송을 입증)

## 범위 (수정 파일)
- `components/account/change-password-form.tsx` 만 수정 (admin·supplier 공용 폼)

## 완료 기준 (테스트 가능)
1. "현재 비밀번호" 입력에 `autoComplete="off"` — 저장된 옛 비번 자동완성 차단
2. "현재 비밀번호" 칸에 보기(👁) 토글 추가 (로그인 폼과 동일 material-symbols 아이콘),
   사용자가 칸에 든 값을 눈으로 확인 가능
3. admin(다크)·supplier(라이트 vi) 두 variant 모두 레이아웃 깨짐 없음
4. `npm run build` 통과 (배포 게이트)
5. 정상 임시 비번 입력 시 변경 200 성공 (기존 동작 회귀 없음)

## 수정 금지 구역
- 백엔드(app/api/account/password/route.ts, auth.ts) 변경 없음 — 로직 정상 확인됨
- 다른 세션 작업 파일 일절 미접촉

## 검증 방법
- 빌드 + Playwright 프로덕션 재배포 후 재현 시나리오 재실행(QA)
