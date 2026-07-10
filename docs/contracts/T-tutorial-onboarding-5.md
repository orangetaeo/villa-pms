# T-tutorial-onboarding-5 — 관리자 투어 확장 (핵심 운영 화면 4~5종)

- 상태: 착수 (2026-07-10, worktree `worktree-tutorial-onboarding` 계속)
- 배경: 3단계(PR #210)는 대시보드 1종만(테오 본인 후순위 합의). 테오 지시 "admin 페이지를 더 보강" → 미래 직원(STAFF·MANAGER) 온보딩 기준으로 운영 핵심 사이클 화면에 투어 확장.
- 승계 규칙: 화면당 ≤3스텝·자동 1회·"?" 재생(라우트 매핑 자동)·RSC 번역→props·앵커 부재/비가시 자동 스킵·replayHint 자동·반응형 이중앵커 지원(3단계 인프라). **인프라(coach-mark.tsx) 무변경 — 스텝·앵커·문구만.**

## 범위

### 후보 화면 (운영 핵심 사이클: 제안→예약→검수→소통) — FE 회의로 스텝·앵커 확정
1. `adminBookings` (/bookings): 필터/검색 → 예약 행(상태 배지) → HOLD·요청 배지 등
2. `adminVillas` (/villas): 상태 탭(승인 대기) → 빌라 행 → 등록/검수 진입
3. `adminProposals` (/proposals): 새 제안 만들기 → 제안 카드(상태·링크)
4. `adminInspections` (/inspections): 검수 대기 목록 → 사진 비교 → 승인/반려
5. `adminMessages` (/messages): 대화 목록 → 번역/전송 (구조상 앵커가 불안정하면 회의에서 제외 가능)
- 회의 판단으로 4종까지 축소 가능(가치 낮거나 앵커 불안정 화면 제외). 데스크톱·모바일 이중 렌더 화면은 3단계 이중앵커 패턴 사용.

### 공통
- TOURS·route 매핑 추가(정확일치) → 레이아웃 "?" 버튼은 자동 노출(3단계 배선 재사용).
- 각 page.tsx에 CoachMark 마운트(RSC 번역→props, ADMIN_CLIENT_NAMESPACES 무변경).
- tour NS ko/vi 동시(운영자 화면 vi 필수 규칙). ANCHOR_SOURCES 등록.
- 앵커 원칙: 서버 렌더·항상 존재하는 요소 우선. 목록 첫 행은 index 0 조건부(빈 목록=자동 스킵). 비동기 클라 fetch 요소 앵커 금지(벤더 교훈).

## 완료 기준
1. 확정된 각 화면에서 OWNER 데모 첫 진입 시 자동 투어·완주 영속·"?" 재생 (데스크톱 1440px 기준, 모바일 390px 스팟 체크).
2. 빈 목록 화면에서 해당 스텝 자동 스킵·빈 오버레이 없음.
3. 타 admin 라우트(투어 미정의) "?" 미노출 유지. 기존 투어 10종(9+adminDashboard) 회귀 없음.
4. tour NS ko/vi 패리티·ANCHOR_SOURCES 앵커 실존(기존 테스트 자동 커버). tsc·build·전체 vitest 통과.
5. 마진·금액 데이터 무참조(문구는 정적 — 재무 수치는 화면 자체 표시를 가리킬 뿐). STAFF 재무 마스킹과 충돌 금지(재무 전용 요소를 앵커로 쓰지 않기 — canViewFinance 조건부 요소 앵커 금지).

## 수정 금지 구역
- prisma/schema.prisma, worker/, lib/zalo-*, package.json, components/tour/coach-mark.tsx.

## 검증
- QA 독립 평가: 로컬 prod(3000 점유 시 NEXTAUTH_URL 3001 오버라이드 레시피) + Playwright, OWNER 0799493138/Happy01!vi.
