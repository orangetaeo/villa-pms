# T-signup-password-confirm — 회원가입 비밀번호 2회 입력

## 배경
사용자 요청(2026-07-16): 회원가입 시 비밀번호를 두 번 입력(확인 입력)하게 변경.
오타로 인한 잘못된 비밀번호 저장 → 로그인 실패 민원 방지.

## 범위
비밀번호를 입력받는 가입 폼 4종 전부에 "비밀번호 확인" 필드 추가:

| 폼 | 파일 | 검증 방식 |
|---|---|---|
| 공급자 | `app/(auth)/signup/SignupForm.tsx` | 서버 액션 (signupAction) |
| 청소원 | `app/(auth)/signup/CleanerSignupForm.tsx` | 서버 액션 (signupAction, 공유) |
| 파트너 | `app/(auth)/signup/PartnerSignupForm.tsx` | 클라 onSubmit → /api/partner-signup |
| 벤더 | `app/vendor-signup/VendorSignupForm.tsx` | 클라 onSubmit → /api/vendor-signup |

### 완료 기준 (테스트 가능)
1. 4개 폼 모두 비밀번호 아래에 "비밀번호 확인" 입력 존재 (동일 스타일: lock 아이콘 + 보기 토글은 기존 showPassword 상태 공유)
2. 불일치 시 제출 차단 + 현지화된 오류 메시지 표시
   - 서버 액션 폼(공급자·청소원): 클라 `setCustomValidity`(입력 시 재검증) + **서버 액션에도 불일치 검사 추가**(`passwordConfirm` 비교, error: `"passwordMismatch"`) — JS 미동작·우회 대비
   - fetch 폼(파트너·벤더): onSubmit에서 비교, `setError("passwordMismatch")`. API body는 변경하지 않음(passwordConfirm 미전송 — API 하위호환)
3. i18n: `passwordConfirm`, `passwordConfirmPlaceholder`, `errors.passwordMismatch` 키를 관련 네임스페이스(auth.signup / cleanerSignup / partnerSignup / vendorSignup)에 ko+vi 동시 추가, page.tsx 라벨 배선
4. `next build` 통과

## 수정 금지 구역
- `app/api/partner-signup/route.ts`, `app/api/vendor-signup/route.ts` (API 스키마 불변)
- 로그인 폼, 비밀번호 변경 화면 (범위 외)
- messages/ko.json·vi.json은 키 추가만

## 검증
- QA 에이전트(작성자 분리)가 diff 검토 + 폼 4종 검증 로직 확인
- next build 게이트
