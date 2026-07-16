# T-proposal-policy-consent — 가예약 시 취소·환불 규정 전자 동의 기록

> 배경: 사업 계약서 프레임워크 §7(docs/business/contracts/00-contract-framework.md) — 직판(B2C)은 판매자가 우리라서 **입금 전 취소·환불 규정 동의**가 분쟁 방어의 핵심. 현재 /p 페이지는 정책 3단 박스 표시만 하고 동의 기록이 없음(갭). 테오 승인 2026-07-16 "진행 해줘".

## 범위

1. **스키마 (additive, TDA=메인 세션 확정)**: `Booking.policyConsentJson JSONB NULL`
   - 라이브 DB에 `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "policyConsentJson" JSONB;` 적용 + `prisma/migrations-manual/2026-07-16-booking-policy-consent.sql` 보존 + schema.prisma 반영 + `npx prisma generate`
   - 내용(서버 산출 — 클라 값 불신): `{ agreedAt: ISO, policy: { fullDays, partialDays, partialPct }, locale, source: "proposal" }` — 동의 시점의 정책 스냅샷(정책이 나중에 바뀌어도 동의 당시 조건 증빙)
2. **서버**: /p 가예약(홀드 생성) POST — `CANCELLATION_POLICY.enabled=true`일 때 요청 body의 동의 플래그(`policyConsent: true`) 없으면 **400 CONSENT_REQUIRED**. 있으면 서버가 AppSetting에서 정책을 읽어 스냅샷 구성 후 Booking에 저장. `enabled=false`면 동의 미요구·미저장(하위호환).
3. **UI (/p 공개 페이지)**: 가예약 확정 UI에 체크박스 "취소·환불 규정을 확인했으며 동의합니다" — 체크 전 가예약 버튼 disabled. 정책 박스가 표시되지 않는 경우(enabled=false) 체크박스 미노출. i18n 키 ko/vi 동시(해당 페이지 기존 NS 관례 따름 — /p가 다국어면 전 언어).
4. **운영자 가시성**: admin 예약 상세에서 동의 여부·시각 1줄 표시(있을 때만) — 증빙은 보여야 쓸모 있음.

## 완료 기준 (QA 검증 항목)

- [ ] enabled=true: 동의 없이 POST → 400 CONSENT_REQUIRED / 동의 시 Booking.policyConsentJson에 서버 스냅샷 저장
- [ ] enabled=false: 체크박스 미노출 + 서버 미요구(기존 플로우 회귀 0)
- [ ] 스냅샷 값=AppSetting 서버 값(클라 주입 불가)
- [ ] 체크 전 버튼 disabled, 체크 후 정상 홀드 생성
- [ ] admin 예약 상세 동의 표시(비침습, 없으면 미표시)
- [ ] 누수: policyConsentJson에 금액·마진 없음(정책 %·일수만). 공개 라우트 응답에 불필요 노출 없음
- [ ] tsc 0 · lint · next build · 기존 테스트 회귀 0 (+신규 테스트: 가드 400·스냅샷 저장·disabled 폴백)

## 수정 금지 구역
- 운영자 수동 예약(/bookings/new)·게스트 /g 플로우 (범위 외 — 직판 /p만)
- lib/agreement.ts (체크인 동의서 — 별개 문서 체계)
- 홀드 만료 cron·기존 홀드 상태 전이 로직
