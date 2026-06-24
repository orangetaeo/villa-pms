# 계약: T-agency-roster-selfinput — 여행사 셀프 투숙객 명단 입력 (안 B)

## 배경
[[T-guest-roster]](안 A)로 ADMIN이 예약 상세에서 투숙객 실명을 입력하는 경로는 라이브. 안 B는 **비로그인 여행사가 직접** 명단을 입력하게 해 테오의 중계 부담을 없앤다. (Phase 2 — 테오 지시로 착수 2026-06-25)

## 접근 방식 (결정)
- **접근 토큰 = 기존 제안 토큰 재사용** — 새 컬럼/스키마 변경 **없음**(db push 불필요, Villa.source 드리프트 회피 [[db-schema-drift-villa-source]]). 여행사는 이미 제안 링크 토큰을 갖고 있고, 가예약 후 done 페이지에서 명단 입력 페이지로 진입.
- 경로: `/p/[token]/roster/[bookingId]` (공개 `/p` 패턴, ko, 비로그인).
- **저장 대상은 `Booking.guestRoster` 단일 컬럼만** (안 A와 동일 컬럼 공유 — ADMIN·여행사 양쪽이 같은 값 편집).

## 범위 (이 PR — 격리 worktree `wt/roster-selfinput`, 스키마 변경 0)
1. **공개 API** `app/api/p/[token]/roster/route.ts` (POST): hold route 패턴 그대로 — rate-limit(token+IP), `proposalItem.proposal.token === token` 교차 토큰 가드, 상태 HOLD·CONFIRMED만 허용(CHECKED_IN 이후·취소·만료는 거부), `guestRoster`만 업데이트(빈 문자열 null), AuditLog(userId=null 공개 액션). 다른 필드 strip.
2. **공개 페이지** `app/p/[token]/roster/[bookingId]/page.tsx`: 교차 토큰 가드 + 상태 가드(done 페이지와 동일), 빌라명·체크인/아웃·박수·인원 요약 + 명단 폼. **마진·원가·판매가 절대 미select**(요약엔 가격 불필요).
3. **폼 컴포넌트** `app/p/_components/roster-form.tsx`: textarea + 저장 → POST. booking-form 패턴 재사용.
4. **done 페이지 링크**: 가예약 완료 후 "투숙객 명단 입력하기" CTA → roster 페이지.
5. **테스트**: 교차 토큰 404 / rate-limit 429 / 상태 거부(CHECKED_IN·CANCELLED) / guestRoster 저장·빈값 null / 상태·금액 주입 strip / 마진 미노출.

## 디자인
별도 Stitch export 없음 — `/p` 공개 디자인 시스템(c3 done 페이지: `max-w-md`·teal·MESH_BG·header·PublicFooter)과 c3 booking-request 입력 폼을 **로컬 컴포지션**으로 재사용(b1-mobile·a9 선례와 동일 방식). 신규 디자인 토큰 도입 없음.

## 수정 금지 구역 (타 세션 점유)
- `app/(admin)/bookings/checkin-sheet/*` (타 세션 재구성 중) · `lib/hold.ts`·`proposal.ts` — **읽기만**.
- `messages/*.json` 변경 **없음** — `/p` 페이지는 ko 하드코딩(done 페이지와 동일 관례).

## 완료 기준
- [ ] 스키마 변경 0 · db push 0
- [ ] typecheck 0 · `next build` 성공 · `npm test` 신규 포함 green
- [ ] 교차 토큰 차단(타 제안 bookingId 404) · rate-limit 429 · CHECKED_IN/CANCELLED/EXPIRED 거부 실증
- [ ] guestRoster 저장→재조회 반영, 빈값 null, 상태/금액 주입 strip
- [ ] roster 페이지·API 어디에도 supplierCostVnd·totalSale*·fx 미노출 (leak-checklist)
- [ ] done 페이지에서 roster 페이지 진입 동선

## 후속 (이 PR 밖)
- D-3 Zalo 명단 리마인더 cron(미입력 예약에 roster 링크 발송) — 별도 OPS 태스크.
- ADMIN(안 A)·여행사(안 B) 동시 편집 충돌은 last-write-wins 허용(저빈도, AuditLog로 추적).
