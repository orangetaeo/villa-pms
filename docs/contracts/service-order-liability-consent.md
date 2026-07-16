# service-order-liability-consent — 부가서비스 신청 시 책임 제한 고지 + 동의 게이트

> 배경: 테오 지시 2026-07-16 — "부가서비스 신청할 때 안내조항 아주 작게 넣어서 동의 버튼을 누르도록". 취지: **운영자는 중개만 하며, 서비스 이행·품질·위생·안전(예: 음식 식중독) 책임은 해당 제공업체에 있음**을 소비자가 신청 시점에 확인·동의. 사업 계약서 03(부가서비스 업체) 책임 구도와 대칭. #335 직판 동의(Booking.policyConsentJson) 패턴 재사용.

## 범위

1. **스키마 (additive, TDA=메인 세션 확정)**: `ServiceOrder.liabilityConsentJson JSONB NULL`
   - 라이브 DB에 `ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "liabilityConsentJson" JSONB;` 적용 + `prisma/migrations-manual/2026-07-16-service-order-liability-consent.sql` 보존 + schema.prisma 반영 + `npx prisma generate`
   - 내용(서버 산출 — 클라 값 불신): `{ agreedAt: ISO, version: string, locale, source: "guest" | "partner" }`
   - **백필 금지** — 기존 주문 null 유지(null=동의 제도 이전 주문, 역사 생성 금지)
2. **단일 원천 모듈**: `lib/service-liability.ts` — `SERVICE_LIABILITY_VERSION`(예: "2026-07-16.v1") + 5언어(ko/en/vi/ru/zh) 고지 텍스트 `{ title, body, consentLabel }`. 게스트/파트너 화면 모두 이 모듈에서 가져다 씀(문구 이중 관리 금지). 문구 수정 시 VERSION 올림.
3. **서버 게이트 (소비자 신청 2경로, 대칭)**:
   - `POST /api/g/[token]/service-orders` — body `liabilityConsent !== true` → **400 CONSENT_REQUIRED**. true면 서버가 스냅샷 구성해 저장(source: "guest")
   - `POST /api/p/[token]/service-orders` — 동일 게이트(source: "partner")
   - **admin 경로(`/api/bookings/[id]/service-orders`)는 미적용** — 운영자 대리 생성(전화·현장 주문), 동의 주체가 화면에 없음
4. **UI (게스트 /g 옵션 신청 + /p 부가서비스 신청)**: 신청 CTA 직전에 **작은 글씨(text-xs, muted)** 고지 박스 + 필수 체크박스("위 내용을 확인했으며 동의합니다"). 체크 전 신청 버튼 disabled(서버 400과 대칭). 언어는 해당 화면의 현재 언어 규칙 따름(5언어).
5. **운영자 가시성**: admin 주문 상세/패널에서 동의 여부·시각·버전 1줄 표시(있을 때만, 비침습).
6. **번역**: ko 원문 확정 후 LOC가 en/vi/ru/zh 감수. 문구는 "책임 전가"가 아닌 "중개자 지위 + 이행 책임은 제공업체 + 운영자는 연락·중재 지원" 톤. ⚠법률 문구는 추후 VN 변호사 검토 대상(계약서 3종 검토와 함께 — 백로그 연계).

## ko 원문 초안 (LOC 감수 대상)

- title: "책임 제한 안내"
- body: "부가서비스(마사지·BBQ·티켓 등)는 Villa GO가 **중개**하며, 서비스의 이행·품질·위생·안전에 대한 책임은 각 서비스 제공업체에 있습니다. 이용 중 발생한 문제(음식 위생, 안전사고 등)는 제공업체에 책임이 있으며, Villa GO는 연락과 분쟁 해결을 지원합니다."
- consentLabel: "위 내용을 확인했으며 동의합니다."

## 완료 기준 (QA 검증 항목)

- [ ] /g·/p 신청: 동의 없이 POST → 400 CONSENT_REQUIRED / 동의 시 liabilityConsentJson 서버 스냅샷 저장(agreedAt·version·locale·source)
- [ ] admin 대리 생성: 동의 미요구·미저장(회귀 0)
- [ ] 스냅샷 version=서버 상수(클라 주입 불가), 기존 주문 null 유지
- [ ] 체크 전 신청 버튼 disabled, 체크 후 정상 주문 생성(무료 티켓 자동 확정 경로 포함)
- [ ] 고지 텍스트 5언어 모두 lib/service-liability.ts 단일 원천에서 렌더(이중 정의 없음)
- [ ] admin 주문 상세 동의 1줄 표시(없으면 미표시)
- [ ] 누수: 고지·동의 응답에 원가·마진·벤더 내부정보 없음
- [ ] tsc 0 · lint · next build · 기존 테스트 회귀 0 (+신규: 가드 400 2경로·스냅샷 저장·admin 미적용)

## 수정 금지 구역

- Booking.policyConsentJson·/api/p hold 직판 동의 로직(#335) — 별개 동의, 건드리지 않음
- lib/agreement.ts(체크인 동의서)·사업 계약서 문서(docs/business/)
- 벤더 발주·수락·QR 발행 체인(vendorStatus 전이 로직)
- 주문 검증 공유 모듈(lib/ticket-order-validation.ts, lib/ticket-vendor-guard.ts) — 게이트는 라우트 최상단에 추가만
