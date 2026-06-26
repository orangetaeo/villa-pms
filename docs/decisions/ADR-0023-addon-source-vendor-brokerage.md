# ADR-0023 — 부가서비스 원천 공급자 중계 + 요청 주체 자격 (과일 바구니·과일 도시락)

- 상태: **Proposed** (테오 요구 2026-06-26, 3대 결정 확정 / 구현 전 합의 대기)
- 관련: ADR-0019(게스트 체크인·부가서비스 판매·미니바), ADR-0003(결제 통화), ADR-0018(복식부기 LEDGER), ADR-0013(운영자 RBAC), ADR-0022(여행사·랜드사 B2B 미수, Proposed)
- 메모리: [[guest-checkin-addon-inventory-plan]], [[supplier-statistics-status]], [[partner-b2b-receivables-plan]], [[zalo-integration-status]], [[minibar-architecture]]

## 1. 배경 (테오 요구 2026-06-26)

ADR-0019에서 부가서비스(BBQ·티켓·가이드·렌트·마사지·이발) 카탈로그·주문 구조를 만들었으나, **vendor(공급처)는 `ServiceOrder.vendorName` 자유 텍스트뿐**이었다. 실제 운영은 **우리가 중계만 한다**: 요청이 오면 외부 원천 공급자에게 발주하고, 공급자가 가부를 결정해 통보하면, 우리가 고객에 확정하고, 공급자에게 원가를 정산한다. 이를 1급 엔티티로 승격해야 한다.

추가 요구:
1. **과일 바구니**·**과일 도시락**을 부가서비스 메뉴에 추가한다.
2. **과일 바구니** = 여행사/랜드사(B2B)만 요청 가능. 요청 처리·확인 경로가 필요.
3. **과일 도시락** = 여행사/랜드사 + 소비자(게스트) 모두 요청 가능. 단, **소비자는 과일 도시락만** 요청 가능(바구니는 소비자 비노출).
4. **모든 부가서비스에 원천 공급자 설정**이 있어야 한다(우리는 중계자).
5. 요청 발생 시 원천 공급자에게 **Zalo로 발주** 발송.
6. 원천 공급자는 **우리가 만든 페이지에서 예약 현황을 확인** 후 **가부 결정 → 우리에게 통보**.
7. 원천 공급자는 **정산을 우리에게서 받는다**(우리가 받아 공급자에 지급).
8. 원천 공급자에게도 **통계 페이지**를 보여준다.

## 2. 확정 결정 (테오, 2026-06-26)

| # | 질문 | 결정 |
|---|---|---|
| D1 | 원천 공급자 페이지 접근 방식 | **로그인 계정(역할 `VENDOR`) + 전용 대시보드 `/vendor`** (영구 거래처, 빌라 공급자 패턴 재사용) |
| D2 | 원천 공급자 엔티티 | **완전 별도 `ServiceVendor`** (빌라 `SUPPLIER`와 무관한 외부 거래처 — 과일가게·BBQ업체·마사지샵 등) |
| D3 | 원천 공급자 정산 방식 | **발주 건별 즉시 정산 기록**(누적 원장 아님 — 건마다 정산 완료 표기) |

추가 확정(요구에서 직접 도출, 비분기 사항):
- **PO(발주) 흐름 = 2단계 게이트**: 요청 접수 → **공급자 수락 후에야** 운영자가 고객에 확정. 공급자 거절 시 운영자가 대체 공급자 지정 또는 취소.
- **요청 주체 자격(audience)은 카탈로그 항목별 선언**: 과일 바구니=[PARTNER], 과일 도시락=[PARTNER, GUEST]. 일반화하여 모든 카탈로그 항목이 "어느 채널이 요청 가능한가"를 가진다.

## 3. 핵심 원칙 적용 (사업 4대 원칙 — 절대 위반 금지)

ADR-0019의 게스트·공급자 비노출 원칙에 **원천 공급자 비노출**을 한 겹 추가한다.

- **마진 비공개(원칙2)** — 원천 공급자는 **자기 발주의 원가(=우리가 그에게 지급할 금액)만** 본다. **우리 판매가(KRW/파트너가)·마진·다른 공급자 발주는 절대 비노출.** `/vendor` 라우트 응답은 서버 select 화이트리스트로 판매가·마진 필드 제거.
- **재고 비공개(원칙1)** — 원천 공급자는 **자기에게 배정된 발주만** 본다. 전체 재고·다른 빌라·다른 예약·다른 공급자 발주는 도달 불가. `vendorId` 스코프 서버 강제(빌라 `supplierId` 스코프와 동형, [[supplier-statistics-status]] 패턴).
- **게스트 비노출(ADR-0019 유지)** — 게스트(`/g`)는 `costVnd`·원천 공급자 신원·마진 비노출. 게스트는 `audiences`에 `GUEST`가 포함된 항목만 본다(과일 바구니 비노출).
- **파트너 비노출** — 여행사/랜드사(`/p`)는 `costVnd`·원천 공급자 신원 비노출. `audiences`에 `PARTNER` 포함 항목만.
- **개인정보 최소화** — 원천 공급자는 발주 이행에 필요한 정보만(빌라명·날짜·수량·인원). 게스트 여권·연락처 등 개인정보 비노출.
- **VENDOR UX** — 베트남 외부 거래처 대상 → **vi 기본, 모바일 우선, 텍스트 최소·터치 중심**(빌라 공급자 UX-VN 원칙 계승).

## 4. 데이터 모델 설계

> 스키마 변경은 **라이브 DB 드리프트 위험**으로 `prisma db push` 금지 — additive 컬럼·테이블·enum은 **raw SQL `ALTER`/`CREATE`**로 적용([[db-schema-drift-villa-source]]). enum ADD VALUE는 `--schema` 명시 generate 필요([[theo-2026-06-24-epic]] 미니바 enum 추가 선례).

### 4.1 원천 공급자 엔티티 (D1·D2)

신규 역할: `enum Role` += `VENDOR` (additive only — ADMIN/OWNER/MANAGER/STAFF/SUPPLIER/CLEANER에 추가).

```prisma
model ServiceVendor {
  id          String   @id @default(cuid())
  userId      String?  @unique          // 로그인 계정(Role=VENDOR). 분리 보관(엔티티≠계정), 1:1
  user        User?    @relation("VendorAccount", fields: [userId], references: [id], onDelete: SetNull)
  name        String                    // 거래처명(예: "푸꾸옥 과일가게 A")
  nameKo      String?                   // 운영자 표시용(한국어), 선택
  phone       String?
  zaloUserId  String?                   // ★ Zalo 발주 발송 대상(없으면 발주 알림 불가 — 경보)
  bankInfo    Json?                     // 정산 계좌(은행·계좌·예금주) — 운영자 전용
  note        String?
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  catalogItems ServiceCatalogItem[]
  orders       ServiceOrder[]
  @@index([active])
}
```

- 계정(User Role=VENDOR)은 **선택적 1:1 분리**: 엔티티는 발주 대상으로 먼저 만들고, 페이지 접근이 필요하면 계정을 연결(빌라 공급자 계정 생성 패턴 재사용, `mustChangePassword` 초기 비번 흐름).
- `zaloUserId`는 **발주 알림의 핵심**. 미설정 공급자에 자동 발주 시 운영자에 경보(발송 불가). 게스트 `User.zaloUserId`와 동일 슬롯 재사용(전역 Zalo 조인).

### 4.2 카탈로그: 원천 공급자 + 요청 주체 자격 (요구 4·2·3)

`ServiceCatalogItem`(ADR-0019) 확장:
- `vendorId String?` (FK `ServiceVendor`) — **원천 공급자 설정**. UI는 활성 항목에 필수 입력 강제(스키마는 transition 위해 nullable). 미지정 항목은 "직접 제공"으로 간주(발주 없음).
- `audiences Json @default("[\"ADMIN\"]")` — **요청 가능 채널 집합** `["ADMIN"|"PARTNER"|"GUEST"]`. 게스트 `/g`·파트너 `/p`는 자기 채널이 포함된 항목만 카탈로그로 받는다(서버 필터, 클라 조건부 렌더 금지).

신규 ServiceType: `enum ServiceType` += `FRUIT`(과일 — 바구니·도시락 공통, 마사지 1 type·다항목 선례). 카탈로그 시드 2건:

| 항목 | type | audiences | vendorId |
|---|---|---|---|
| 과일 바구니 | FRUIT | `["ADMIN","PARTNER"]` | (과일 공급자) |
| 과일 도시락 | FRUIT | `["ADMIN","PARTNER","GUEST"]` | (과일 공급자) |

→ **과일 바구니는 `/g` 게스트 카탈로그에서 자동 제외**(audiences에 GUEST 없음). 과일 도시락만 게스트 노출. 둘 다 파트너·운영자 노출.

### 4.3 발주(PO) 상태 + 정산 — `ServiceOrder` 확장 (요구 5·6·7, D3)

`ServiceOrder`(ADR-0019) 확장. **1 주문 = 1 발주(한 공급자)** 이므로 별도 PO 테이블 없이 주문에 부착:

```prisma
// ServiceOrder 추가 컬럼
vendorId            String?              // 이 주문의 원천 공급자(카탈로그 vendorId 스냅샷, 운영자 대체 가능)
vendorStatus        ServiceVendorStatus? // 발주 게이트 상태(아래 enum). 공급자 없는 직접 제공은 null
poSentAt            DateTime?            // Zalo 발주 발송 시각
vendorRespondedAt   DateTime?            // 공급자 가부 응답 시각
vendorRejectReason  String?              // 거절 사유(공급자 입력)
// 정산(D3 — 건별 즉시): 우리가 공급자에 지급할 원가 = 기존 costVnd × quantity 재사용
vendorSettledAt     DateTime?            // 이 발주 정산 완료 시각(null=미정산)
vendorSettleMethod  SettlementMethod?    // CASH | BANK_TRANSFER | OTHER (ADR-0019 게스트정산 enum 재사용)
vendorSettleNote    String?
```

```prisma
// 발주 게이트 — 공급자 수락 후에야 운영자가 고객에 확정(2단계)
enum ServiceVendorStatus {
  PENDING_VENDOR   // 발주 발송, 공급자 응답 대기
  VENDOR_ACCEPTED  // 공급자 수락 → 운영자 고객확정 가능
  VENDOR_REJECTED  // 공급자 거절 → 운영자 대체 지정 또는 취소
}
```

- 기존 `ServiceRequestedVia`(ADMIN|GUEST) += **`PARTNER`** (여행사/랜드사 요청).
- **정산 금액**은 기존 `ServiceOrder.costVnd`(매입원가=공급자 지급액)를 재사용 — 신규 금액 컬럼 불필요. 누적 원장(ADR-0018 LEDGER) 미사용(D3=건별). `vendorSettledAt`로 미정산/완료만 구분.
- 공급자가 보는 "내 매출" = Σ `costVnd`(VENDOR_ACCEPTED·DELIVERED 발주, **자기 것만**). 우리 `priceKrw/priceVnd`(판매가)는 공급자 응답·통계·페이로드에서 **서버 제거**.

### 4.4 상태 전이 (전체 흐름)

```
[요청]  ServiceOrder(status=REQUESTED, requestedVia=ADMIN|PARTNER|GUEST, vendorId=카탈로그 공급자)
   │  운영자(또는 자동) 발주 발송 → Zalo to vendor.zaloUserId
   ▼
[발주]  vendorStatus=PENDING_VENDOR, poSentAt=now
   │  공급자가 /vendor에서 예약현황 확인 후
   ├─ 수락 ─▶ vendorStatus=VENDOR_ACCEPTED ─▶ 운영자 고객확정 status=CONFIRMED ─▶ DELIVERED
   │                                                                         └─▶ [정산] vendorSettledAt=now (건별 즉시)
   └─ 거절 ─▶ vendorStatus=VENDOR_REJECTED ─▶ 운영자: 대체 공급자 재발주 / status=CANCELLED
```

## 5. 채널별 요청 경로 (요구 2·3)

| 채널 | 라우트 | requestedVia | 노출 카탈로그 |
|---|---|---|---|
| 운영자 | 예약 상세 주문 패널(기존) | ADMIN | 전체 |
| 여행사/랜드사 | `/p/[token]` 제안·예약 화면에 "부가서비스 요청" 섹션 추가 | PARTNER | `audiences ∋ PARTNER`(과일 바구니·도시락 등) |
| 소비자(게스트) | `/g/[token]` 옵션 선택(ADR-0019 기존) | GUEST | `audiences ∋ GUEST`(과일 도시락 ○, 바구니 ✕) |

- **파트너 채널**: 현재는 `/p/[token]`(비로그인 B2B, [[region-filter-uses-villa-complex]] 제안 링크)에 부가서비스 요청 섹션을 얹는다. ADR-0022 파트너 포털이 구현되면 그쪽이 정식 홈(요청 이력·미수 연계). requestedVia=PARTNER로 식별.
- 파트너/게스트 요청 모두 §4.4 발주 게이트를 동일하게 통과(공급자 수락 → 확정).

## 6. 원천 공급자 페이지 `/vendor` (vi, 모바일 — D1)

빌라 공급자(`/my-villas`·`/earnings`) 구조를 미러:

1. **발주함(받은 발주)** — PENDING_VENDOR 우선. 카드: 빌라명·날짜·품목·수량·인원(개인정보 제외)·**지급 예정 원가(자기 costVnd)**. [수락]/[거절(사유)] 버튼 → `vendorStatus` 갱신 + 운영자 알림.
2. **예약 현황** — 수락한 발주의 일정 캘린더/리스트(이행 준비용). **자기 발주만**.
3. **정산 내역** — 건별 미정산/정산완료(`vendorSettledAt`). 합계는 통화별 분리(VND). 우리 판매가·마진 비노출.
4. **통계** `/vendor/stats` (요구 8) — KPI(기간 매출=ΣcostVnd·발주 수·수락율·인기 품목) + 추이. `lib/vendor-stats.ts`(vendorId 스코프, **costVnd만**, 차트 라벨 서버 번역해 누수0) — [[supplier-statistics-status]]의 `lib/supplier-stats` 패턴 그대로 복제.

- 접근 게이트: `lib/permissions.ts`에 VENDOR 분기. 모든 `/vendor` 라우트 핸들러 첫 줄 role=VENDOR + 본인 `vendorId` 스코프 강제.

## 7. Zalo 발주 발송 (요구 5 — INTEG)

- 발주 트리거(요청→PENDING_VENDOR) 시 `lib/zalo` 발송: 대상 `vendor.zaloUserId`, 문구(vi) "새 발주 도착 — [빌라]·[날짜]·[품목 x수량]. 확인: /vendor". [[zalo-integration-status]]·[[nike-villa-zalo-integration]] 발송 경로 재사용.
- `zaloUserId` 미설정 공급자: 발송 불가 → 운영자 대시보드 경보(수기 연락 안내). 자동 발주 막지 않되 미발송 표기.
- 공급자 가부 응답 시 운영자에 Zalo/대시보드 알림(F5 알림 패턴).
- 알림 유형 enum 추가 필요 시 `NotificationType` += `VENDOR_PO`/`VENDOR_RESPONSE`(additive).

## 8. 정산·통계 연계 (요구 7·8)

- **공급자 지급(우리→공급자)** = 발주 건별 즉시(`vendorSettledAt`). 빌라 공급자 정산(F6, 우리↔빌라공급자)·게스트 청구(ADR-0019, 게스트↔우리)·파트너 미수(ADR-0022, 여행사↔우리)와 **별개의 4번째 돈 흐름**. 통화 VND, 합산 금지(ADR-0003).
- **운영자 손익**: 부가서비스 마진 = 판매가(게스트/파트너 수취) − 원가(공급자 지급). 기존 통계([[admin-statistics-status]] 부가서비스 매출연계)에 공급자 지급 원가가 채워지며 마진 자동 산출.
- **공급자 통계**(§6.4)는 공급자 자기 스코프 매출(=우리 지급액)만.

## 9. 누수 점검 체크리스트 (QA 필수 — ADR-0019 목록에 추가)

1. `/vendor/*` 응답에 우리 판매가(priceKrw/priceVnd)·마진·다른 공급자 발주·전체 재고 **미포함**(서버 select 화이트리스트, vendorId 스코프).
2. `/g/[token]` 카탈로그에 `audiences ∌ GUEST` 항목(과일 바구니) **미노출**. 직접 주문 API에도 audience 서버 검증(과일 바구니를 GUEST가 요청 시 거부).
3. `/p/[token]` 카탈로그·요청은 `audiences ∋ PARTNER`만. costVnd·공급자 신원 비노출.
4. 공급자 발주 카드에 게스트 개인정보(여권·연락처) 미포함 — 빌라명·날짜·수량·인원만.
5. `ServiceVendor.bankInfo`·`costVnd`는 운영자(canViewFinance) 전용. STAFF·공급자·파트너·게스트 페이로드 제거.
6. 발주 게이트: VENDOR_REJECTED 주문이 고객에 CONFIRMED로 새지 않음(대체 지정/취소만).

## 10. 단계(Phase) 제안

- **S1 — ServiceVendor 엔티티 + 카탈로그 연결**: 모델·Role VENDOR·`vendorId`·`audiences`, 운영자 공급자 CRUD(`/settings/vendors`), 카탈로그에 공급자·자격 입력. 과일 바구니·도시락 시드.
- **S2 — 발주 게이트 + Zalo 발송**: `ServiceOrder` 발주 컬럼·`ServiceVendorStatus`·`requestedVia` PARTNER, 상태 전이 API, Zalo 발주(INTEG), 운영자 발주/응답 알림.
- **S3 — `/vendor` 대시보드(vi)**: 로그인·발주함·예약현황·가부 응답·건별 정산 표기. 권한 게이트·스코프.
- **S4 — 채널 요청 + 공급자 통계 + 누수 QA**: `/p` 파트너 요청 섹션·`/g` audience 필터, `/vendor/stats`(lib/vendor-stats), §9 누수 스캔, vi/ko i18n(공급자 vi 필수).

## 11. 미해결 / 후속

- 발주 자동 발송 vs 운영자 검토 후 발송(기본=운영자 1클릭 발주, 자동화는 후속).
- 한 카탈로그 항목에 **복수 공급자 후보**(거절 시 자동 대체) — Phase 1은 단일 vendorId + 운영자 수기 대체. 복수 후보·라운드로빈은 후속.
- 공급자 정산 **누적 정산서 PDF**(D3 건별 유지하되, 월별 합계 리포트는 후속 — 빌라 공급자 정산서 PDF 패턴 재사용 가능).
- 공급자 셀프 매출 대사(공급자가 우리 지급액에 이의) 분쟁 흐름 — 후속.
- 과일 외 기존 서비스(BBQ·티켓·가이드·렌트·마사지·이발) 전부에 vendorId 백필 — S1 데이터 정리 작업.
