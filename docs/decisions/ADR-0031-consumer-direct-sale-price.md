# ADR-0031 — 소비자 직판가 (Net / 소비자 2단계 가격)

- 상태: **Accepted** (테오 확정 2026-07-02 — Q1~Q4 결정, Phase 1~4 일괄 구현)
- 관련: ADR-0003(결제 통화·채널), ADR-0011(빌라 판매 필드), ADR-0014(요율 기간), ADR-0021(공급자 직접판매·supplierSalePriceVnd 2번째 가격 선례)
- 메모리: [[villa-two-tier-consumer-pricing]], [[revenue-multicurrency-fx-unify]]

## 1. 배경 (테오 지적, 2026-07-02)

빌라 요금은 기간마다 `원가(supplierCostVnd) → 마진 → 판매가(salePriceVnd/salePriceKrw)` **단 하나**의 판매가만 가진다. 이 단일 판매가가 **모든 채널에 동일 적용**된다(견적 `quoteStayForVilla`는 채널을 안 봄).

그런데 채널엔 이미 `DIRECT`(직접 소비자)와 `TRAVEL_AGENCY·LAND_AGENCY`(여행사·랜드사)가 있고, 회사가 **소비자에게 직접 판매할 때는 여행사 도매가보다 높은 소비자 가격**이 필요하다. 현재는 직접 소비자도 여행사와 같은 마진만 붙은 가격을 낸다.

## 2. 확정 결정 (테오, 2026-07-02)

| # | 질문 | 결정 |
|---|---|---|
| Q1 | "Net Price" 기준 | **현 판매가 = Net Price**(여행사·랜드사 도매가). 소비자가는 그 위에 신규 추가. 원가(supplierCost)는 그대로 아래 유지 |
| Q2 | 소비자가 산정 | **Net 대비 추가마진 자동제안 + 관리자 수정** (현 원가→판매가 UX와 동일) |
| Q3 | 채널 연동 | **자동** — DIRECT면 소비자가, 여행사·랜드사면 Net |
| Q4 | 통화 | **VND + KRW 둘 다**. 추가로 DIRECT 채널도 VND 결제 허용(통화 강제 해제) |

## 3. 핵심 원칙 적용

- **마진 비공개(원칙2)**: 소비자가·Net·마진은 전부 **운영자(canSetPrice/canViewFinance) 전용**. 공급자 화면·공개 제안(/p)·게스트(/g)엔 절대 비노출. select 화이트리스트 유지.
- **재고 비공개(원칙1)**: 무관(가격 계층만 변경).
- **베트남 UX(원칙4)**: 소비자가 입력은 운영자(ko) 다크 화면에만. 공급자 화면 무변경.

## 4. 데이터 모델

`VillaRatePeriod`에 **소비자 직판가 컬럼 추가**(additive, 라이브는 raw SQL ALTER — [[db-is-railway-postgres]]):

```
supplierCostVnd (원가, 공급자)
  → marginType/marginValue → salePriceVnd/salePriceKrw   ← Net (여행사·랜드사)
      → consumerMarginType/Value → consumerSalePriceVnd/Krw ← 소비자 직판가 (DIRECT)
```

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `consumerMarginType` | MarginType @default(PERCENT) | 소비자 마진 유형 (Net 대비) |
| `consumerMarginValue` | BigInt @default(0) | 소비자 추가마진 (PERCENT %, FIXED_VND 동). 0=Net과 동일 |
| `consumerSalePriceVnd` | BigInt? | 소비자가/박 VND. **null=salePriceVnd 폴백** |
| `consumerSalePriceKrw` | Int? | 소비자가/박 KRW. **null=salePriceKrw 폴백** |

**폴백 설계(무중단):** 소비자가가 null이면 Net으로 폴백한다. 따라서 마크업을 아직 설정 안 한 빌라의 기존 DIRECT 예약은 **동작 변화 없음**(백필 불필요). 관리자가 소비자 마진을 넣는 순간부터 그 빌라만 소비자가 적용.

**Booking·ProposalItem 스키마 무변경:** 스냅샷(totalSaleVnd/totalSaleKrw)의 *형태*는 그대로. 채널에 따라 그 총액을 **어느 요금 계층이 채우는지**만 달라진다. `assertSaleAmountColumns`(통화당 1컬럼) 불변식 유지.

## 5. 가격 계층 선택 (견적)

`quoteStayForVilla(db, villaId, range, saleCurrency, channel?)`에 **channel 인자 추가**:

- `channel === DIRECT` → **CONSUMER** 계층 (consumerSalePrice* ?? salePrice*)
- 그 외/미지정 → **NET** 계층 (salePrice*) — 기존 동작·하위호환

`quoteStayByPeriod`는 순수함수 층에서 `priceTier: "NET" | "CONSUMER"`를 받아 박별로 올바른 컬럼을 합산한다. 원가(supplierCostVnd)는 계층 무관 항상 동일.

## 6. 통화 자유화 (Q4)

`defaultCurrencyForChannel(DIRECT)`는 여전히 KRW **기본값**이나, 제안·예약 생성이 `saleCurrency` 오버라이드를 이미 받으므로 **DIRECT + VND**가 가능해진다(제안 생성 UI에서 DIRECT일 때도 통화 선택 노출).

## 7. 범위

- **포함**: 빌라 숙박가(VillaRatePeriod). 요금 편집기, 제안·홀드·변경·연장 견적, /p·매출·통계·정산 채널 정합.
- **제외**: 미니바·부가서비스(별도 가격 체계·회사표준 1세트, [[minibar-architecture]]), 공급자 자기판매가(supplierSalePriceVnd, 그대로).

## 8. 마이그레이션

`prisma/add-consumer-sale-price.ts` — 멱등 `ADD COLUMN IF NOT EXISTS` ×4. nullable/default라 구코드(미참조) 무영향.
