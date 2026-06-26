# 계약: 사용자관리 ↔ 파트너관리 상호 연결 (엔티티≠계정)

## 배경
ADR-0028로 파트너(여행사·랜드사)가 로그인 계정(Role=PARTNER, `Partner.userId` 선택적 1:1, ServiceVendor 동형)을
갖게 되며, 같은 현실 주체가 **/users**(로그인 계정)와 **/partners**(B2B 엔티티: 여신·미수·승인) 두 화면에
나뉘어 나타난다. 운영자는 두 화면을 오가며 봐야 해 혼란.

## 결정 (테오 2026-06-26)
**화면을 합치지 않는다(엔티티≠계정 분리 유지) — 대신 상호 연결.** Partner(B2B 재무)와 User(인증/신원)는
다른 관심사이고 파트너는 로그인 없이 운영자만 관리할 수도 있어야 함(`userId` nullable). 전체 병합은 두 관심사를
결합·비대화시키므로 부적합. → 양방향 링크 + 계정 상태 노출.

## 범위 (전부 additive — 스키마·권한·라이브 로직 무변경)
1. **/users → 엔티티 링크**
   - `users/page.tsx`: select에 `partnerAccount{id}`·`vendorAccount{id}` 추가 → UserRow에 partnerId·vendorId.
   - `users-manager.tsx`: PARTNER 행 → `/partners/[id]`, VENDOR 행 → `/settings/vendors` 링크(이름 아래 작은 링크).
2. **/users 딥링크 탭**: `?role=PARTNER|VENDOR|SUPPLIER|CLEANER` → 해당 탭으로 시작(searchParams→initialTab).
3. **/partners → 계정 상태 + 링크**
   - `partners/page.tsx`: 연결 userId들의 `isActive` 보조 조회 → `accountActiveByUserId` map 전달.
   - `partners-manager.tsx`: 기존 "계정 있음" 배지를 **활성/비활성 색 구분 + `/users?role=PARTNER` 링크**로 교체.
   - `partners/[id]/page.tsx`+`partner-detail.tsx`: "로그인 계정" 패널(계정명·전화·활성/비활성·사용자관리 링크, 없으면 안내).
4. i18n ko/vi: `adminUsers.entityLink.{partner,vendor}` + `adminPartners.{accountActive,accountInactive,accountNone,viewInUsers,loginAccountTitle}`.

## 수정 금지 구역
- 스키마·권한(canViewFinance/canSetPrice 게이트 재사용)·승인 플로우(PP4)·여신/채권 로직 — 무변경.
- 마진·재고 비공개 불변(추가 노출 없음 — 계정 활성/이름/전화는 운영자 화면 한정).

## 완료 기준
1. /users PARTNER 행 → 해당 /partners/[id]로 점프(partnerId 연결), VENDOR 행 → /settings/vendors ✅
2. /partners 목록 계정 배지 = 활성/비활성 색 구분 + 클릭 시 /users PARTNER 탭 ✅
3. /partners/[id] "로그인 계정" 패널: 연결 시 상태+이름+링크 / 미연결 시 "운영자 관리" 안내 ✅
4. /partners → /users?role=PARTNER 진입 시 PARTNER 탭으로 시작 ✅
5. typecheck 0 · lint 0(에러) · vitest 전체 통과 · next build 성공 ✅
6. 누수 0 — 추가 노출 필드 없음(계정 활성/이름/전화는 ADMIN 화면 한정, canViewFinance 게이트 유지)
