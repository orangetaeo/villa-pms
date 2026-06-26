# ADR-0021 — 공급자 직접 판매 채널 (양방향 모델 복원)

- 상태: **Accepted** (테오 확정 2026-06-26 — D1~D5 합의, 구현 착수. 브랜치 wt/f10-supplier-direct)
- 관련: ADR-0003(결제 통화·채널), ADR-0006(검수 게이트), ADR-0011(빌라 판매 필드), ADR-0014(요율 기간), F2(캘린더), F3(제안·가예약), F6(정산)
- 메모리: [[supplier-direct-sales-channel]], [[availability-board-direct-booking]], [[db-schema-drift-villa-source]]

## 1. 배경 (테오 지적, 2026-06-26)

원래 사업 모델은 **양방향**이다:

```
공급자가 이 PMS로 자기 빌라를 자기 고객에게 직접 판매
  → 그 공실이 실시간으로 우리(운영자)에게 공유
  → 우리가 매력적인 공실을 선점해 한국 채널(여행사·랜드사·여행객)에 재판매
```

그런데 현재 구현은 **단방향**이다. 공급자는 빌라·원가·캘린더 차단만 입력할 수 있고 **예약 생성·판매가 책정·판매 링크 생성이 전부 불가**하다(모든 판매는 ADMIN 제안링크 `/p/[token]`로만 발생). 공급자에겐 "등록만 하고 내가 팔 방법이 없는 프로그램"이라, **공급자가 PMS를 상시 쓸 이유가 없고 → 공실 공유가 끊긴다.** 공급자의 직접 판매 도구가 곧 공실 공유의 엔진이다.

## 2. 확정 결정 (테오, 2026-06-26)

| # | 질문 | 결정 |
|---|---|---|
| D1 | 공급자 직접 판매 방식 | **둘 다(단계적)** — Phase A 캘린더 "직접예약 기록"(오프라인 판매 수동 입력) → Phase B 공급자별 공개 판매 링크(자기 고객 셀프 가예약) |
| D2 | 직접판매 vs 우리 선점 충돌 우선권 | **선착순** — 운영자 선점 우선권 없음. 같은 가용성 레이어에 먼저 잡은 쪽이 임자 |
| D3 | 직접판매 수익·정산 | **공급자 100%(무료 PMS)** — 직접판매액 전부 공급자 것, 수수료 없음, 정산 제외. 우리 수익은 우리 선점 재판매에서만 |
| D4 | 검수 미승인 빌라 직접판매 | **허용** — 검수 게이트(isSellable)는 *우리 재판매*만 막는다. 공급자 자기 고객 판매는 공급자 책임(`villa.status=ACTIVE`만 요구) |
| D5 | 직접예약 게스트 체크인 검수 | **정식 F4 적용** — 여권 OCR·이용 동의서 서명·보증금·체크아웃 사진 비교·청소 검수를 모두 받는다. **공급자가 직접 수행**(자기 고객·자기 빌라 현장, vi 모바일), `seller=SUPPLIER`+자기 `supplierId` 스코프. 임시거주신고(여권)도 공급자 본인이 처리(운영자 전달 단계 불필요) |

## 3. 핵심 원칙 적용 (사업 4대 원칙 — 절대 위반 금지)

- **재고 비공개(원칙1)**: 공급자는 여전히 **자기 빌라만** 본다. 전체 재고 조망은 운영자뿐. Phase B 판매 링크도 **공급자 자기 빌라·자기 판매가만** 노출.
- **마진 비공개(원칙2)**: 공급자는 운영자 재판매가(`salePriceKrw`)·마진을 못 본다. 운영자 예약은 공급자 화면에 **"예약됨"만**(F2 기존 규칙 유지). 공급자 자기 판매가(`supplierSalePriceVnd`)는 *공급자 소유 정보*로, 우리 마진과 완전 별개.
- **검수 게이트(원칙3)**: D4 — 직접판매 *개시*는 게이트 우회(허용). 단 게스트 *체크인·아웃 검수*는 D5로 정식 F4 적용(여권·동의서·보증금·청소). 체크아웃 후 청소 태스크·`isSellable=false`는 누가 묵었든 동일.
- **베트남 UX(원칙4)**: Phase A = 빈 날짜 탭 → 폼 1장(고객명·인원·날짜만, 텍스트 최소). vi 기본, 모바일.

## 4. 해결 원리 — "공유 가용성 + 선착순"

운영자와 공급자가 **같은 빌라·같은 캘린더에 두 개의 독립 판매**를 동시 운영한다.

```
                  [ 같은 빌라의 단일 가용성 레이어 ]
            Booking(HOLD|CONFIRMED|CHECKED_IN) + CalendarBlock
            ※ lib/availability.ts 트랜잭션 잠금 = 선착순 자동 보장
                   ↑                              ↑
        운영자가 홀드/예약                  공급자가 직접예약
        seller=OPERATOR                    seller=SUPPLIER
        (한국 재판매, 우리 마진)            (자기 고객, 공급자 100%)
        → 공급자엔 "예약됨"만               → 운영자엔 "공급자 직접예약" 셀
        → 정산 대상                        → 정산 제외
```

**세 결정이 설계를 단순화한다:**
- **선착순(D2)** → 우선권 비교 로직 0줄. 기존 `lockVillaInventory()` + `checkAvailability()` 트랜잭션이 그대로 "먼저 잡은 쪽이 임자"를 강제. 공급자 쓰기를 *같은 게이트*로 라우팅하기만 하면 된다.
- **공급자 100%(D3)** → 정산(F6)에 `seller=OPERATOR` 필터 한 줄.
- **단계적(D1)** → Phase A로 빠르게 출시, Phase B 확장.

## 5. 데이터 모델 설계

> 스키마 변경은 라이브 DB 드리프트 위험으로 `prisma db push` 금지 — additive 컬럼은 **raw SQL `ALTER`**, enum ADD VALUE는 `--schema` 명시 generate ([[db-schema-drift-villa-source]]).

**네이밍 충돌 주의 (중요):** 단어 `DIRECT`는 이미 `BookingChannel.DIRECT`(결제통화 맥락 — 직접 소비자→KRW)와 `Villa.source=DIRECT`(소싱 출처 — [[availability-board-direct-booking]])에서 쓰인다. 공급자 직접판매는 **`seller=SUPPLIER`**로만 표현하고 `DIRECT` 단어를 재사용하지 않는다.

### 5.1 Booking 확장

```
enum BookingSeller { OPERATOR | SUPPLIER }

model Booking {
  ...
  seller               BookingSeller @default(OPERATOR)  // 기존 전 예약=운영자 판매 안전 백필
  supplierSalePriceVnd BigInt?       // 공급자가 자기 고객에게 받은 금액(공급자 기록용, 우리 회계 무관)
}
```

- `seller=SUPPLIER` 예약은 **공급자가 생성**(supplierId 스코프), **정산 제외**, **운영자 타임라인에 별도 셀**.
- `supplierCostVnd`는 직접판매에 무의미(우리가 매입 안 함) → null 허용.

### 5.2 VillaRatePeriod 확장 (Phase B 전용)

```
model VillaRatePeriod {
  ...
  supplierSalePriceVnd BigInt?  // 공급자 자기 판매 정가(판매 링크 자동 견적용). salePriceVnd/마진과 완전 별개
}
```

Phase A는 공급자가 예약별로 금액을 직접 입력하므로 이 컬럼 불필요. Phase B 판매 링크의 자동 견적에서만 사용.

## 6. Phase A — 공급자 직접예약 수동 기록 (MVP)

공급자가 전화·Zalo·워크인으로 판 것을 우리 앱에 기록 → 공실이 즉시 우리에게 공유.

**공급자 화면** (`app/(supplier)/calendar` 확장, UX-VN):
1. 빈 날짜 탭 → 기존 "차단" 바텀시트에 **"직접 예약 기록"** 옵션 추가
2. 입력(텍스트 최소): 체크인/아웃, 고객명, 인원, (선택) 받은 금액(VND), (선택) 연락처
3. 제출 → `POST /api/supplier/bookings` → **기존 `lockVillaInventory()` + `checkAvailability()` 트랜잭션 통과** → `Booking(seller=SUPPLIER, status=CONFIRMED)` + `writeAuditLog()`
4. 선착순 패배(운영자가 이미 홀드/예약) → "이미 예약된 날짜입니다"(마진 비공개 — 상세 비노출). 반대로 공급자가 먼저 잡으면 운영자가 못 홀드
5. 취소: 공급자는 `seller=SUPPLIER` + 자기 `supplierId` 예약만 취소 가능

**운영자 화면** (FE):
- 대시보드 타임라인 매트릭스에 **신규 셀 상태 "공급자 직접예약"**(별도 색) — 선점 판단의 핵심 정보. `lib/timeline.ts` 셀 enum 확장(T1.5 계약 호환)
- 예약 목록 `/bookings`에 `seller` 필터 추가

**정산(F6, BE):** 집계 쿼리에 `seller=OPERATOR` 필터 추가 → 직접예약 제외.

**체크인·아웃 검수(D5 — 공급자 직접 수행, UX-VN/BE):** 직접예약 게스트도 정식 F4 검수를 받는다. **공급자가 자기 빌라 현장에서 vi 모바일로** 수행:
- **체크인**: 여권 사진 업로드 → Gemini OCR(이름·여권번호) → 보증금 기록 → 이용 동의서(`lib/agreement.ts`, 수영장 조항 자동) 터치 서명 → `status=CHECKED_IN`. 임시거주신고는 공급자 본인이 처리하므로 "운영자에게 전달" 단계 제외.
- **체크아웃**: 기준 사진 대조 촬영 → 파손/보증금 처리 → `status=CHECKED_OUT` → `CleaningTask` 생성 + `isSellable=false`(누가 묵었든 청소 필요).
- **구현**: 비즈니스 로직 `lib/checkin.ts`·`lib/checkout.ts` 그대로 재사용. UI는 공급자 vi 신규 라우트(`app/(supplier)/` 하위), 권한은 `seller=SUPPLIER` AND `villa.supplierId === session.user.id`로 스코프(운영자 마진·타 공급자 도달 불가). 여권·서명은 기존 비공개 증빙 파이프라인 재사용(공급자도 자기 게스트분만).
- 직접예약 *개시* 자체는 isSellable 게이트로 막지 않음(D4).

**Zalo(INTEG):** 공급자 직접예약 생성 시 운영자에게 정보성 알림(선점 기회 인지). `NotificationType`에 `SUPPLIER_DIRECT_BOOKING` 추가.

## 7. Phase B — 공급자 판매 링크 (본격 도구, 별도 스프린트)

기존 `/p/[token]` + Proposal/Hold 인프라를 공급자용으로 확장:
- 공급자가 `my-villas/[id]/rate-periods`에서 **자기 판매가**(`supplierSalePriceVnd`) 입력
- 공급자가 "판매 링크 만들기" → 자기 빌라 + 기간 → 공개 토큰 링크(`Proposal` 재사용, `seller=SUPPLIER` + `supplierId` 스코프, 제안 생성 권한을 `canSetPrice`에서 분리한 신규 권한 `canCreateSupplierLink`)
- 공급자 고객이 링크 열람 → 사진·**공급자 판매가**·실시간 가용성 → 가예약(HOLD) → 공급자가 입금 확인 → CONFIRMED
- 동일 선착순 게이트, 정산 제외

**보안 핵심:** 공급자 판매 링크는 공급자 자기 빌라·자기 판매가만 노출. 우리 `salePriceKrw`·마진·타 공급자 빌라 절대 비노출. 운영자 제안링크와 토큰 네임스페이스/권한 분리.

## 8. 권한·누수 검증 (QA 필수)

| 케이스 | 기대 |
|---|---|
| 공급자가 타인 빌라에 직접예약 생성 시도 | 403 (supplierId 스코프) |
| 공급자 직접예약 API 응답에 운영자 salePriceKrw/마진 포함 여부 | 0건 |
| 운영자가 홀드한 날짜를 공급자가 직접예약 시도 | 409 "이미 예약됨"(상세 비노출) |
| 정산 집계에 seller=SUPPLIER 예약 혼입 여부 | 0건 |
| Phase B 공급자 판매 링크에서 타 공급자 빌라/우리 판매가 도달 | 불가 |

## 9. 작업 순서

| 단계 | 범위 | 규모 | 담당 |
|---|---|---|---|
| A1 | `Booking.seller` + `supplierSalePriceVnd` raw SQL ALTER, 기존 데이터 OPERATOR 백필 | 소 | TDA·BE |
| A2 | `/api/supplier/bookings` + 캘린더 직접예약 폼, 가용성 게이트 재사용, AuditLog | 중 | BE·UX-VN |
| A3 | 운영자 타임라인 신규 셀 + `/bookings` seller 필터 | 소 | FE |
| A4 | 정산 `seller=OPERATOR` 필터 + 누수 QA + Zalo 알림 | 소 | BE·QA·INTEG |
| A5 | 공급자 vi 체크인·아웃 검수 화면(D5) — lib/checkin·checkout 재사용, seller=SUPPLIER+supplierId 스코프, 여권·동의서·청소 | 중 | UX-VN·BE·QA |
| B | 공급자 판매가 + 공개 판매 링크 + 셀프 가예약 (별도 스프린트) | 대 | 전원 |

## 10. 미해결/후속

- ~~Phase A 직접예약 체크인·아웃 검수 흐름~~ → **D5로 확정(2026-06-26)**: 정식 F4 적용, 공급자가 vi 모바일로 직접 수행. A5 태스크.
- 선착순 하에 운영자 홀드 스쿼팅(48h) 우려 → 홀드 자동 만료로 시간 제한적. 모니터링 후 개선(IDEAS).
- D5 후속: 공급자가 검수를 미수행한 채 체크아웃하려는 경우 처리(여권·서명 게이트 강제 vs 경고). 기존 운영자 플로우는 서명 비게이트(T3.1 조건 C)였음 — 공급자 플로우도 동일하게 비게이트+미서명 배지로 시작, 운영 후 강화 검토.
