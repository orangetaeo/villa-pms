# 계약서 — 게스트 셀프 체크인 + 부가서비스 판매 + 미니바 실재고

- 근거: ADR-0019, SPEC F8/F9
- 스키마 마이그레이션 스펙(turn-key SQL+Prisma): `docs/contracts/T-guest-checkin-and-inventory-schema.md`
- 상태: **합의 대기** (구현 전 QA 합의 필수 — "합의 전 코딩 금지")
- 수정 금지 구역: 타 세션 진행 중인 정산(`lib/settlement*`, `app/(admin)/settlements/`)·Zalo 통합 파일은 건드리지 않음. 본 작업은 신규 파일 위주 + 명시적 additive 확장만.

## 범위 (4 스프린트)

### S1 — 미니바 실재고 + 입고/원가 UI
- 스키마(raw SQL ALTER): `VillaMinibarStock.onHandQty`, `MinibarStockMovement` + `MinibarMovementType` enum
- `lib/minibar-inventory.ts`(순수): 현재고 계산·부족 판정·입고/소모 적용·costVnd 갱신 규칙
- API: 입고 `POST /api/villas/[id]/minibar-restock`(ADMIN, writeAuditLog, costVnd 갱신), 재고 조회
- UI: 재고 현황 화면(빌라별 onHand vs par·부족 필터)·입고 폼(매입 단가), 대시보드 부족 배너
- 체크아웃 소모 시 onHandQty 차감 + CONSUME movement(F4 연계)

### S2 — 서비스 카탈로그 + 관리자 주문 처리
- 스키마: `ServiceCatalogItem`, `ServiceType += MOTORBIKE_RENTAL`, `ServiceOrder += catalogItemId·quantity·selectedOptions·requestedVia·guestNote`, `requestedVia` enum
- `lib/service-catalog.ts`(순수): 가격 스냅샷·옵션 적용·검증. 기존 `lib/service-order.ts` 전이표 재사용
- API: 카탈로그 CRUD `/api/services/catalog`(ADMIN, costVnd 게이트), 주문 생성·상태전이
- UI: 카탈로그 관리(`/settings/services`), 예약 상세 옵션 주문 패널

### S3 — 게스트 셀프 체크인 `/g/[token]`
- 스키마: `GuestCheckinToken`, `CheckInRecord.agreementVersion`
- API: 토큰 발급/회수(ADMIN), 게스트 GET 예약요약·카탈로그(원가 제거 화이트리스트), 동의서 서명 제출, 옵션 요청 생성
- UI: `/g/[token]` 5단계(예약확인·비품·동의서 서명·옵션선택·완료) + ADMIN 체크인 화면 토큰/QR 발급
- 서명패드(기존 `agreement-section.tsx` 패턴 재사용), `lib/agreement.ts` 다국어

### S4 — 체크아웃 게스트 정산 + 통계 연계 + 다국어
- 스키마: `CheckOutRecord.guestChargeVnd`(통화별)·`settlementMethod`·`settledAt`·`settlementNote`
- 체크아웃 화면 게스트 청구서 합산(미니바 소비 + 확정 옵션) + 결제수단 기록
- ServiceOrder 매출·원가 → 통계·정산 합류(통화별 분리), 미니바 마진 활성 확인
- `/g` 5개국어, ru 감수

## 완료 기준 (테스트 가능)

1. 입고 후 `onHandQty` 증가·`MinibarItem.costVnd` 갱신·`MinibarStockMovement(RESTOCK)` 기록, 부족 빌라가 경보에 노출
2. 체크아웃 소모분이 `onHandQty` 차감 + CONSUME movement + `minibarChargeVnd` 합산
3. 카탈로그 항목(차량 기사포함/불포함 옵션 포함) CRUD·정렬·active 토글 동작
4. `/g/[token]`: 동의서 서명→`agreementSignedAt·signatureUrl·agreementVersion` 저장, 옵션 요청→`ServiceOrder(REQUESTED,GUEST)` 생성, 만료·회수 토큰 차단
5. 체크아웃 청구서 = 미니바 소비 + 확정 옵션 합산, 결제수단·수납 기록
6. **누수 0(QA 실증)**: `/g`·게스트/공급자 카탈로그 응답에 `costVnd`·마진·타예약·빌라별 현재고 미포함(서버 select 화이트리스트, 클라 조건부 렌더 금지)

## 검증 방법
- 단위테스트: `lib/minibar-inventory.test.ts`, `lib/service-catalog.test.ts`, 토큰 만료·스코프
- 권한 누수: QA가 게스트 토큰·공급자 세션으로 카탈로그·게스트 API 호출 → costVnd/마진 부재 실증
- Playwright: `/g/[token]` 5단계 모바일 흐름, 체크아웃 청구서 합산
- typecheck 0 + `next build` 통과(배포 게이트)

## Stitch 디자인 (D4 범위)
- 게스트(모바일·라이트·ko, `/p` 톤): G1 예약확인 · G2 비품확인 · G3 동의서 서명 · G4 옵션선택 · G5 완료
- 운영자(다크·ko): b18 미니바 재고·입고 · b19 서비스 카탈로그 관리 · b20 예약상세 옵션 주문 패널 (b17=통계 기점유)
