# Contract: T-partner-booking-detail — 여행사(PARTNER) 예약 상세 + 투숙객 명단 사전 제출 (E)

## 배경
파트너 포털 예약현황이 목록만(상세·액션 없음). 투숙객 명단(guestRoster)은 현재 공개 토큰 링크(/p/[token]/roster)·ADMIN만 입력 가능 — 로그인한 파트너가 자기 예약에서 직접 명단을 사전 제출할 경로가 없음. 후속 후보 E 구현.

## 범위 (수정/신규 파일)
- 수정 `lib/partner-portal.ts` — `PartnerBookingDetail` 인터페이스 + `loadPartnerBookingDetail(partnerId, bookingId)` 누수안전 로더(본인 partnerId만, guestRoster 포함). ★KRW·원가·마진·미니바·서비스·타파트너 절대 select 금지.
- 신규 `app/api/partner/bookings/[id]/roster/route.ts` — PATCH: requireAuth+PARTNER+본인 partnerId 예약(IDOR), HOLD/CONFIRMED만, guestRoster만 수정 + AuditLog, assertSameOrigin+rate-limit. (공개 /api/p/[token]/roster의 로그인 미러)
- 신규 `app/partner/bookings/[id]/page.tsx` — 예약 상세(빌라·기간·게스트·상태·객실료 VND·명단). 미소유/미존재 notFound.
- 신규 `components/partner/partner-roster-form.tsx` — 명단 입력 폼(HOLD/CONFIRMED만 편집).
- 수정 `app/partner/page.tsx` — BookingCard를 /partner/bookings/[id] 링크로.
- i18n `messages/ko.json`·`vi.json` partner 네임스페이스 키 추가만.

## 수정 금지 구역
- prisma/* seed, 공개 /p/[token]/roster, 관리자 화면, lib/partner-invoice-* 
- 신용한도·마진·KRW 노출 금지(사업원칙 2)

## 완료 기준 (테스트 가능)
1. 파트너 로그인 → 예약 카드 클릭 → 상세 도달, 타 파트너 bookingId는 notFound(IDOR)
2. HOLD/CONFIRMED 예약에서 명단 입력·저장 성공, 체크인 이후·취소·만료는 편집 차단(409)
3. 명단 저장 시 guestRoster만 변경 + AuditLog 적재(상태·금액 불변)
4. 누수 0: 상세·응답에 KRW·원가·마진·미니바·서비스·타파트너 없음
5. typecheck·lint·build 0, 독립 QA PASS

## 검증 방법
typecheck/lint/build + 독립 QA(IDOR·누수) + (배포 후) Playwright 파트너 워크스루
