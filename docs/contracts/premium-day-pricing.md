# 계약서: 프리미엄일(요일·공휴일) 2단 요금

- **태스크**: premium-day-pricing
- **착수일**: 2026-07-13
- **브랜치**: wt/premium-day-pricing
- **배경**: 성수기+주말처럼 특정 요일·공휴일에 웃돈을 받는 빌라가 있음. 겹침 기간 + "금액 큰 쪽 승리" 방식은 가격 필드가 다축(원가/Net/소비자가 × VND/KRW)이라 승자 정의가 불가 → **기간 행 내부에 프리미엄 가격 컬럼**을 두는 방식으로 확정(사용자 합의).

## 설계 요지

박별 판정: `프리미엄 박 = (요일 ∈ 빌라 premiumDays) ∨ (날짜 ∈ 공휴일 캘린더)`
→ 프리미엄이면 기간 행의 premium* 컬럼 사용, **null이면 평일 가격 폴백**(무중단).
요일 판정은 숙박일 `@db.Date` 특성상 `getUTCDay()` 기준. 기본값 금(5)·토(6).
공휴일은 전역 날짜 목록(한국·베트남 공용), 전야 자동 계산 없음(운영자가 명시 입력).

## 범위

1. **스키마 (additive raw SQL — prisma/migrations-manual/)**
   - `Villa.premiumDays Int[] @default([5,6])`
   - `HolidayDate` 테이블 (date @db.Date unique, label, createdAt)
   - `VillaRatePeriod`에 nullable 프리미엄 컬럼: `premiumSupplierCostVnd`, `premiumSalePriceVnd/Krw`, `premiumConsumerSalePriceVnd/Krw`, `premiumSupplierSalePriceVnd` (세부는 TDA 회의에서 확정)
2. **엔진 (lib/pricing.ts)** — `quoteStayByPeriod` 박 루프 1곳에 프리미엄 판정 삽입. `NightQuote`에 `premium` 플래그(+사유). 호출부에 공휴일·premiumDays 전달(quoteStayForVilla 경유 단일 원천 유지).
3. **운영자 UI** — 기간 편집 폼 "프리미엄 요금" 토글+가격칸, 공휴일 관리 화면(연도별 목록·추가·삭제), 견적/예약 박별 내역 프리미엄 뱃지.
4. **공급자 UI (vi)** — 자기 원가의 프리미엄 칸 입력(토글), 요일 설정. 마진·판매가 절대 비노출.
5. **i18n** — ko/vi 동시.

### 범위 제외 (IDEAS.md행)
- 월 캘린더 가격 프리뷰(별도 태스크), 요일별 7단 매트릭스, 공휴일 프리셋 자동 채움, iCal 요금 연동.

## 완료 기준 (테스트 가능)

1. 단위: 금·토 박·공휴일 박에 프리미엄가 적용, premium* null이면 평일가 — pricing 테스트 통과
2. 회귀: 기존 빌라(프리미엄 미설정) 견적 결과 **완전 불변**
3. 누수: 공급자·공개(/p·/g) 라우트 응답에 premiumSalePrice*/premiumConsumer* 미포함 (QA leak-checklist)
4. 견적·저장·영수증이 동일 엔진 경유(박별 premium 플래그 일치)
5. `next build` + typecheck 통과, AuditLog: 공휴일 CUD·기간 프리미엄 변경 기록

## 검증 방법

- pricing 순수함수 단위 테스트 + QA 독립 검증(Playwright, 운영자 기간 입력→견적 확인)
- 수정 금지 구역: 이 계약 외 진행 중 타 세션 파일 (git status 미지 파일 불가침)
