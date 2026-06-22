# T-admin-availability-board — 운영자 빌라별 공실 보드

## 배경
공급자가 예약 현황을 공유하지 않으므로, 운영자가 공급자에게 수시로 물어보고 날짜를 직접 잠근다.
기존 `/bookings`(우리 판매예약 리스트)와 별개로, 빌라×날짜 가용성을 한눈에 보고 잠금/해제하는 보드를 신설.
디자인: `design/stitch/b11-availability-board/` (가로 스크롤 타임라인, 3개월, 다크 ko).

## 범위 (이 태스크가 만지는 파일 — 소유 선언)
- `prisma/schema.prisma` — Villa에 `availabilityCheckedAt DateTime?` 필드 추가 (TDA 전담)
- `app/(admin)/availability/page.tsx` (신규) + 하위 클라이언트 컴포넌트 (신규)
- `app/api/availability/board/route.ts` (신규, GET 집계) — 또는 page server component 직접 쿼리
- `app/api/villas/[id]/availability-checked/route.ts` (신규, POST "확인했음" 갱신 + AuditLog)
- `lib/availability.ts` — 보드용 집계 헬퍼 추가만 (기존 함수 시그니처 불변)
- `messages/ko.json` — `availabilityBoard.*` 키 **추가만**
- 잠금/해제는 **기존** `/api/calendar-blocks` 재사용 (수정 없음)

## 수정 금지 구역 (다른 세션 작업 중 — 절대 미수정)
- `app/(admin)/activity/page.tsx`, `app/(admin)/layout.tsx`, `components/admin/sidebar.tsx`
- `messages/vi.json`, `middleware.ts`, `docs/DESIGN.md`
- `lib/cleaning.ts`, `lib/hold.ts`, `lib/proposal.ts`
- 사이드바 메뉴 추가는 위 sidebar.tsx가 풀리면 별도 처리(이 태스크에서 미수정)

## 완료 기준 (테스트 가능)
1. ADMIN 로그인 시 빌라×날짜(3개월) 격자 렌더, 빌라명 열 sticky, 날짜 가로 스크롤
2. 셀 상태 3종 구분: 공실 / MANUAL 잠금 / ICAL 잠금(읽기전용)
3. 공실/MANUAL 셀 탭 → 잠금/해제 동작 (기존 calendar-blocks API), 낙관적 업데이트
4. 빌라별 "마지막 확인일" 뱃지(✓/⚠), "확인했음" 버튼 → availabilityCheckedAt 갱신 + AuditLog 기록
5. 빌라명 검색 + 지역 필터 + "확인 필요만" 토글 동작
6. 월 ◀▶ 이동 + [오늘] 버튼
7. 판매예약(HOLD/CONFIRMED)은 이 보드에 표시되지 않음 (마진·재고 누수 없음)
8. SUPPLIER/비로그인 접근 차단 (403/리다이렉트)

## 검증 방법
- `npm run lint && npm run typecheck` 통과
- `npx next build` 통과 (배포 게이트)
- QA: Playwright로 ADMIN 격자 렌더·잠금 토글·권한 누수 검사

## 파이프라인
TDA(스키마) → BE(집계·확인갱신 API) → FE(b11 변환) → QA
