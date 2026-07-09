# T-tutorial-onboarding-3 — 역할별 튜토리얼 3단계: ADMIN (마지막)

- 상태: 착수 (2026-07-09, worktree `worktree-tutorial-onboarding` 계속)
- 선행: 1단계 PR #207(인프라+SUPPLIER/CLEANER)·2단계 PR #208(PARTNER/VENDOR). 이 계약으로 역할별 튜토리얼 에픽 완료.
- 승계 규칙: 화면당 ≤3스텝·자동 1회·"?" 재생·RSC 번역→props·localStorage·앵커 부재 자동 스킵.

## 범위

### 1. 인프라 소폭 보강 (coach-mark.tsx — 2단계 동결 해제, 이 항목만)
관리자 화면은 같은 의미의 UI가 뷰포트별 이중 렌더(데스크톱 사이드바 vs 모바일 하단네비, 데스크톱 KPI 그리드 vs 모바일 현황 박스)라 기존 `querySelector` 첫 매치로는 숨은 쪽을 잡을 수 있음.
- `anchorEl`: `querySelectorAll` 순회 → **첫 "가시" 매치** 반환. 가시 판정 = rect.width/height > 0(display:none 제외) AND 수평으로 뷰포트 안(rect.right>0 && rect.left<innerWidth — 모바일 드로어 `-translate-x-full` 제외). 수직은 스크롤 가능하므로 판정 제외.
- 효과: 같은 `data-tour` 값을 두 반응형 변형에 부여하면 현재 뷰포트에서 보이는 쪽이 자동 선택됨. 기존 1·2단계 투어에는 무해(앵커가 전부 단일·가시).

### 2. ADMIN 투어 1종 — `adminDashboard` (/dashboard, ko 기본·vi 지원)
테오 본인은 숙련자라 최소 구성(합의: ADMIN 후순위) — 미래 직원 온보딩용 핵심 3스텝:
1. `admin-stats` — 오늘 현황(체크인·체크아웃·홀드·청소): 데스크톱 KPI 그리드 + 모바일 현황 박스 section 이중 앵커
2. `admin-nav` — 관리 메뉴: 데스크톱 사이드바 nav + 모바일 하단네비 이중 앵커
3. `admin-bell` — 운영 알림 벨(사이드바 푸터): 모바일에선 드로어 안(비가시) → 자동 스킵
- "?" 버튼: 레이아웃 RSC가 `<TourHelpButton>`(다크 스타일 className)을 AdminSidebar에 slot prop으로 전달 — 데스크톱=사이드바 푸터 액션 줄, 모바일=헤더 우측 자리(현 w-10 placeholder). 투어 미정의 라우트에선 컴포넌트가 스스로 null.

### 3. i18n·정의·테스트
- tour NS에 adminDashboard 3키 ko/vi 동시 추가 (운영자 화면 vi 필수 규칙).
- TOURS·route("/dashboard") 매핑, ANCHOR_SOURCES에 dashboard/page.tsx·sidebar.tsx 등록.
- 가시 앵커 선택은 순수 판정 함수로 분리해 단위 테스트(display:none·수평 오프스크린·정상 3케이스).

## 완료 기준
1. 관리자(데모 OWNER)로 /dashboard 첫 진입 시 자동 표시·건너뛰기 영속·"?" 재생 — 데스크톱(1440px)과 모바일(390px) 모두, 각 뷰포트에서 **보이는 쪽 요소**가 하이라이트됨.
2. 모바일에서 bell 스텝 자동 스킵(2스텝), 데스크톱에서 3스텝.
3. 다른 admin 라우트(/bookings 등)에서 "?" 미노출·투어 미발동.
4. 기존 1·2단계 투어 회귀 없음(전체 vitest + 가시성 판정 단위 테스트).
5. tsc·build·전체 테스트 통과. 마진·금액 데이터 무참조(정적 문구만 — KPI 숫자는 화면 자체 표시, 투어는 가리킬 뿐).
6. ADMIN_CLIENT_NAMESPACES 무변경(문구는 RSC props — admin-i18n-whitelist 테스트 그린 유지).

## 수정 금지 구역
- prisma/schema.prisma, worker/, lib/zalo-*, package.json. coach-mark.tsx는 §1 가시성 로직만.

## 검증
- QA 독립 평가: 로컬 prod + Playwright, OWNER 데모(0799493138/Happy01!vi) — 1440px·390px 이중 실측.
