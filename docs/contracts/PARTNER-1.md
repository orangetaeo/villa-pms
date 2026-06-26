# 계약서 — PARTNER-1 여행사·랜드사(B2B) 미수·여신 토대

- 태스크: PARTNER-1 (ADR-0022)
- 담당 세션: worktree-partner-1 (EnterWorktree, origin/main 기준)
- 상태: 구현 완료 → QA 합의·배포 대기
- 선행: 없음(신규 모듈). 정합: ADR-0003(채널통화), ADR-0018(LEDGER 현금주의), ADR-0019(게스트 현장정산)

## 테오 확정 정책 (2026-06-26)
1. **신규 파트너 = 등급 A 의무(선불)**. 실적 쌓이면 ADMIN이 등급 B 승격.
2. **선금 = 객실료의 30%**(등급 B 외상도 최소 30% 선수금 필수).
3. **Phase 1 = ADMIN 전담**(파트너 포털 없음).
4. **보증예치금 미도입** → 통제는 신용한도 + 선금만.

## 핵심 원칙 — 돈의 흐름 2분리 (절대)
- ① 숙박료(B2B): 여행사/랜드사 ↔ 우리. 본 모듈(PartnerReceivable/Invoice, AR).
- ② 현장청구(B2C): 보증금·미니바·부가서비스 = 게스트 체크아웃 현장 직접지급(ADR-0019). **이 모듈에 안 들어옴.**

## 완료 기준 (테스트 가능)
1. **스키마 additive**: Partner·PartnerReceivable·PartnerInvoice + enum 6종 + Booking.partnerId·Payment(purpose·partnerId·receivableId·invoiceId). `npx prisma validate`·`generate` 통과. ✅
2. **raw SQL**: prisma/migrations-manual/2026-06-26-partner-receivables-credit.sql — IF NOT EXISTS·DO 블록 멱등, db push 금지. **실행은 배포 단계(미실행).** ✅
3. **lib/partner.ts 순수 헬퍼** + 단위테스트 통과:
   - `computeDepositDue(total, pct)` — 30% 동단위 올림, 0~100 클램프
   - `computeDueDate({tier,checkInDate,periodEnd,termDays})` — A=체크인일, B/C=마감+termDays
   - `receivableOutstanding` / `outstandingForPartner` — 완납·대손 제외 미수 잔액
   - `hasOverdue` — 기한경과+미입금 or OVERDUE
   - `canCreateBookingFor` — 신용게이트(BLOCKED/SUSPENDED/연체/한도초과 차단, 등급A 통과)
   - `agingBuckets` — 0-7/8-15/16-30/30+
4. **dual-read**: Booking.agencyName 폴백 유지(partnerId 우선, 없으면 텍스트).
5. **게이트**: `npm run typecheck`·`npm test`·`npm run build` 그린.

## 누수 가드 (QA 점검 — 원칙 2 마진 비공개)
- lib/partner.ts는 **순수 함수**(DB·라우트·페이지 신설 없음) → 이 태스크의 누수 표면 0.
- 미수·신용한도·청구서 금액은 PARTNER-2/3에서 화면 노출 시 **전부 ADMIN(canViewFinance) 전용**. 공급자(/earnings, /my-villas)·게스트(/g, /p)·공개 라우트에 Partner/Receivable/Invoice 직렬화 금지. leak-checklist 적용.
- PaymentPurpose.GUEST(기존 고객입금) 동작 무변경 — 하위호환 default.

## 범위 (수정/신규 파일)
- `prisma/schema.prisma` — enum 6 + model 3 + Booking·Payment 확장 (additive). **이 세션 스키마 전담.**
- `prisma/migrations-manual/2026-06-26-partner-receivables-credit.sql` (신규)
- `lib/partner.ts` (신규) — 정책 단일 소스
- `lib/partner.test.ts` (신규)
- `docs/decisions/ADR-0022-partner-receivables-credit.md` (신규)
- `docs/INDEX.md`·`TASKS.md`·`PROGRESS.md` — 등록 행 추가만

## 수정 금지 구역 (타 세션 작업 중)
- 공유 메인 폴더 직접 커밋 금지(worktree 격리 유지).
- 타 세션 활성: SPEC.md 편집·Sprint 5(ADR-0021 공급자 직접판매)·기타. 해당 파일 비접촉.
- lib/hold.ts·confirm/checkin API·settlement·ledger는 **PARTNER-2에서** 게이트 통합(이 태스크는 헬퍼만 제공, 호출처 미변경).

## 배포 순서 (PARTNER-1 머지 시)
1. prod 백업 → raw SQL 실행(공개 프록시) → 테이블·enum·FK 검증
2. PR 머지·배포 → `prisma generate`(빌드 시 자동)
3. PARTNER-2 착수(화면·게이트 통합)

## 후속 (PARTNER-2/3)
- PARTNER-2: /partners·/partners/[id], 예약 확정 흐름 게이트 통합(canCreateBookingFor 호출), Payment.purpose 입금 기록, 등급A 체크인 게이트.
- PARTNER-3: /receivables Aging 대시보드, PartnerInvoice 마감청구서 PDF·Zalo, 연체 자동제재 cron.
