# ADR-0019 — 게스트 셀프 체크인 + 부가서비스 판매 + 미니바 실재고

- 상태: **Proposed** (테오 4대 결정 확정 2026-06-25, 구현 전 합의 대기)
- 관련: ADR-0003(결제 통화), ADR-0016(미니바 회사표준), ADR-0017(빌라별 비치수량), F4(체크인·아웃), T7.1(ServiceOrder BE)
- 메모리: [[minibar-architecture]], [[admin-statistics-status]], [[phase2-on-hold]]

## 1. 배경 (테오 요구)

1. 매입 후 판매하는 **미니바 재고를 (간단히) 관리**할 화면이 필요하다.
2. 미니바뿐 아니라 **통돼지 BBQ·각종 티켓·일일 가이드·차량 렌트(기사 포함/불포함)·오토바이 렌트** 등을 추후 옵션으로 붙여 판매한다 → 처음부터 이를 감안한 구조.
3. **소비자(게스트) 페이지가 필요**하다. 체크인 시 게스트가 **모바일로** ① 비품(어메니티) 목록 확인 ② 이용 동의서 서명 ③ 판매 옵션 선택·요청을 한 화면 흐름에서 하게 한다.
4. 아직 소비자 대면 페이지가 없으므로 이 페이지부터 기획·구축한다.

## 2. 확정 결정 (테오, 2026-06-25)

| # | 질문 | 결정 |
|---|---|---|
| D1 | 재고 관리 방식 | **미니바 = 실재고 추적 / 서비스(BBQ·티켓·가이드·렌트) = 주문형 발주(재고 없음)** |
| D2 | 게스트 페이지 접근 | **예약별 토큰 링크 + QR** (게스트 계정 없음, `/p/[token]` 방식 재사용) |
| D3 | 부가옵션 결제 | **요청 접수 → 운영자 확정 → 현장/체크아웃 정산** (Phase 1 PG 연동 없음) |
| D4 | 이번 범위 | **상세 기획 + Stitch 디자인** (합의 후 구현) |

## 3. 핵심 원칙 적용 (사업 4대 원칙 — 절대 위반 금지)

- **마진 비공개(원칙2)**: 서비스 카탈로그·미니바의 `costVnd`(매입원가)·마진은 게스트·공급자·`/p`·`/g` 라우트에 **절대 노출 금지**. 게스트는 **판매가만** 본다(미니바·옵션 모두). 운영자(`canViewFinance`)만 원가·마진을 본다.
- **재고 비공개(원칙1)**: `/g/[token]`은 **자기 예약 하나만** 노출. 다른 예약·다른 빌라·전체 재고·미니바 빌라별 현재고(운영 정보)는 도달 불가. 토큰은 단일 예약 스코프.
- **검수 게이트(원칙3)**: 본 기능은 검수 게이트와 독립(판매가능 전환에 영향 없음).
- **게스트 UX**: `/g`는 한국 여행객 대상이므로 **ko 기본** + 다국어(`?lang=`, `lib/agreement.ts`의 ko/vi/en/zh/ru 재사용). `/p`의 라이트·신뢰감 톤 계승.

## 4. 데이터 모델 설계

> 스키마 변경은 **라이브 DB 드리프트 위험**으로 `prisma db push` 금지 — additive 컬럼·테이블은 **raw SQL `ALTER`/`CREATE`**로 적용한다([[db-schema-drift-villa-source]]). enum ADD VALUE는 `--schema` 명시 generate 필요.

### 4.1 미니바 실재고 (D1, 간단 버전)

기존(ADR-0016/0017): `MinibarItem`(회사표준, `unitPriceVnd`=판매가, `costVnd?`=매입원가, `stockQty`=기본 비치수량) + `VillaMinibarStock(villaId, minibarItemId, qty)`=빌라별 **비치 목표 수량(par)**.

**개념 분리**: `qty`(par, "정상 비치 목표")와 **현재고(on-hand, "지금 냉장고에 실제 있는 수")**는 다르다.

추가:
- `VillaMinibarStock.onHandQty Int @default(0)` — **현재고 캐시**. par(`qty`)와 별개.
- 신규 `MinibarStockMovement` — 입·출고 이력(감사·원가 추적):
  ```
  model MinibarStockMovement {
    id            String   @id @default(cuid())
    villaId       String
    minibarItemId String
    type          MinibarMovementType   // RESTOCK | CONSUME | ADJUST
    qtyDelta      Int                   // +입고 / −소모·차감
    unitCostVnd   BigInt?               // RESTOCK일 때 매입 단가(원가 입력 경로)
    bookingId     String?               // CONSUME일 때 출처 예약
    note          String?
    createdBy     String
    createdAt     DateTime @default(now())
    @@index([villaId, minibarItemId])
  }
  enum MinibarMovementType { RESTOCK CONSUME ADJUST }
  ```
- **흐름**: 입고(RESTOCK) → `onHandQty += qtyDelta`, 입력한 `unitCostVnd`로 **`MinibarItem.costVnd` 갱신**(회사표준 1세트이므로 빌라 공통 최신 매입가; 이동평균은 과함 — 간단 버전은 최근 입고가). 체크아웃 소모(CheckoutMinibarLine 확정 시) → `onHandQty -= consumed`, CONSUME movement 기록.
- **부족 경보**: `onHandQty < qty`(par) 인 (빌라×품목) = "채우러 갈 대상". 대시보드 배너 + 재고 화면 필터.
- **매입원가 입력 UI = 입고 화면**: 이로써 `MinibarItem.costVnd`가 채워지고 **미니바 마진 통계가 자동 활성**([[admin-statistics-status]] ㉠ 의존 해소).
- 회사표준 원칙 유지: **가격·품목은 빌라별로 두지 않는다**. 빌라별은 par(`qty`)·현재고(`onHandQty`)·이동이력뿐.

### 4.2 서비스 카탈로그 (D1, 주문형)

기존: `ServiceType` enum(BBQ/TICKET/GUIDE/CAR_RENTAL/BREAKFAST) + `ServiceOrder`(type·costVnd·priceKrw·vendorName·serviceDate·note·status). **게스트가 고를 "메뉴(카탈로그)"가 없다** — 주문 건마다 운영자 수기 입력.

추가:
- `ServiceType`에 추가: **`MOTORBIKE_RENTAL`**(오토바이 렌트), **`MASSAGE`**(마사지 — 출장/방문, 시간 티어), **`BARBER`**(이발소(귀) — 시간 티어 + 세부 시술 메뉴). 차량 기사 포함/불포함, 마사지 출장/방문, 시술 시간(30/60/90/120분)은 enum이 아니라 **카탈로그 항목 옵션**으로 표현.
- **옵션 스키마(`options` JSON)** — 토글 하나로는 부족(마사지·이발소처럼 시간 티어 + 다중 세부시술)하므로 3종 구조:
  - `variants` — **상호배타 1택**, 기본 판매가를 **대체**. 예: 시술 시간(풋마사지 30/60분, 바디마사지 30/60/90/120분, 이발소 60/90분), 차량 기사 포함/불포함. `[{key,labelKo,labelVi,priceKrw,priceVnd}]`
  - **마사지는 종류별로 카탈로그 항목을 나눈다**(스키마 변경 없음, 전부 `type=MASSAGE`): ① **풋마사지**(30/60분) ② **바디마사지 · 아로마** ③ **바디마사지 · 핫스톤** ④ **바디마사지 · 건식**(②③④는 30/60/90/120분 variants). 출장(방문)은 전 마사지 공통 `modifiers` 출장비. 게스트 UI는 "마사지" 섹션 헤더 아래 항목들을 묶어 표시.
  - `addons` — **다중 선택**, 판매가에 **가산**. 예: 이발소의 족욕·귀청소·면도·손발톱 관리·콧털 정리·스톤 마사지·오이팩·허벌 케어·전신/발/두피 마사지·태국식 스트레칭·베트남식 샴푸. `[{key,labelKo,labelVi,priceKrw,priceVnd}]`
  - `modifiers` — **토글 가산**(있으면 +), 예: 출장비. `[{key,labelKo,labelVi,priceDeltaKrw,priceDeltaVnd}]`
  - 게스트 선택 결과는 `ServiceOrder.selectedOptions`에 스냅샷(어떤 variant·addon·modifier를 골랐는지 + 그 시점 가격). 합계 = variant 가격(없으면 `priceKrw/Vnd`) + Σaddons + Σmodifiers, **서버 재계산**(클라 변조 방지).
  - **모든 옵션 가격도 판매가만** — `costVnd`는 옵션 단위로 두지 않고 항목·주문 단위(운영자 확정 시 입력). 게스트 비노출 원칙 동일.
  - 메뉴가 길어 카드가 복잡해지면 게스트 UI는 "자세히 보기" 시트로 펼침(시간 티어 라디오 + 세부시술 체크리스트).
- 신규 `ServiceCatalogItem` — 판매 메뉴 1세트(빌라 무관, 회사 공통 — 미니바와 동형):
  ```
  model ServiceCatalogItem {
    id          String   @id @default(cuid())
    type        ServiceType
    nameKo      String
    nameVi      String?
    nameEn      String?
    descKo      String?           // 게스트 안내문(ko)
    descVi      String?
    unitLabelKo String?           // "1마리" "1인" "1일" 등 단위 표기
    priceKrw    Int?              // 판매가 KRW (게스트 표시)
    priceVnd    BigInt?           // 판매가 VND (현지 결제·여행사 채널)
    costVnd     BigInt?           // 참고 매입원가 — ★게스트·공급자 절대 비노출
    photoUrl    String?
    options     Json?             // {variants:[1택·가격대체], addons:[다중·가산], modifiers:[토글·가산]} — 마사지 시간티어/이발소 세부시술/차량 기사포함
    active      Boolean  @default(true)
    sortOrder   Int      @default(0)
    createdAt   DateTime @default(now())
    updatedAt   DateTime @updatedAt
  }
  ```
- `ServiceOrder` 확장(스냅샷·게스트 출처):
  - `catalogItemId String?` (FK, 어느 메뉴에서 왔는지)
  - `quantity Int @default(1)`
  - `selectedOptions Json?` (선택 옵션 스냅샷)
  - `requestedVia` enum `ADMIN | GUEST` (게스트 셀프 요청 식별)
  - `guestNote String?`
  - 기존 `costVnd`·`priceKrw`는 **확정 시점 스냅샷**으로 유지(카탈로그 가격이 나중에 바뀌어도 주문 금액 불변). 게스트 요청(REQUESTED) 단계는 `priceKrw`=카탈로그 제안가, `costVnd`=0 또는 미정 → 운영자가 CONFIRMED에서 확정.
- 통화: 게스트(한국 여행객)는 **KRW 표시 기본**, 현지 현금/여행사 채널은 VND. `priceKrw`+`priceVnd` 듀얼(ADR-0003 규칙). `/g` 표시는 `booking.saleCurrency` 분기.

### 4.3 게스트 셀프 체크인 토큰 (D2)

- 신규 `GuestCheckinToken`:
  ```
  model GuestCheckinToken {
    id         String    @id @default(cuid())
    bookingId  String    @unique
    token      String    @unique   // 랜덤 URL-safe (crypto)
    expiresAt  DateTime             // 기본 = checkOut + 1일
    revokedAt  DateTime?
    firstUsedAt DateTime?
    createdAt  DateTime  @default(now())
  }
  ```
- 라우트 `/g/[token]` (App Router, 비로그인). `Booking`별 1토큰, 만료·회수 시 차단. 재발급 = 새 토큰 생성(이전 revoke).
- **동의서 버전 기록**: `CheckInRecord.agreementVersion String?` 추가([[agreement-content-module]]의 향후 항목 실현) — 어느 판본에 서명했는지 추적.
- 여권 업로드는 본 범위 제외(현장 ADMIN 체크인 유지). 게스트 셀프 여권 업로드는 후속 옵션(§7 Phase).

## 5. 게스트 흐름 `/g/[token]` (SPEC F9)

1. **예약 확인** — 빌라명·날짜·박수·인원만(마진·재고·타예약 비노출). 만료 토큰은 안내 화면.
2. **비품 목록 확인** — 이 빌라의 어메니티 + 미니바 비치 품목. 미니바는 **판매가 표시**(소비 시 유료 안내), 원가·마진 비노출. "확인했습니다" 체크.
3. **이용 동의서 서명** — `lib/agreement.ts` 본문(수영장 빌라는 수영장 조항 자동), 모바일 서명 패드 → `CheckInRecord.agreementSignedAt`·`signatureUrl`·`agreementVersion` 저장. `?lang=`로 5개국어.
4. **부가옵션 선택** — `ServiceCatalogItem(active)` 카드(사진·이름·판매가·단위·옵션). 수량·옵션 선택 → "요청하기" → `ServiceOrder(status=REQUESTED, requestedVia=GUEST)` 생성. **결제 없음** — "운영자 확인 후 확정/안내" 문구.
5. **완료** — 요청 내역 요약 + "현장/체크아웃 시 정산" 안내. 재진입 시 기존 요청 조회 가능.

## 6. 운영자(ADMIN) 측

- **미니바 재고 현황** `/settings/minibar` 확장 또는 신규 `/inventory`: 빌라별 현재고(onHand) vs par, **입고 버튼(매입 단가 입력 → costVnd 갱신)**, 부족 빌라 필터, 대시보드 부족 배너.
- **서비스 카탈로그 관리** `/settings/services`: 메뉴 CRUD(이름 ko/vi/en, 판매가 KRW/VND, 원가, 사진, 옵션, active/정렬). `canViewFinance` 게이트(원가 컬럼).
- **부가옵션 주문 처리**: 게스트 요청(REQUESTED) → 운영자가 가능 여부·가격 확정(CONFIRMED) → DELIVERED. 예약 상세에 ServiceOrder 패널(이미 relation 존재) + 대시보드 "신규 옵션 요청" 알림. 상태 전이표는 기존 `lib/service-order.ts` 재사용.
- **권한**: 전 화면 `lib/permissions.ts` 게이트. 원가·마진 컬럼은 서버 select 화이트리스트로 STAFF/공급자 페이로드에서 제거(클라 조건부 렌더 금지).

## 6.5 체크아웃 게스트 정산 (테오 추가 2026-06-25)

미니바 소비분·확정된 부가옵션은 **체크아웃 시 게스트에게 통합 청구·정산**한다(현금/계좌이체). 운영자↔공급자 정산(F6)과 **별개**의 게스트↔운영자 청구다.

- 체크아웃 화면(F4)에 **게스트 청구서(bill)** 합산:
  - 미니바 소비 = Σ(CheckoutMinibarLine 소비수량 × `unitPriceVnd`) → `CheckOutRecord.minibarChargeVnd`
  - 부가옵션 = Σ(이 예약의 `ServiceOrder(CONFIRMED|DELIVERED)` 판매가)
  - (-) 보증금 환불/(+) 파손 차감(`deductionVnd`)은 별도 표기(보증금은 게스트↔운영자, 공급자 정산 무관 — F6 규칙 유지)
- **결제수단 기록**: 신규 필드 `CheckOutRecord.guestChargeVnd`(또는 통화별), `settlementMethod`(`CASH | BANK_TRANSFER | OTHER`), `settledAt`, `settlementNote`. 부분수납·미수 허용(Payment 모델 재사용 검토 — `lib/payment.ts`).
- 통화: 게스트가 KRW/VND 중 무엇으로 내든 기록(ADR-0003 통화별 분리, 합산 금지). 미니바·서비스 판매가는 KRW/VND 듀얼.
- 게스트 `/g` 완료 화면은 "체크아웃 시 합산 정산" 안내만(실제 청구·수납 확정은 운영자 체크아웃 화면).

## 7. 정산·통계 연계

- `ServiceOrder` 매출(priceKrw/Vnd)·원가(costVnd) → 정산·통계 집계에 합류(현재 모델만 있고 미연결). 통화별 분리(ADR-0003), 마진=운영자 전용.
- 미니바 마진: §4.1 입고 원가 입력으로 `MinibarItem.costVnd` 채워짐 → 통계 자동 활성.

## 8. 단계(Phase) 제안

- **S1 — 미니바 실재고 + 입고/원가 UI**: movement·onHandQty, 입고 화면, 부족 경보, costVnd 자동 갱신 → 미니바 마진 통계 활성.
- **S2 — 서비스 카탈로그 + 관리자 주문 처리**: ServiceCatalogItem CRUD, ServiceOrder 확장, 예약 상세 패널.
- **S3 — 게스트 셀프 체크인 `/g/[token]`**: 토큰 발급/QR, 예약확인·비품·동의서 서명·옵션 요청·완료.
- **S4 — 정산·통계 연계 + 다국어 감수**: 부가서비스 손익 합류, `/g` 5개국어, ru 감수.

## 9. 누수 점검 체크리스트 (QA 필수)

1. `/g/[token]` 응답에 `costVnd`·마진·타예약·전체 재고·미니바 빌라별 현재고(운영정보) 미포함.
2. 만료·회수 토큰 `/g` 접근 차단(404/안내).
3. 서비스 카탈로그 GET(게스트/공급자)에 `costVnd` 미포함 — 서버 select 화이트리스트.
4. 미니바 가격은 게스트 노출 OK, **원가·마진은 운영자만**.
5. 게스트 요청 ServiceOrder는 `priceKrw`만(원가 0/미정), 운영자 확정 전 금액 변조 방지(서버 재계산).

## 10. 미해결 / 후속

- 게스트 셀프 여권 업로드(임시거주신고 위임 일원화) — 후속.
- 토큰 전달 채널(여행사·카톡·빌라 QR 비치) 운영 가이드 — LOC/OPS.
- 부가옵션 온라인 선결제(PG) — Phase 2(IDEAS.md).
- 미니바 이동평균 원가 — 간단 버전은 최근 입고가, 정밀화는 후속.
