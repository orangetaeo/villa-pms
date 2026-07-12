# 계약: 티켓 발행 완료 = 이행 완료 자동 처리 (+삭제 시 해제)

- 상태: 착수 (2026-07-12)
- 브랜치: wt/ticket-auto-complete
- 배경(테오): 티켓은 발행(사진 첨부)되면 사실상 서비스 완료 — 별도 완료보고 불필요. 단 첨부
  실수 정정(삭제 후 재등록)은 가능해야 함.

## 설계 (ADR-0034 §3-3)

- **자동 완료**: 벤더 티켓 업로드 결과 `ticketUrls.length ≥ quantity`이고 `vendorCompletedAt`
  미기록이면 **vendorCompletedAt=now 자동 세팅** — PENDING→수락 전이(PR #255)와 동시든,
  이미 수락된 주문의 추가 발행이든 동일 적용. 별도 완료 통보 없음(수락 통보로 충분 — 이중 알림 방지).
- **삭제 시 해제(대칭)**: DELETE로 `ticketUrls.length < quantity`가 되면 vendorCompletedAt=null
  (정정 구간 동안 "완료" 오표시 방지). 재등록으로 다시 채우면 재완료. 수락 상태(VENDOR_ACCEPTED)는
  해제하지 않음(un-accept 없음 — 현행).
- 수동 완료보고 버튼: vendorCompletedAt 없으면 기존대로 노출(확인시트 등 미달 수동 수락 케이스).
- 운영자 대리 첨부 라우트는 상태 불변(현행 — 완료 자동화도 미적용).
- TicketPanel 안내 문구 갱신: "수량만큼 발행하면 자동으로 수락·완료 처리됩니다"(ko/vi).

## 범위
1. `app/api/vendor/orders/[id]/tickets/route.ts` — POST 자동 완료 / DELETE 미달 시 해제
2. `components/vendor/vendor-board.tsx`·`messages/ko.json`·`vi.json` — 문구만
3. ADR-0034 §3-3, 테스트: 충족 업로드=수락+완료 동시 / 수락 후 추가 발행으로 충족=완료만 /
   삭제로 미달=완료 해제(수락 유지) / 재등록 충족=재완료 / 수동 완료보고 회귀

## 수정 금지 구역
- prisma, 완료보고 라우트(complete), 운영자 대리 첨부, PR #255 수락 게이트 조건 자체

## 완료 기준 (QA)
- [ ] 2장 발행 완료 → 예약현황에 즉시 "이행 완료"(버튼 불필요), 통보는 수락 1회뿐
- [ ] 1장 삭제(1/2) → "수락됨"으로 복귀(완료 해제), 재등록 2/2 → 재완료
- [ ] 미달 수동 수락 건은 완료보고 버튼 현행, 정산·게스트 화면 회귀 없음, build 통과
