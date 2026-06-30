# Contract: T-account-unify — 라이트 포털 4종 계정/프로필 화면 통일

## 배경
빌라공급자(SUPPLIER)·여행사(PARTNER)·청소(CLEANER)·원천공급자(VENDOR) 4개 포털의
"회원정보(계정)" 화면이 제각각. 핵심(비번변경+로그인정보+로그아웃)이 공통인데:
- `(supplier)/profile`·`vendor/profile`이 ~90% 복붙 (계정/로그아웃 섹션 i18n 네임스페이스마저 `account.*` vs `vendor.accountSection.*`로 이원화)
- AccountLink 컴포넌트 2벌 중복 (`supplier/account-link`·`vendor/vendor-account-link`)
- PARTNER는 계정 화면이 아예 없음 (승인된 파트너는 비번변경 진입점 부재, 승인대기 화면만 공급자 `/profile`로 우회)

## 범위 (수정하는 파일)
- 신규: `components/account/account-screen.tsx` (공유 계정 화면 셸)
- 신규: `components/account/portal-account-link.tsx` (href 파라미터화 통합 진입 버튼)
- 신규: `app/partner/profile/page.tsx` (파트너 계정 화면)
- 수정: `app/(supplier)/profile/page.tsx`, `app/vendor/profile/page.tsx` → AccountScreen 호출로 축약
- 수정: `app/(supplier)/layout.tsx`, `app/vendor/layout.tsx` → 통합 AccountLink 사용
- 수정: `app/partner/layout.tsx` → 계정 아이콘 추가 + 클라 네임스페이스에 `account` 추가, ApprovalGate 링크 `/partner/profile`로
- 수정: `components/supplier/account-link.tsx`·`components/vendor/vendor-account-link.tsx` → 통합 컴포넌트 재노출(또는 제거 후 참조 교체)
- 수정: `messages/ko.json`·`vi.json` → `vendor.accountSection.*` 제거 (account.* 단일화). 키 추가만/제거만, 다른 섹션 무변경.

## 수정 금지 구역
- prisma/* (타 세션 seed 작업물)
- 운영자(admin) 계정 화면 `app/(admin)/account/page.tsx` (다크 테마 별도 유지 — 변경 안 함)
- 각 포털의 비즈니스 데이터 화면(my-villas/orders/proposals/receivables/stats/earnings)

## 완료 기준 (테스트 가능)
1. SUPPLIER·CLEANER·VENDOR·PARTNER 4종 모두 동일 구조의 계정 화면(비번변경+로그아웃) 보유
2. VENDOR는 지급정보 슬롯 + 강제변경 안내 유지, 강제변경시 뒤로/지급정보 숨김 동작 보존
3. PARTNER 헤더에 계정 진입 + `/partner/profile` 도달, 승인대기 화면 링크도 `/partner/profile`
4. 누수 0: 각 레이아웃 클라 직렬화 네임스페이스에 admin/marginal 키 미포함 (account만 추가)
5. `npm run typecheck` · `npm run lint` · `npm run build` 0 에러
6. 독립 QA: 4개 역할 로그인 → 계정 화면 비번변경/로그아웃 동작, 마진·판매가 비노출 확인

## 검증 방법
typecheck/lint/build + Playwright 프로덕션(배포 후) 4역할 워크스루
