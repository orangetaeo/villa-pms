# 계약: PARTNER-3b-UI — 파트너 마감 청구서 UI·PDF(vi)·Zalo 발송

**브랜치**: wt/partner-3b-ui (origin/main 기준)
**담당**: BE+FE (단일 세션, worktree 격리)
**ADR**: ADR-0022 (PARTNER B2B 미수·여신). 3b-1(서비스)·3b-2(API)는 머지·배포 완료.

## 범위 (이번 스프린트)
1. **청구서 탭** — `/partners/[id]`에 탭(미수/청구서) 추가. 청구서 목록(기간·기한·총액·수납·상태·채권수) + 액션: 생성(기간 입력)·발행·수납·무효·PDF 다운로드·Zalo 발송. **canViewFinance 전용**(누수 가드 — 한도·마진 미노출).
2. **청구서 PDF(vi)** — react-pdf, 정산서 PDF 패턴(`lib/settlement-statement-*`) 재사용. 신규:
   - `lib/partner-invoice-statement.ts` (순수 모델 빌더)
   - `lib/partner-invoice-pdf.tsx` (렌더)
   - `lib/partner-invoice-statement-service.ts` (생성·저장·statementUrl 갱신·audit)
   - `lib/storage.ts`에 invoice 파일 헬퍼 추가(비공개 디스크, 결정형 파일명)
   - 파트너명은 `nameVi` 우선·`name` 폴백(vi 대상, 한글 토푸 회피)
3. **Zalo 발송** — `POST /api/partner-invoices/[id]/send`: partner.contactZaloUid로 `sendBotMessageWithAttachments`(PDF 첨부) + 텍스트 폴백. canViewFinance 전용.

## 수정 금지 구역 (타 세션 작업)
- `app/(admin)/inventory/**`, `app/(admin)/settings/minibar/**`, `lib/minibar*` — 미니바 재고 세션
- `prisma/schema.prisma` — 변경 없음(PartnerInvoice.statementUrl 기존 컬럼 사용)

## 완료 기준 (테스트 가능)
- [ ] /partners/[id] 청구서 탭에서 기간 지정 생성 → 발행 → 수납 → 완납 시 채권 PAID 반영, 무효 시 채권 재청구 가능
- [ ] PDF: 파트너명(vi)·기간·기한·채권 라인(빌라·체크아웃·잔금)·총액 렌더, 베트남어 글리프 정상
- [ ] PDF·Zalo 본문에 신용한도·마진·판매가(KRW) 직렬화 0 (grep 실증)
- [ ] Zalo 발송: contactZaloUid 없으면 명확한 에러, 봇 미연결 시 graceful
- [ ] typecheck 0 · 단위테스트(모델 합계·상태) · next build 통과 · 누수 grep 0

## 명시적 제외 (후속·결정)
- **청구서 수납 → LEDGER COLLECTION 분개**: ADR-0022가 "AR=운영 테이블·발생주의 분개 기각·돈흐름 2분리"로 이미 결정. 기존 LEDGER COLLECTION은 B2C Payment(paymentId @unique) 기반 → B2B 청구서 수납을 REVENUE에 끼우면 이중계상·돈흐름 혼선. **연결하지 않음**(채권 PAID 정산만). 필요 시 별도 ADR.
- **2c 폴리시**(입금 purpose 선택·확정 차단 토스트): 예약 결제폼 영역, 청구서 탭과 무관 → 후속.
