# 계약서: 벤더 보드 날짜 검색 + 제안 수락→완료보고 동선 연결

- 담당: BE (구현) / QA (독립 검증) / 메인 세션(Fable) = TDA 설계
- 브랜치: worktree-vendor-board-date-search
- 배경(테오 실측 2026-07-11): 시간제안을 소비자가 승인한 마사지 건이 "예약현황에 안 온다,
  완료보고를 할 수 없다"고 보고. **실측 원인**: 승인 건은 예약현황 API 조건에 포함되나
  (CONFIRMED·VENDOR_ACCEPTED), 예약현황이 serviceDate 오름차순 정렬이라 시드 과거 날짜
  465건 뒤 **47페이지(총 886건/89페이지)에 묻힘** — 기능 누락이 아니라 발견 불가 구조.
  테오 지시: 4탭 하단에 날짜 검색 추가.

## 범위 (Scope)

### 1. 날짜 검색 API — `app/api/vendor/orders/route.ts`
- 쿼리 파라미터 `from`/`to`(YYYY-MM-DD, 각각 선택) 추가 — `serviceDate` 기준
  (@db.Date, parseUtcDateOnly로 검증·불량값 무시 or 400). half-open 아님: from ≤ serviceDate ≤ to
  (부가서비스 이행일은 단일 날짜라 양끝 포함이 자연스러움).
- 4탭 전부 where에 AND 적용(inbox·proposal·schedule·settlement). 탭 뱃지 카운트
  (inboxCount·proposalPendingCount)는 날짜 무관 전역 유지(뱃지=할 일 총량).
- settlement 전역 합계(settleTotals)는 기존대로 날짜 무관 유지(전역 정의 — 기존 관례,
  ⚠통계 정산잔액=전역화 메모리 규칙). 목록만 필터.
- serviceDate null인 주문은 날짜 필터 시 제외(자연 동작).

### 2. 날짜 검색 UI — `components/vendor/vendor-board.tsx` (vi 모바일 우선)
- 탭 바 **하단**에 날짜 필터 행: 시작일·종료일 입력(⚠raw input type=date 금지 —
  `components/date-field.tsx` DateField 사용, iOS 빈값 공백박스 함정) + 원탭 칩
  **오늘 / 이번 주 / 전체**(터치 우선 — 베트남 벤더 텍스트 입력 최소화 원칙).
- 필터 변경 시 page=1 리셋. 탭 전환해도 필터 유지(4탭 공통 상태). fetch qs에 from/to.
- 활성 필터 표시(칩 활성색 or 날짜값). i18n vendor NS ko/vi.

### 3. 제안 수락 → 완료보고 동선 — 같은 파일
- 시간제안 탭의 **APPLIED(수락됨) 카드에 "완료보고 하러 가기" 버튼**: 예약현황 탭으로
  전환 + 날짜 필터를 해당 주문 serviceDate로 자동 세팅(from=to=serviceDate) →
  묻힘 없이 해당 건이 바로 보여 완료보고 가능. vendorCompletedAt 있으면 버튼 대신
  "완료보고됨" 표시.
- (선택 아님·필수) 이 버튼으로 사용자 보고 "승인 건이 예약현황으로 안 간다" 동선 해소.

### 4. 문서·테스트
- 신규/기존 테스트: from/to 파싱·where 반영(4탭)·불량 날짜 무시, 뱃지 카운트 날짜 무관 단언.
- PROGRESS.md는 메인 세션이 커밋 직전. ADR 불필요(UI/조회 확장 — 상태기계 무변경).

## 수정 금지 구역
- 상태기계(respond/proposal/tickets/complete API) 무변경. prisma 스키마 무변경.
- 탭 data-tour 앵커(vendor-tab-*) 유지 — 투어 회귀 금지.

## 완료 기준
1. 4탭 각각 from/to 필터 동작(API 단위테스트 + where 단언). 뱃지 카운트는 필터 무관.
2. 벤더 보드에 날짜 행 노출·칩 동작·탭 전환 시 유지·page 리셋.
3. 시간제안 APPLIED 카드 → 버튼 → 예약현황 탭 + 해당 날짜 필터로 해당 건 1페이지 노출.
4. 투어 앵커·기존 3탭 기능 회귀 0. i18n ko/vi 파리티. 누수 0(신규 필드 없음).
5. lint·typecheck·vitest 회귀 0·next build 통과.
