# Contract: T-partner-features — 여행사(PARTNER) 포털 갭 4종 추가

## 배경
파트너 포털 전수 점검 결과 4화면 전부 읽기 전용·액션 0개. 관리자에는 있으나 파트너에 빠진 것 4종(사용자 승인: A·B·C·D) 추가.

## 범위 (수정/신규 파일)
- **A. 청구서 PDF 다운로드**
  - 신규 `app/api/partner/invoices/[id]/statement/route.ts` — GET: requireAuth+PARTNER+본인 partnerId 청구서만(IDOR), 미생성시 generateInvoiceStatement 온디맨드, PDF 서빙(경로주입 가드). DRAFT/VOID 거부.
  - 수정 `app/partner/receivables/invoices-list.tsx` — ISSUED/PARTIAL/PAID/OVERDUE에 다운로드 링크.
- **B. 입금 통보**
  - 신규 `app/api/partner/receivables/payment-notice/route.ts` — POST: requireAuth+PARTNER+APPROVED, invoiceId|receivableId 본인 소유 검증, AuditLog "PARTNER_PAYMENT_NOTICE"(상태 미변경, 운영자 수동확정), assertSameOrigin+rate-limit.
  - 신규 `components/partner/payment-notice-button.tsx` — 금액(선택)·입금자명 입력 후 통보.
  - lib/audit-log.ts AuditAction 유니온에 "PARTNER_PAYMENT_NOTICE" 추가(자유 String이라 마이그X).
- **C. 연락처 자기관리**
  - 신규 `app/api/partner/profile/route.ts` — GET/PATCH: requireAuth+PARTNER, contactPhone·contactEmail만 수정(contactZaloUid·name·신용필드 절대 미변경), AuditLog UPDATE Partner.
  - 신규 `components/partner/partner-contact-form.tsx`.
  - 수정 `app/partner/profile/page.tsx` — AccountScreen extra 슬롯에 연락처 폼.
- **D. 미수 선금/잔금·기한 상세**
  - 수정 `lib/partner-portal.ts` — PartnerReceivableRow에 depositDueVnd 추가(이미 select됨).
  - 수정 `app/partner/receivables/receivables-list.tsx` — 선금/잔금 분리·기한 명확화.
- i18n: `messages/ko.json`·`vi.json` partner 네임스페이스에 키 추가만.

## 수정 금지 구역
- prisma/* seed (타 세션), 관리자 partner-invoices 라우트/탭, lib/partner-invoice-statement-service.ts(읽기 재사용만)
- 신용한도·여신등급·마진·KRW는 절대 노출 금지(사업원칙 2)

## 완료 기준 (테스트 가능)
1. 파트너 로그인 → 청구서 ISSUED PDF 다운로드 성공, 타 파트너 청구서 id로는 404(IDOR)
2. 파트너 입금통보 → AuditLog PARTNER_PAYMENT_NOTICE 적재, 상태 미변경, 타인 채권 id 404
3. 파트너 연락처(전화·이메일) 수정 성공, contactZaloUid/신용필드 불변
4. 미수 화면에 선금/잔금·기한 명확 표시
5. 누수 0: 응답·UI에 신용한도·마진·KRW·타파트너 데이터 없음
6. typecheck·lint·build 0, 독립 QA PASS

## 검증 방법
typecheck/lint/build + 독립 QA 누수검사 + (배포 후) Playwright 파트너 워크스루
