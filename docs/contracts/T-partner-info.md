# T-partner-info — 파트너 정보 완결 3종 (제안 상세·청구서 번호·입금 이력)

- 담당: BE+FE (worktree `wt/partner-info`), 독립 QA 별도
- 배경: 파트너 감사 잔여 MED 백로그(PR #182·#188·#191 후속).

## 범위
1. **제안서 포털 내 상세**: /partner/proposals — "빌라 N개" 개수만 → 제안별 아이템 목록(빌라 병기명·기간·박수·제안가(제안 통화)·아이템별 예약 상태) + /p/[token] 딥링크(가예약은 기존 공개 흐름 재사용 — 새 예약 경로 안 만듦). loadPartnerProposals에 items 추가(where partnerId 유지).
   ★ 가격 = ProposalItem 스냅샷(파트너에게 제시된 정당 가격). 원가·마진·consumer가 비노출.
2. **청구서 번호**: PartnerInvoiceRow에 invoiceNo(invoiceDisplayNo — lib/partner-invoice leaf) 추가, invoices-list 표시+검색 포함.
3. **입금 이력**: 채권 행에 본인 입금 내역(Payment where receivableId — receivedAt·금액·통화·용도) 접이식 노출. 파트너 본인 지불 기록만(정당 데이터).

## 완료 기준
- 제안 아이템에 빌라명·기간·가격 렌더, 예약된 아이템은 뱃지. 누수 0(원가·마진·KRW 채널이면 KRW 표시는 정당 — 제안 통화 그대로)
- 청구서 검색어에 번호 매칭, 행에 번호 표시
- 입금 이력 파트너 스코프(receivableId 경유 — 채권 자체가 partnerId 스코프)
- tsc 0·build·전체 테스트 그린·i18n ko/vi
## 수정 금지 구역: 스키마 무변경·messages 키 추가만·타 세션 파일 비접촉
