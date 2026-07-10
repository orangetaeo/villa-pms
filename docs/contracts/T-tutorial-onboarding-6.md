# T-tutorial-onboarding-6 — 투어 전수 확장 (가능한 화면 전부)

- 상태: 착수 (2026-07-10, worktree `worktree-tutorial-onboarding` 계속)
- 배경: 테오 지시 "튜토리얼 보강 가능한 곳들은 찾아서 많이 해줘". T-5(관리자 4화면)까지 투어 13종 — 남은 전 화면을 전수 판정해 적격 화면 전부에 투어 추가.
- 승계: 화면당 ≤3스텝·자동 1회·"?" 재생·RSC 번역→props·앵커 부재/비가시 자동 스킵·replayHint·이중앵커. **인프라 무변경.**

## 후보 전수 목록 (회의에서 채택/제외 판정 — 제외 시 근거 명시)

### 관리자 (FE 회의)
| 화면 | 비고 |
|---|---|
| /availability (공실보드) | 재고 핵심 — 최우선 후보 |
| /settlements (빌라 정산) | 재무(canViewFinance 페이지 게이트) |
| /receivables (미수/여신) | 재무 |
| /service-orders (부가서비스 정산·중계) | +requests 큐 |
| /revenue (매출관리) | 재무 |
| /statistics (통계) | 탭 5종 |
| /inventory (미니바 재고) | |
| /users (사용자 관리) | |
| /partners (파트너 관리) | |
| /settings (설정 허브) | 하위 다수 — 허브만 |
| /cost-alerts (원가 경보) | 가치 낮으면 제외 |
| /activity (활동 로그) | 가치 낮으면 제외 |
| 상세 화면들(/bookings/[id] 등) | 원칙 제외(인터랙션 중심·앵커 불안정) — 회의가 뒤집을 수 있음 |

### 라이트 포털 (UX-VN 회의)
| 화면 | 비고 |
|---|---|
| /earnings (공급자 수익·정산) | 통계|정산내역 탭 |
| /my-bookings (공급자 직접예약 검수) | |
| /vendor/stats (벤더 통계) | |
| /zalo-connect | 화면 자체가 온보딩 안내 — 제외 유력 |
| 프로필/계정 화면들 | 원칙 제외(단일 폼) |

## 판정 기준 (기존 확립)
- 온보딩 가치(신규 사용자가 처음 봤을 때 헤맬 화면인가) + 앵커 안정성(서버 렌더/즉시 렌더·무조건부, 클라 fetch 비동기 요소 금지, canViewFinance 요소 단위 조건부 금지 — 페이지 단위 게이트는 허용).
- 이미 화면 자체가 안내인 곳(guide·zalo-connect)·단일 폼(profile)·상세 화면은 원칙 제외.

## 완료 기준
1. 채택된 각 화면: 첫 진입 자동 투어·완주 영속·"?" 재생 (QA 실측은 대표 표본 — 관리자 3+포털 2 이상, 나머지는 앵커 실존 테스트+정적 검토로 갈음 가능).
2. 빈 데이터 화면 자동 스킵·빈 오버레이 없음(표본 1).
3. 기존 투어 13종 회귀 없음(전체 vitest). 타 라우트 "?" 미노출 유지.
4. tour NS ko/vi 패리티·ANCHOR_SOURCES 전 등록. tsc·build·전체 vitest 통과.
5. 마진·금액 데이터 무참조.

## 수정 금지 구역
- prisma/schema.prisma, worker/, lib/zalo-*, package.json, components/tour/coach-mark.tsx, components/admin/responsive-table.tsx.

## 검증
- QA 독립 평가 (표본 실측 + 전수 정적/테스트).
