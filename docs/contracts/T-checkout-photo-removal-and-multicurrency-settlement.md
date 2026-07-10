# 계약: 체크아웃 사진 섹션 제거 + 미니바 수납 다통화(환산 표시·분할 수납)

- 상태: 착수 (2026-07-10)
- 요청자: 테오
- 담당: BE(구현) → QA(독립 검증)
- 브랜치: worktree-checkout-photo-removal-multicurrency

## 배경 (테오 요청 원문 요지)

1. 체크아웃 검수의 "체크아웃 사진" 항목을 **완전히 제거**한다. 사진은 파손·손실이 있을 때만
   (파손 리포트에서) 입력하면 된다.
2. "미니바 차감 합계"가 VND로만 표시되어 원화 환산 금액이 없다. 소비자는 VND·USD·KRW로,
   또는 여러 통화를 **나눠서** 내고 싶은데 현재는 기록할 방법이 없다.

## 범위

### A. 체크아웃 사진 섹션 완전 제거
- `app/(admin)/bookings/[id]/checkout/checkout-form.tsx` — "객실 상태 비교" 섹션 전체 삭제
  (photos state·onSectionPhoto·sections prop·라이트박스·sectionDone/Missing 뱃지·guide.photos).
  제출 가능 조건에서 `photoUrls.length >= 1` 요건 제거.
- `app/(admin)/bookings/[id]/checkout/page.tsx` — sections 구성(빌라 baseline 사진 조회·SPACE_ORDER
  정렬·general 폴백) 제거.
- `app/(supplier)/my-bookings/[id]/checkout/checkout-form.tsx` + 해당 page — 동일 정책 적용
  (공급자 직접판매 체크아웃도 사진 섹션 제거).
- `lib/checkout.ts` — `photoUrls` 1장 이상 검증 삭제, 입력 optional(기본 `[]`).
  CheckOutRecord.photoUrls 컬럼은 유지(과거 기록 보존, 신규는 빈 배열).
- `app/api/bookings/[id]/checkout/route.ts`·`app/api/supplier/bookings/[id]/checkout/route.ts` —
  zod `photoUrls` optional 기본 `[]`.
- 파손 리포트(damageFound + damagePhotos + damageNote)는 현행 유지 — 파손 시 메모 또는 사진 필수 게이트 유지.
- i18n: 사진 섹션 전용 키(comparison·baseline·checkoutPhoto·sectionDone·sectionMissing·uploadPhoto·
  generalPhotos·guide.photos 등) — **다른 화면에서 미사용 확인 후** ko/vi 동시 제거. `spaces.*`는 타 화면
  사용 여부 grep 후 판단.
- 투어/코치마크: checkout 화면 data-tour 스텝에 사진 섹션이 있으면 tour-definitions + tour NS 동시 갱신.

### B. 미니바 합계 환산 표시 + 다통화 분할 수납
- **표시(근사 환산 "≈", 저장금액 아님)**: `lib/fx-rates.ts` getDailyRates 재사용.
  - page.tsx(server)에서 환율 조회 → 폼에 `{ date, vndPerKrw, vndPerUsd } | null` 전달.
  - 미니바 차감 합계 스트라이프에 `≈ ₩x · ≈ $x` 병기.
  - 게스트 청구서 총액(VND)에 동일 병기 + KRW 청구분 포함 **통합 환산 총액**(≈₫/≈₩/≈$) 표기.
  - 환율 캐시 없으면(장애) 환산줄 생략(VND만 — 현행과 동일).
- **수납(분할, 실금액 저장)**: CheckOutRecord에 additive 컬럼 4개.
  ```prisma
  settledVnd   BigInt?  // 수납액 VND(동)
  settledKrw   Int?     // 수납액 KRW(원)
  settledUsd   Int?     // 수납액 USD(정수 달러 — 기존 관행)
  settlementFx Json?    // 수납 시점 환율 스냅샷 { date, vndPerKrw, vndPerUsd }
  ```
  - 마이그레이션: **raw SQL additive** (`prisma/migrations-manual/`) — db push 금지(Railway 라이브 DB 규칙).
  - API: `settlement: { method, note?, amounts?: { vnd?: 숫자문자열, krw?: int, usd?: int } }`.
    amounts의 환율 스냅샷은 **서버가** getDailyRates로 조회해 저장(클라 환율 신뢰 금지).
  - 폼 수납 패널: 통화별 수납액 입력 3필드(₫/₩/$) + 수납 환산 합계·잔여(≈) 실시간 표시.
    잔여/초과는 **소프트 안내만**(하드 블록 없음 — 협상·반올림 여지). 단, 수납액 입력 시 결제수단 미선택이면 제출 차단.
  - 공급자 체크아웃 수납 UI는 현행 유지(VND 단일) — 스코프 밖.
- 예약 상세 정산 표시(`service-orders-panel.tsx` 등 settlementMethod 노출처)에 통화별 수납액 표기 추가.

## 완료 기준 (테스트 가능)
1. 관리자 체크아웃 화면에 사진 업로드 UI가 없고, 사진 없이 전액 환불/차감 후 환불 제출이 성공한다.
2. 파손 ON 시 메모·사진 요구 게이트는 그대로 동작한다.
3. 미니바 합계·게스트 청구서에 ≈₩/≈$ 환산이 표시된다(환율 캐시 존재 시).
4. VND+KRW+USD를 나눠 입력해 제출하면 CheckOutRecord에 3필드+환율 스냅샷이 저장되고
   예약 상세에서 통화별 수납액이 보인다.
5. `lib/checkout.test.ts` 갱신 포함 기존 테스트 전부 통과, `next build` 통과.
6. QA: 마진·원가 비노출 유지(공급자 응답 필드 불변), 금액 BigInt/정수 규칙 준수(부동소수점 저장 금지).

## 수정 금지 구역
- prisma/schema.prisma 외 스키마 모델(additive 4컬럼만), Zalo 알림 payload, 정산(LEDGER) 경로.
