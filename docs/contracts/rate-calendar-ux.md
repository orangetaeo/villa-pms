# 계약: 기간별 요금 캘린더 UX 개편 (rate-calendar-ux)

- 착수: 2026-07-14 (테오 기획 승인 완료 — 인터랙티브 목업 4차 반복으로 확정)
- 브랜치: worktree-rate-calendar-ux
- 인터랙션 스펙 정본: `design/stitch/rate-calendar/interaction-spec.html` (승인된 목업 사본)
- 메모리: rate-calendar-ux-redesign-plan.md

## 범위

### 1. 서버 — 겹침 허용 + 승자 규칙 (스키마 변경 없음)
- `app/api/villas/[id]/rate-periods` PATCH의 겹침 409 검증 제거 (base 1개 필수·half-open 검증은 유지)
- `lib/pricing.ts` `resolveRatePeriod` 승자 규칙 교체:
  **① 짧은 기간(박 수) → ② 시즌 등급(PEAK>HIGH>SHOULDER>LOW) → ③ 늦은 시작일 → ④ 큰 id(최신)**
- API를 레이어 단위 증분 CRUD로 확장 (전체 교체 PATCH는 유지하되, 레이어 추가/수정/삭제/일괄생성 지원 — 동시 편집 덮어쓰기 제거)
- 일괄 작업(batch) 지원: 일괄 조정·연도 복사·선택 적용은 서버에서 구간화(밤별 승자 기준) 후 생성, `batchId`(그룹 취소용) 기록
- 단위 테스트: 겹침 해석(포함·부분 겹침·동일 길이 tie), 프리미엄/ADR-0031 폴백 회귀

### 2. 공용 캘린더 컴포넌트 `components/rate-calendar/`
- 월 그리드 + 시즌색 셀(승자 요금 표시) + 겹침 밴드(주 단위 lane) + 날짜 요금 스택 패널
- 도구 4종: 기간 추가(날짜 직접입력↔캘린더 탭 동기화) / ☑날짜 선택 바구니(비연속, 고정가·%) / ⚡일괄 조정(연속+%) / 📋연도 복사(레이어 선택+인상률, 음력 경고)
- **레이어 편집 시트**(날짜 이동·가격 수정 — 목업에 없던 v1 필수)
- **batchId 단위 되돌리기**("이 작업 전체 취소")
- 지난 연도 레이어 자동 접기 + 연도 필터
- 날짜 입력은 `components/date-field.tsx` DateField 필수 (iOS 함정)
- 프리미엄일 표시: ●(요일)·★(공휴일), premium 가격은 `premiumX ?? X` 폴백 그대로

### 3. 운영자 요금 탭 (`app/(admin)/villas/[id]` 요금 섹션 교체)
- 다크·ko. 가격축 토글: 판매가(Net)/소비자가/원가
- 폼은 기존 원가+마진→판매가 자동 제안 흐름 유지 (rate-period-editor 폼 로직 재사용)
- Stitch: `design/stitch/b21-rate-calendar/`

### 4. 공급자 원가 캘린더 (`app/(supplier)/my-villas/[id]` 요금)
- 라이트·vi·모바일(390px). 원가·자기판매가 축만. 도구는 단순화(기간 추가 + 날짜 선택 정도, DESIGN 판단)
- Stitch: `design/stitch/a10-rate-calendar/`

## 완료 기준 (테스트 가능)
1. 겹치는 기간 저장 시 200 (409 아님), 견적(quoteStayForVilla)이 승자 규칙대로 밤별 요금 산출 — 단위 테스트 통과
2. 동일 날짜에 3중 겹침(base+HIGH+PEAK) 시 스택 패널이 승자→가려짐 순으로 표시
3. 일괄 조정·연도 복사 결과가 batchId로 묶여 한 번에 취소 가능
4. 공급자 화면에서 마진·Net·소비자가·premium Net 계열 필드가 응답·DOM 어디에도 없음 (QA 누수 감사)
5. 기존 무겹침 데이터의 견적 결과 불변 (회귀 테스트)
6. `next build` 통과

## 수정 금지 구역
- prisma/schema.prisma (스키마 변경 없음 — batchId는 기존 컬럼 없이 label 규약 또는 additive 컬럼 필요 시 TDA 별도 검토)
- messages/ko.json·vi.json 은 키 추가만
- 다른 세션 진행 파일 (main 폴더 untracked: design-audit/, kakao-icon-*, villa-go-*)

## 검증
- QA 에이전트가 마진 누수 grep + 해석 단위 테스트 + build 게이트 실행. 작성자 자기평가 무효.
