# 계약서 — ADMIN 날짜 빠른 필터 버튼 (QuickDateFilter)

## 태스크 ID
T-admin-quick-date-filter

## 배경 / 요청
ADMIN 관리자 목록 화면에서 날짜로 필터링하는 곳에 첨부 이미지 형태의 **빠른 날짜 필터 버튼 바**를 추가한다.
버튼: `[✓ 전체] [오늘] [어제] [이번주] [지난주] [이번달] [지난달] [다음달]`
- 활성 버튼은 강조(다크 대시보드 톤, admin-primary/검정 배경)
- '전체(All)'는 체크 아이콘 + 날짜 제한 없음 토글

## 사용자 확정 사항 (회의)
1. **적용 범위**: 날짜 목록 8곳 전부 — 예약, 제안, 정산, 청소검수, 활동내역, 비용경보, 메시지, 사용자
2. **'전체 선택' 체크박스 = 기간 필터의 '전체(All)' 토글** (별도 bulk-select 아님)

## 범위 (이 태스크가 건드리는 파일 — 다른 세션 회피 요청)
- 신규: `lib/date-vn.ts` (함수 **추가만**: resolveQuickRange, vnDayStartUtc, QUICK_RANGE_KEYS)
- 신규: `components/admin/quick-date-filter.tsx`
- 신규: `design/stitch/quick-date-filter/` (디자인 export)
- 수정: 8개 목록 페이지 — 각 페이지 파일만 (아래)
  - `app/(admin)/bookings/page.tsx` + `filters-bar.tsx`
  - `app/(admin)/proposals/page.tsx` + `proposals-list.tsx`
  - `app/(admin)/settlements/page.tsx` + `settlements-view.tsx`
  - `app/(admin)/inspections/page.tsx` + `inspections-view.tsx`
  - `app/(admin)/activity/page.tsx`
  - `app/(admin)/cost-alerts/page.tsx` + `cost-alerts-view.tsx`
  - `app/(admin)/messages/page.tsx` + `inbox.tsx`
  - `app/(admin)/users/page.tsx` + `users-manager.tsx`
- 공유 i18n: `messages/ko.json`·`vi.json` — `quickDateFilter` 네임스페이스 **키 추가만**

## 수정 금지 구역
- git status 상의 미지의 변경 파일(다른 세션 작업) — 특히 messages/* 의 기존 변경분은 건드리지 않고 키 추가만
- prisma/schema.prisma 변경 없음 (DB 변경 0)

## 설계 핵심
- **단일 재사용 컴포넌트** `QuickDateFilter` (client, searchParams `?range=` 동기화)
- 페이지별 `presets` prop로 노출 버튼 선택 (과거형 목록은 '다음달' 제외, 정산은 월 단위만)
- 날짜 경계는 **Asia/Ho_Chi_Minh(UTC+7 고정)** 기준, 기존 `lib/date-vn.ts` 재사용
- 주(week)는 **월요일 시작**
- 반개구간 [from, to) — date-only(@db.Date) 필드는 parseUtcDateOnly, timestamp 필드는 vnDayStartUtc 변환
- DB 스키마/마이그레이션 변경 없음 (조회 where 절만 추가)

## 테스트 가능한 완료 기준
1. 각 8개 페이지에서 빠른 필터 버튼 바가 보이고, 클릭 시 목록이 해당 기간으로 필터된다 (URL `?range=` 반영)
2. '전체' 클릭 시 날짜 제한 해제, 활성 버튼 강조 정확
3. VN 기준 경계 정확 (오늘/이번주(월~일)/이번달 등) — `lib/date-vn.test.ts` 단위 테스트 통과
4. 마진·재고 누수 없음 (QA leak-checklist) — 신규 노출 데이터 없음 확인
5. `npm run typecheck` + `next build` 통과 (배포 빌드 게이트)
6. 모바일(360px)에서 버튼 바 가로 스크롤로 동작

## 검증 방법
- 단위 테스트: resolveQuickRange 경계값
- Playwright: 각 페이지 필터 클릭 → 행 수/URL 확인 (QA 독립 평가)
- 빌드 게이트

## 담당
PM(조율) · TDA(util/컴포넌트 API) · FE(컴포넌트+페이지) · LOC(i18n) · QA(검증)
