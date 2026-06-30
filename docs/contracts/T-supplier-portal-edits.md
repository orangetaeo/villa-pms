# T-supplier-portal-edits — 공급자 포털 개선 4종

테오 요청 묶음(빌라 공급자 화면).

## 범위
1. **(버그) 빌라 상세 헤더 겹침** — 자체 앱바가 있는 `/my-villas/` 하위 페이지에서 레이아웃 상단 트리오(PortalBrand·PortalAccountLink) 숨김. 탭바·언어전환 유지.
   - `components/supplier/tab-bar.tsx`(SUPPLIER_OWN_HEADER_PREFIXES export), `app/(supplier)/layout.tsx`
2. **공급자 정산서 보기** — `/earnings` 정산내역 탭에 정산서 PDF 버튼(운영자 발행 statementUrl 존재 시). GET 라우트는 이미 소유 공급자 허용.
   - `app/(supplier)/earnings/page.tsx`, `messages/{ko,vi}.json`(earnings.viewStatement·statementPending)
3. **빌라별 성과 페이지네이션** — StatsSection 빌라 리스트에 공용 PaginationBar(light).
   - `components/supplier/stats/stats-section.tsx`, `app/(supplier)/earnings/page.tsx`(page/pageSize 전달)
4. **이용 규칙 등 공급자 직접 입력·수정** — 공급자 전용 편집기 + API(별도, admin sales 라우트 미접촉).
   - 신규 `/my-villas/[id]/info`(라이트·vi) + `PATCH /api/villas/[id]/info`(SUPPLIER 본인 스코프, 이용규칙+위치/규모 필드만, AuditLog)
   - 등록 마법사에 이용규칙 step 추가
   - 공급자-편집 필드: checkInTime·checkOutTime·smoking/pets/party·parkingSlots·baseDepositVnd·extraBedAvailable + googleMapUrl·beachDistanceM·areaSqm·floors
   - 운영자 전용 유지: source(SUPPLIER/DIRECT)·features(마케팅)·요율/마진/판매가·승인상태·name/complex(빌라 신원)

## 수정 금지
- `app/(admin)/**`, `app/api/villas/[id]/sales/route.ts`(ADMIN sales 미접촉)
- 요율·마진·판매가·source 관련 일체

## 누수 가드
- 새 API 응답·페이지에 salePrice/margin/KRW 없음. 공급자 본인 villa(supplierId) 스코프 강제.

## 검증
typecheck/lint/build 0 + Playwright(공급자 로그인, 390px) 헤더·정산서·페이지네이션·규칙편집 실확인
