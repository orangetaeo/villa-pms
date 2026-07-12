# 계약: 부가서비스 공급자 메뉴 이동 — 설정 박스 제거 → 사이드바 부가서비스 그룹 (vendors-nav-relocation)

- 상태: 착수 (2026-07-12)
- 담당: 메인 세션(설계·검증) + FE 서브에이전트

## 배경 (테오 지시)

설정 페이지의 "부가서비스 공급자 관리" 박스를 없애고, 그 페이지를 사이드바 **부가서비스 카테고리의
"부가서비스 정산" 아래** 메뉴로 넣는다.

## 범위

1. `components/admin/sidebar.tsx` — addon 그룹 serviceOrders 항목 **아래**에 vendors 항목 추가
   (`/settings/vendors`, icon storefront, cap 없음=전 운영자 — 현행 설정 박스 접근성과 동일). URL은 유지(링크 참조처 다수).
2. `app/(admin)/settings/page.tsx` — Card 6c(부가서비스 공급자) 박스 + 관련 주석 제거.
3. `components/tour/tour-definitions.ts` — 제거되는 앵커 `settings-sub` 스텝 삭제 + 해당 코치마크
   i18n 키(adminSettings.sub) ko·vi 동시 삭제 (data-tour 변경 시 tour-definitions+NS 동시갱신 규칙).
4. vendors 페이지의 "설정으로 돌아가기" 백링크 제거(이제 설정 하위 동선이 아님).
5. i18n: `nav.vendors` ko·vi 추가, 미사용이 된 설정 박스 키(vendorsCard*) ko·vi 삭제.

## 완료 기준

- 설정 페이지에 공급자 박스 없음, 사이드바 부가서비스 그룹에서 정산 아래 "부가서비스 공급자" 진입 가능
- 투어 정의에 죽은 앵커 없음, ko/vi 키 패리티 유지, tsc 0 + next build 통과

## 수정 금지 구역

- 다른 계약서 진행 중 파일. messages/*.json은 본 계약 키만.
