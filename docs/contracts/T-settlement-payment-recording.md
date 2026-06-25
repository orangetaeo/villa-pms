# 계약: 정산 2차 P2-1 — 실수납 기록 (Payment 배선)

- 태스크: 정산 고도화 Phase 2, 1순위. 테오 2026-06-25 착수 선택.
- 담당: BE/FE (운영자 ADMIN 측). 평가: QA(작성자≠평가자).
- 브랜치: `wt/settlement-payment` (origin/main 461200e 기준).
- 선행: 1차 손익 요약(`lib/settlement-finance.ts`) 완료·배포. [[settlement-finance-status]]

## 배경
1차는 견적 판매가(`Booking.totalSaleKrw/Vnd`)를 **수납액으로 간주**했다. 실제 입금(부분·수단·실환율)은 미반영. `Payment` 모델은 스키마·라이브 DB에 **이미 완비**(currency·amount·method·fxRateToVnd·vndEquivalent·receivedAt·note)되었으나 앱 코드에서 미사용(기존 53행=데모 시드). P2-1은 이 모델을 배선해 **실수납을 기록·집계하고 미수/초과를 가시화**한다.

## 결정사항 (테오 확정)
- 첫 스프린트 범위 = **P2-1만**(상태확장 P2-2·LEDGER P2-3·PDF P2-4 제외).
- Payment 범위 = **숙박비 수납만**. 보증금(`Booking.depositAmount/depositStatus`)은 분리 유지(환급 대상·매출 아님). Payment는 보증금과 무관.

## 스코프 (IN)
1. **결제 기록 API** — `app/api/bookings/[id]/payments`
   - `POST` (ADMIN 전용): currency·amount(최소단위 BigInt)·method·receivedAt·fxRateToVnd?·note? 입력. `vndEquivalent` 서버 계산(VND=amount, KRW=amount×fxRateToVnd half-up). KRW인데 fxRateToVnd 없으면 400. `writeAuditLog`(action=CREATE, entity=Payment).
   - `GET` (ADMIN 전용): 해당 예약 결제 목록 + 합계.
   - `DELETE` (개별 결제) — `app/api/payments/[id]` (ADMIN, `writeAuditLog` action=DELETE). 오기록 정정용.
2. **예약상세 결제 패널** — `app/(admin)/bookings/[id]` 에 결제 목록(통화·수단·금액·수납일·환율·메모) + 추가 폼 + **수납 요약**(견적 판매가 / 실수납 합 / 미수 or 초과 or 완납). 통화 기호 병기, BigInt 안전 직렬화.
3. **정산 손익 패널 실수납 연동** — `/settlements` 운영자 손익 패널이 **견적가 대신 실수납 Payment 합계**(VND환산=Payment.vndEquivalent 합)를 매출로 집계. 견적 대비 **미수 총액** 표기. `lib/settlement-finance.ts`는 순수층 유지하고 실수납 입력을 받도록 확장(또는 신규 `collectedFromPayments` 헬퍼).

## 스코프 (OUT — 명시)
- Settlement 상태 enum 확장(COLLECTED·FX_ADJUSTED) — P2-2.
- 복식부기 LEDGER 모델 — P2-3. PDF — P2-4.
- 보증금 입금·환급 기록. 스키마 변경(Payment 추가 필드).
- 공급자 정산(`lib/settlement.ts`, supplierCostVnd) 로직 — 무변경.

## 누수 규칙 (절대 — leak-checklist)
- Payment(수납액=판매가 측)·미수·VND환산·마진은 **ADMIN(canViewFinance) 전용**. 공급자 `/earnings`·`/my-villas`·Zalo 정산공유·공급자용 GET API에 **절대 미노출**.
- 결제 API 첫 줄 role 검사(`isSystemAdmin`/canViewFinance). STAFF 차단.
- 서버에서만 금액 계산, 클라엔 포맷 문자열만. BigInt→string 직렬화.

## 완료 기준 (테스트 가능)
1. POST 결제: VND·KRW(환율 동반) 정상 기록, vndEquivalent 서버 계산 정확(half-up). KRW+환율누락 400. 비ADMIN 403, 비인증 401. AuditLog 기록.
2. DELETE 결제: ADMIN 삭제+AuditLog. 타역할 403.
3. 수납 요약 순수함수: 견적 vs 실수납 합 → 미수/초과/완납 분기, 혼합통화 vndEquivalent 합산, 부분입금 누적. 단위 테스트.
4. 정산 손익 패널: 실수납 합계·미수 총액 표기, 환율미상 건수 유지.
5. **누수 0**: 공급자 표면(/earnings·GET 공급자 API)에 Payment·미수·마진 미노출 — 정적+동적 실증.
6. typecheck 0 · 전체 테스트 통과(+신규) · 라이브 DB Payment 테이블 실측(완료, 10컬럼).

## 검증 방법
- vitest: payment vndEquivalent 계산·수납요약 분기·API 가드(핸들러 직접호출 mock).
- 누수: 공급자 세션으로 GET 결제 API 403, /earnings 응답에 Payment 부재 grep.
- QA 독립 평가(작성자≠평가자) + 프로덕션 스모크.
