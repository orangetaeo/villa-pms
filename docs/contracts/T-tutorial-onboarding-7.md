# T-tutorial-onboarding-7 — 투어 내용 개편: 검색 안내 제거 + 빌라 상세 기능 투어 (테오 피드백)

- 상태: 착수 (2026-07-10, worktree `worktree-tutorial-onboarding` 계속)
- 배경(테오 피드백 원문 요지): "누가 검색을 몰라! 검색 말고 **상세 페이지 기능 사용법**을 알려줘야지 — 빌라 상세에서 기간별 요금제 등록(성수기 날짜 지정), 비품 수정, 회사 표준 미니바 수정, 청소담당자 선택, 청소 운영정보, wifi 아이디/비번, 잠자리 구성. 간단한 검색 같은 건 튜토리얼 없어도 돼."

## 새 문구 원칙 (전 투어 적용, 이후 신규 투어에도 승계)
- **범용 텍스트 검색 안내 금지** — "이름으로 검색할 수 있습니다" 류 스텝·문구 제거.
- 안내 대상 = **화면 고유 기능·업무 규칙·숨은 기능**(어디서 뭘 바꾸는지, 어떤 순서로 처리하는지, 놓치기 쉬운 편집 진입점).
- 상태·역할·기간 같은 도메인 개념 탭/사이클 안내는 유지 가능(검색이 아님).

## 범위

### 1. 빌라 상세(/villas/[id]) 투어 신설 — 핵심
테오 열거 기능을 실제 상세 화면(detail-tabs·rate-editor·sales-editor·villa-actions 등)에 매핑해 안내:
기간별 요금제(성수기 등 날짜 지정) · 비품 수정 · 미니바 비치 · 청소 담당자 지정 · 청소 운영정보(메모·출입) · wifi 아이디/비번 · 잠자리 구성.
- 탭 콘텐츠는 클릭 후 렌더 → **앵커는 항상 보이는 탭 버튼·헤더 요소 중심**, desc가 "그 탭 안에서 무엇을 하는지"를 설명(vendorBoard 선례).
- 관리자 **상세 화면에 한해 스텝 상한 ≤6 완화**(vi 포털 3스텝 상한은 유지) — FE 회의에서 실제 탭 구조 보고 스텝 수 확정.
- route가 동적(/villas/[id])이므로 TOURS.route=null + 페이지에서 명시 tourId(cleaningDetail 선례). "?"는 상세 페이지 자체 헤더/액션 영역에 TourHelpButton 명시 배치(필요 시).

### 2. 기존 투어 검색·필터 스텝 정리 (회의에서 화면별 확정)
- 제거/교체 후보: adminBookings.filters·adminProposals.filters·adminServiceOrders.filters·adminUsers.filters(역할 탭 중심으로 문구 수정 가능)·adminRevenue.filters(기간·유형 개념은 유지 가능, 검색 언급 삭제)·adminAvailability.filters(기간 넘기기 조작만 남기고 검색 언급 삭제).
- 교체 시 대체 스텝은 화면 고유 기능(예: bookings=체크인 시트 출력).
- 스텝 제거로 2스텝이 되는 투어는 그대로 허용.

### 3. 회사 표준 미니바 수정 안내
- 표준 카탈로그 관리 진입점(인벤토리 카탈로그 탭 — canSetPrice 조건부라 요소 앵커 금지)은 **inv-stock/inv-inbound desc 문구로 안내**하거나 회의 대안 채택.

## 완료 기준
1. 빌라 상세 투어: 테오 열거 7기능이 스텝 desc에 전부 커버(스텝 수 ≤6). OWNER 실측 — 자동 발화·완주 영속·"?" 재생.
2. 전 투어 문구에서 범용 검색 안내 0건(grep "검색" — 남는 것은 도메인 개념뿐임을 QA가 판정).
3. 제거/교체된 스텝의 앵커 잔존물 없음(사용 안 하는 data-tour 제거), ANCHOR_SOURCES 정합.
4. tsc·build·전체 vitest·ko/vi 패리티. 마진·금액 무참조(빌라 상세는 요금 "화면"을 가리키되 수치 무언급).
5. 기존 투어 회귀 없음.

## 수정 금지 구역
- prisma/schema.prisma, worker/, lib/zalo-*, package.json, components/admin/responsive-table.tsx. coach-mark.tsx는 원칙 무변경(상세 "?" 배치에 필요한 최소 허용 — 사유 명시 시).

## 검증
- QA 독립 평가: 빌라 상세 실측(1440px) + 문구 전수 grep + 변경 투어 표본.
