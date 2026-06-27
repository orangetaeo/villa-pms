# 모바일 반응형 전수 점검 (2026-06-27)

> **목적**: 7개 역할의 모든 화면을 모바일(390×844)에서 점검하여 반응형 미최적화 화면을 식별. **전체 수정 착수 시 [ROLE-AUDIT-2026-06-27.md](ROLE-AUDIT-2026-06-27.md)와 함께 일괄 수정.**
>
> 방법: Playwright 모바일 뷰포트(390px)에서 각 화면 로드 후 **페이지 레벨 가로 오버플로**(`document.documentElement.scrollWidth > innerWidth`)를 측정 + 오버플로 유발 요소 식별 + 스크린샷. iPhone 12/13(390px) 기준.

---

## 핵심 결론

**반응형 문제는 운영자(ADMIN) 다크 대시보드에 집중된다.** 원인은 단일 패턴: **넓은 데이터 표가 가로 스크롤 컨테이너(overflow-x-auto)나 모바일 카드 전환 없이 그대로 렌더되어 페이지를 밀어냄**. 라이트 포털 5종(공급자·벤더·파트너·청소·게스트)은 모바일 우선 설계라 **오버플로 0건**.

> 참고: 운영자 일부 화면은 이미 올바르게 처리됨 — /bookings 목록은 모바일 카드로 전환, /availability 보드는 가로 스크롤 컨테이너로 감쌈. **같은 처리를 못 받은 표들만 문제.**

---

## 🔴 반응형 오버플로 (운영자 화면 — 수정 대상)

운영자 화면은 OWNER·STAFF·또다른오너(김태진)가 **같은 레이아웃**을 공유하므로, 아래 1건 수정이 3역할 모두에 적용됨.

| 화면 | 오버플로 | 원인 요소 | 권장 수정 |
|---|---|---|---|
| **/bookings/[id]** (예약 상세) | +19px | **부가옵션 주문 `<table>` (953px)** — 판매가·원가·원천공급자·상태 컬럼이 잘림 | 표를 `overflow-x-auto` 컨테이너로 감싸거나 모바일 카드 전환 |
| **/revenue** (매출관리) | +68px | **거래 목록 `<table>` (1129px)** — 귀속일·유형·빌라·채널·내역·판매가KRW·판매가VND·원가… | 동일 (스크롤 컨테이너 or 카드). 가장 큰 오버플로 |
| **/statistics** (통계) | +26px | **기간 필터 칩 줄 (400px)** — 전체·오늘·어제·이번주·지난주·이번달·지난달이 안 줄바꿈 | 칩 줄에 `flex-wrap` 또는 `overflow-x-auto`. (※ /revenue·/bookings 등 동일 필터 칩 줄도 점검) |
| **/users** (사용자 관리) | +12px (경미) | 역할 필터 칩 줄 또는 사용자 표 추정 | 동일 패턴 점검 |

### 운영자 화면 — 정상(오버플로 없음)
/dashboard(전용 모바일 레이아웃 ✓), /bookings(카드 전환 ✓), /availability(가로 스크롤 컨테이너 ✓), /settlements, /receivables, /partners, /partners/[id], /villas/[id], /inventory, /inspections, /messages(단일 페인 전환 ✓), /proposals/new, /activity, /settings/services

---

## 🟡 반응형 레이아웃 (오버플로 아님, 모바일 폴리시)

| 화면 | 문제 | 비고 |
|---|---|---|
| 공급자 다화면 (/my-villas, /calendar) | **좌상단 계정 아이콘이 페이지 최상단 콘텐츠를 가림** — "Xin chào" 인사말·빌라 선택 칩이 아이콘 뒤로 잘림 | [ROLE-AUDIT M4]와 동일. 상단 헤더 패딩/레이아웃 조정 |

---

## ✅ 라이트 포털 5종 — 모바일 반응형 양호 (수정 불필요)

모바일 우선 설계로 전 화면 **페이지 오버플로 0건**:

| 역할 | 점검 화면 | 결과 |
|---|---|---|
| ① 공급자 | /my-villas·/my-villas/[id]·/calendar·/my-bookings·/earnings | OK |
| ② 벤더 | /vendor·/vendor/stats | OK |
| ③ 파트너 | /partner·/partner/receivables | OK |
| ⑥ 청소 | /cleaning | OK (단, 네비 버그는 ROLE-AUDIT H3 별건) |
| ⑦ 게스트 | /g/[token]·/g/[token]/options | OK (5개 언어 칩도 줄바꿈 정상) |

---

## 수정 가이드 (전체 수정 시)

**근본 원인 = 운영자 넓은 표의 반응형 미처리.** 두 가지 표준 처리 중 택1로 일괄 적용 권장:

1. **가로 스크롤 컨테이너** (간단·표 구조 유지): `<div className="overflow-x-auto">` 로 `<table>` 감쌈. /availability 보드가 이미 쓰는 패턴. → /bookings/[id] 부가옵션표, /revenue 거래표에 즉시 적용 가능.
2. **모바일 카드 전환** (UX 우수·작업량↑): /bookings 목록이 쓰는 패턴. 정보 우선순위 높은 표에 권장.
3. **필터 칩 줄**: `flex-wrap` 또는 `overflow-x-auto whitespace-nowrap`. /statistics·/users 및 동일 칩을 쓰는 전 화면 공통 점검.

> 회귀 방지: 수정 후 동일 측정 스크립트(`scrollWidth > innerWidth`)로 390px 오버플로 0 확인. 공용 표 래퍼 컴포넌트(예: `<ScrollableTable>`)를 만들어 신규 표에 강제하면 버그 클래스 영구 차단.

### 점검 산출물
스크린샷: m-admin-dashboard.png, m-admin-availability.png, m-admin-booking-detail.png (프로젝트 루트, 점검용 — 정리 가능).
