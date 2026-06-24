# T-admin-checkin-sheet — 오늘의 체크인 시트 일괄 프린트

담당: FE · 작성일 2026-06-24 · 상태: 착수

## 배경
체크인 담당자가 매일 아침 출근 시, 금일 체크인할 빌라들의 예약·보증금·동의서·WiFi 정보를
한꺼번에 프린트해서 현장 서명 받을 준비를 한다. 현재 프로젝트에 프린트 기능은 0건.

## ① 구현 범위
- **신규 라우트** `app/(admin)/bookings/checkin-sheet/page.tsx` (RSC, prisma 직접 조회)
  - `?date=YYYY-MM-DD` (기본 = 오늘, Asia/Ho_Chi_Minh 기준)
  - 조회: `checkIn = 지정일 AND status = CONFIRMED` (기존 "오늘 체크인" 프리셋·통계와 동일 의미)
  - 정렬: villa.complex asc → checkIn — 단지별로 묶여 출력
  - 예약 1건 = A4 1페이지 (`.print-page` / break-after: page)
  - 섹션: ① 예약정보(게스트명·인원·연락처·숙박기간·박수·체크인/아웃 시각·채널·조식)
    ② 보증금(금액·통화·상태: 현장 수취 필요/수취 완료/없음) ③ WiFi(SSID·비번 크게)
    ④ 동의서(기존 `adminCheckin.agreement` 키 재사용, hasPool 시 수영장 조항 자동 삽입)
       + 게스트 펜 서명란·날짜·담당자 확인란. 앱에서 이미 터치 서명된 건은 "앱 서명 완료" 표기
- **신규 클라이언트** `print-button.tsx` — `window.print()` 버튼 (no-print 툴바)
- **진입 버튼** `app/(admin)/bookings/page.tsx` 헤더에 "오늘 체크인 출력" 버튼 추가 (목록 → 시트 링크)
- **프린트 CSS** `app/globals.css` 말미에 `@media print` 규칙 추가(크롬 숨김·페이지 분할) — 추가만
- **i18n** `messages/ko.json`·`vi.json`에 `adminCheckinSheet` 네임스페이스 추가 (ko+vi 동시)

## ② 완료 기준 (테스트 가능)
1. `/bookings/checkin-sheet` 진입 시 오늘 CONFIRMED 체크인 예약이 빌라별 A4 카드로 렌더
2. 인쇄(또는 Print to PDF) 시 사이드바·헤더·네비·버튼이 보이지 않고 시트만 출력, 예약당 1페이지
3. 보증금: depositAmount 있고 미수취 → "현장 수취 필요" 강조 / HELD → "수취 완료" / 없음 → "보증금 없음"
4. WiFi SSID·비밀번호가 시트에 표시 (ADMIN 전용 화면이므로 노출 OK)
5. 동의서 본문 + 빈 펜 서명란이 페이지마다 출력
6. **판매가·원가·마진은 시트·쿼리 어디에도 없음** (사업 규칙: 마진 비공개. 보증금만 노출)
7. `?date=` 변경 시 해당일 예약으로 갱신, 어제/내일 이동 링크 동작
8. 빈 날짜 → "오늘 체크인 예정 예약이 없습니다" 안내
9. ko/vi 토글 모두 키 깨짐 없음
10. `npm run typecheck` 통과 / `npm run build` 통과

## ③ 검증 방법
- QA(독립 평가자)가 Playwright로 `/bookings/checkin-sheet` 렌더 + `browser_take_screenshot`로
  인쇄 미디어 에뮬레이션(`emulateMedia` print) 확인, 보증금 3분기·빈 상태·날짜 이동 검증
- 누수 검사: 시트 HTML 페이로드에 `totalSaleKrw/totalSaleVnd/supplierCostVnd` 부재 확인

## 수정 금지 구역 (병렬 세션 — 다른 세션이 미커밋 작업 중)
본 작업은 격리 worktree `wt/checkin-sheet`에서 진행. 공유 폴더의 다른 세션이 수정 중인
`proposals-list.tsx·users-manager.tsx·villas/page.tsx·layout.tsx·lib/{cleaning,hold,proposal}.ts·
availability/*·supplier/*` 및 신규 `pagination-*`은 건드리지 않는다.
공유 파일(`bookings/page.tsx`·`globals.css`·`ko/vi.json`)은 worktree에서 HEAD 기준 추가 편집 후
wt-finish 병합으로 반영(충돌은 격리 폴더 안에서만 해결).
