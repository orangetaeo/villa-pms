# T-partner-polish — 파트너 후속 폴리시 5종

- 담당: BE+FE (worktree `wt/partner-polish`), 독립 QA 별도
- 배경: PR #182·#188 후속 백로그. 베트남(VND) 계좌는 운영자 등록 완료(2026-07-03) — HOLD 계좌 카드 라이브 활성.

## 범위
1. **HOLD 계좌 안내 선금 반영**: 파트너 예약상세 HOLD 시 입금 금액을 전액 대신 "선금 X(강조) + 총 객실료" 2행으로. depositRatePct는 서버 계산만(비율 자체 비노출 — 기존 원칙), computeDepositDue 재사용.
2. **취소 시 대기 요청 자동 종결**: cancelBooking tx에서 해당 예약 PENDING BookingChangeRequest → REJECTED(resolutionNote "예약 취소로 자동 종결 / Tự động đóng do hủy"). ★취소요청 승인 경로 경합 방지: cancelBooking에 excludePendingRequestId 옵션 — 승인 라우트가 자기 요청 id를 넘겨 제외(승인 플로우 resolve가 이어서 처리).
3. **INVOICED_LEFT 경고 배지**: 관리자 파트너 상세 채권 테이블 — 예약 CANCELLED인데 미종결(PAID/WRITTEN_OFF 아님) 채권 행에 경고(청구서 조정 필요).
4. **연체 N일**: 파트너 미수 채권 행에 "연체 {n}일" 표시(서버 계산 — 하이드레이션 안전).
5. **연장 배지 수 파트너 필터**: loadPartnerBookings `_count.extensions`에 where partnerId(타 파트너 소유 자식 수 미포함 — 상세와 일관).

## 완료 기준
- 1: HOLD 상세에 선금·총액 2행(선금율 숫자 비노출), CONFIRMED 미납은 기존 잔액 표시 유지 (단위: 선금 계산 재사용 — computeDepositDue 기존 테스트)
- 2: 취소 시 PENDING 요청 REJECTED 전이 + exclude 시 미접촉 (단위테스트), 승인 경로(CANCEL 승인→resolve) 기존 테스트 그린
- 4: overdueDays 순수함수 테스트
- 누수 0(depositRatePct·마진·KRW 비노출 유지)·tsc 0·build·전체 테스트 그린·i18n ko/vi

## 수정 금지 구역
- 스키마 무변경. messages/*.json 키 추가만. 타 세션 파일 비접촉.
