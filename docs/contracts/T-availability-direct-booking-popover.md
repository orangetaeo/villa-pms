# T-availability-direct-booking-popover — 공실 보드: 직접공급(DIRECT) 빌라 예약 팝오버

## 배경
공실 보드(`/availability`)는 의도적으로 Booking을 표시하지 않고 CalendarBlock(MANUAL/ICAL) 잠금·공실만 다룬다
(기존 계약 `T-admin-availability-board` 완료기준 #7). 근거: 공급자 재고와 우리 판매분이 한 화면에 섞이면 재고가 노출됨.

이번 태스크는 **운영자(테오팀)가 직접 수집·공급한 빌라(DIRECT)에 한해** 그 제약을 푼다.
DIRECT 빌라는 외부 공급자가 없어 누수 대상이 없고, 보드는 ADMIN 전용이므로, 예약이 걸린 셀을 별색으로 칠하고
클릭 시 예약 요약 팝오버를 띄운다. 공급자 빌라(SUPPLIER)는 **기존 그대로** 잠금/해제만 동작.

## 사용자 결정 (2026-06-24)
1. 빌라 출처 구분 = **스키마에 `Villa.source` 필드 추가** (운영자 계정 우회 아님)
2. 예약정보 표시 = **보드 위 팝오버 카드** (드로어·페이지이동 아님)

## 범위 (이 태스크가 만지는 파일 — 소유 선언)
- `prisma/schema.prisma` — `enum VillaSource { SUPPLIER, DIRECT }` + `Villa.source VillaSource @default(SUPPLIER)` 추가만 (additive). DB push 전담.
- `lib/availability.ts` — 보드 집계에 DIRECT 빌라 예약맵 추가 (기존 시그니처는 옵션 인자 추가만, 하위호환 유지)
- `app/(admin)/availability/page.tsx` — 세션 role → `canViewFinance` 전달, 예약 관련 strings 추가
- `app/(admin)/availability/board-client.tsx` — 예약 셀 상태(BOOKING) 렌더 + 예약 팝오버 카드
- `messages/ko.json` · `messages/vi.json` — `availabilityBoard.*` 하위 키 **추가만**
- `tests/availability-direct-booking.test.ts` (신규) — 집계·누수 게이트 단위 테스트
- 빌라 등록/수정 폼의 source 토글은 **이 태스크 범위 밖**(별도) — 스키마·기본값만 둔다

## 수정 금지 구역 (다른 세션 작업 중 — 절대 미수정)
- `messages/ko.json`·`messages/vi.json`의 기존 키 (오직 `availabilityBoard` 하위 추가만, hunk 선별 커밋)
- `lib/cleaning.ts`, `lib/hold.ts`, `lib/proposal.ts`, `docs/DESIGN.md` (미니바 누수 세션 작업 중)
- `app/(supplier)/**`, `app/api/villas/[id]/amenities/**` (미니바 세션)
- `app/(admin)/layout.tsx`, `middleware.ts`

## 완료 기준 (테스트 가능)
1. `Villa.source` 필드 추가, 기존 빌라 전부 `SUPPLIER`로 백필(default), DB push 성공
2. DIRECT 빌라의 점유 예약(HOLD/CONFIRMED/CHECKED_IN)이 보드 셀에 별색으로 표시됨 (잠금색과 구분)
3. SUPPLIER 빌라는 예약 셀이 **전혀 표시되지 않음** (기존 동작 보존 = 누수 없음)
4. DIRECT 빌라 예약 셀 클릭 → 팝오버: 상태·기간·박수·게스트·인원·채널·원가·보증금·(HOLD면 만료까지)·[예약 상세 →]
5. **STAFF 역할은 팝오버에 판매가(KRW/VND)가 노출되지 않음** — DB select 단계에서 제외 (S-RBAC-3 패턴)
6. 마진은 어디에도 표시 안 함
7. 예약 셀은 잠금/해제·드래그 대상에서 제외 (ICAL 셀과 동일하게 읽기전용 취급)
8. 예약 셀에서 `[예약 상세 →]` 클릭 시 기존 `/bookings/[id]`로 이동

## 검증 방법
- `npx tsc --noEmit` (typecheck) + `npm run lint` 통과
- `npx next build` 통과 (배포 게이트)
- 단위 테스트: DIRECT만 예약맵 채움 / STAFF면 saleKrw·saleVnd null / 셀 우선순위(BOOKING > 잠금)
- QA: STAFF 계정으로 팝오버에 판매가 미노출 확인 (누수 체크리스트)

## 파이프라인
TDA(스키마 push) → BE(집계 + 누수 게이트) → FE(보드 셀·팝오버) → LOC(ko/vi 키) → QA(누수검사)
