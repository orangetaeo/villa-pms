# T-tutorial-onboarding-8 — 상세 화면 투어 확장 (villaDetail 패턴 적용)

- 상태: 착수 (2026-07-10, worktree `worktree-tutorial-onboarding` 계속)
- 배경: 테오 지시 "다른 상세 화면 해줘" — T-7 villaDetail 패턴(항상 보이는 앵커 + desc가 기능·업무 규칙 설명, 상세 화면 ≤6스텝, route=null 명시 tourId, "?"는 화면 내 명시 배치)을 나머지 상세 화면에 적용.
- 승계: T-7 문구 원칙(검색 안내 금지·화면 고유 기능·업무 규칙만)·금액 수치 무참조·조건부 요소 앵커 금지·인프라 무변경.

## 후보 (회의에서 채택/제외·스텝 확정)

### 관리자 (FE 회의)
| 화면 | 예상 기능 밀도 |
|---|---|
| /bookings/[id] (예약 상세) | 최고 — 수납(payment-panel)·취소·체크인/아웃 진입·게스트 셀프체크인 토큰·투숙객 명단(roster)·부가서비스 발주 패널·메모·파트너 배정·변경요청 처리 |
| /partners/[id] (파트너 상세) | 여신 한도·미수·연락처·승인 등 |
| 체크인/체크아웃 폼(/bookings/[id]/checkin·checkout) | 인터랙티브 폼 — 원칙 제외(회의가 뒤집을 수 있음) |

### 포털 (UX-VN 회의)
| 화면 | 예상 기능 밀도 |
|---|---|
| /my-villas/[id] (공급자 빌라 상세) | 높음 — 사진 관리·원가 기간(rate-periods)·판매 링크(sell-link)·정보 편집(info)·비품(amenities) 하위 진입 |
| /partner/bookings/[id] (파트너 예약 상세) | 체크인 정보·부가서비스 요청·변경/취소 요청 버튼 |

## 공통 기술 규칙 (T-7 확립)
- route=null + 페이지 명시 tourId, "?"=화면 헤더/액션 영역 TourHelpButton 명시 배치.
- 앵커는 항상 렌더 요소만(탭 버튼·헤더·섹션 컨테이너). 상태 조건부 요소(예: 특정 status에만 뜨는 버튼)는 앵커 금지 — 자동 스킵 규약에 맡기려면 "그 상태에서만 의미 있는 스텝"으로 설계.
- 상세 화면 스텝 상한 ≤6(테스트 예외 맵 등록). 의도적 중복 앵커 허용(예외 맵).
- 공급자 화면은 자기 원가·정산액만 언급(판매가·마진 금지), 파트너는 자기 채권만.

## 완료 기준
1. 채택된 각 상세 화면: 첫 진입 자동 투어·완주 영속·"?" 재생(OWNER/공급자/파트너 데모 실측 — 표본).
2. 화면 핵심 기능이 스텝 desc에 커버(회의 매핑 표 기준). 범용 검색 안내 0건 유지.
3. tsc·build·전체 vitest·ko/vi 패리티·ANCHOR_SOURCES. 기존 투어 27종 회귀 없음.
4. 마진·금액 수치 무참조. 역할별 금액 노출 원칙 위반 0.

## 수정 금지 구역
- prisma/schema.prisma, worker/, lib/zalo-*, package.json, components/tour/coach-mark.tsx, components/admin/responsive-table.tsx.

## 검증
- QA 독립 평가 (표본 실측 + 정적 전수).
