# 스프린트 계약 — Sprint 5 / F10 공급자 직접 판매 채널 Phase A (T10.0~T10.5)

- 작성: TDA/PM / 합의: QA / 날짜: 2026-06-26
- 브랜치: **wt/f10-supplier-direct** (격리 워크트리 — 공유 메인 직접작업 금지)
- 근거 문서: docs/decisions/ADR-0021, docs/SPEC.md F10, prisma/schema.prisma(Booking·Notification·VillaRatePeriod), lib/availability.ts·lib/hold.ts·lib/checkin.ts·lib/checkout.ts·lib/settlement.ts·lib/timeline.ts
- 확정(테오 2026-06-26): D1 둘 다(단계적) · D2 선착순 · D3 공급자 100%(정산 제외) · D4 검수 미승인 빌라 직접판매 허용 · D5 직접예약 게스트도 정식 F4 검수(공급자 vi 수행)

## 병렬 세션 주의 (동시 진행: ADR-0022 PARTNER 세션)

- **다른 세션이 PARTNER-1~4(여행사·랜드사 AR/여신)를 공유 메인 폴더에서 진행 중.** 본 F10은 별도 워크트리에서 격리 진행.
- **스키마 충돌 주의(규칙 #6)**: PARTNER-1도 `Booking`에 `partnerId` 추가 + raw ALTER 예정. T10.1도 `Booking`에 `seller`·`supplierSalePriceVnd` 추가. **둘 다 Booking 테이블 ALTER → 스키마 적용은 한 세션씩 순차**, 라이브 DB에 동시 ALTER 금지. T10.1 착수 전 PARTNER-1 스키마 상태 확인하고 additive 컬럼만 각자 ALTER(컬럼명 비충돌: seller/supplierSalePriceVnd ↔ partnerId).
- 공유 파일(messages/*.json·schema.prisma) 수정 시 추가만 + 빠른 커밋.

## 수정 금지 구역 (병렬 세션 규칙 #2)

- PARTNER 세션 영역: `lib/partner.ts`, `app/(admin)/partners/**`, `app/(admin)/receivables/**`, `app/api/partners/**`, `Partner`·`PartnerReceivable`·`PartnerInvoice` 모델 — **F10은 일절 수정 안 함**.
- 공유(추가만): `prisma/schema.prisma`(Booking에 seller·supplierSalePriceVnd / NotificationType enum 값만 추가), `messages/ko.json`·`vi.json`(키 추가만).

## 범위 (In) — Phase A

### T10.1 스키마 (TDA/BE, 1세션 전담)
- `enum BookingSeller { OPERATOR | SUPPLIER }`, `Booking.seller BookingSeller @default(OPERATOR)`, `Booking.supplierSalePriceVnd BigInt?`
- `NotificationType`에 `SUPPLIER_DIRECT_BOOKING` 추가
- **raw SQL ALTER**로 라이브 DB 적용(db push 금지), 기존 Booking 전부 seller=OPERATOR 백필, `--schema` 명시 generate
- 완료 기준: `git cat-file`로 schema 반영 확인, 기존 예약 seller=OPERATOR 실측, typecheck 0

### T10.2 직접예약 API+UI (BE/UX-VN)
- `POST /api/supplier/bookings` — 첫 줄 role=SUPPLIER 검사 + `villa.supplierId === session.user.id` 강제. 입력 zod(villaId·checkIn·checkOut·guestName·guestCount·optional guestPhone·optional supplierSalePriceVnd). 기존 `lockVillaInventory()` + `checkAvailability(tx)` 트랜잭션 통과 → `Booking(seller=SUPPLIER, status=CONFIRMED, channel=DIRECT)` + `writeAuditLog(tx)`. 선착순 패배 시 409(사유 코드만, 운영자 예약 상세 비노출)
- `DELETE /api/supplier/bookings/[id]` — `seller=SUPPLIER` AND 자기 supplierId 가드, CONFIRMED→CANCELLED
- `/calendar` 빈 날짜 바텀시트에 "직접 예약 기록" 추가(기존 차단 토글과 공존), 폼 1장(vi)
- 완료 기준: 타인 빌라 403·운영자 홀드 날짜 409·생성 후 가용성 점유 실측, AuditLog 기록 확인

### T10.3 운영자 가시성 (FE)
- `lib/timeline.ts` 셀 상태 enum에 `SUPPLIER_DIRECT` 추가(T1.5 계약 — enum 고정 호환 유지, 기존 값 변경 금지) + 타임라인/대시보드 신규 셀 색·범례
- `/bookings` 필터에 `seller`(전체/운영자/공급자) 추가
- 완료 기준: 공급자 직접예약이 타임라인에 별도 색으로 표시, 운영자에게만 노출(공급자 화면 영향 0)

### T10.4 정산 제외 + 알림 + 누수 (BE/INTEG/QA)
- `lib/settlement.ts` 월 집계 쿼리에 `seller: 'OPERATOR'` 필터 → seller=SUPPLIER 예약 제외
- 직접예약 생성 시 운영자 Notification(`SUPPLIER_DIRECT_BOOKING`, 판매가·마진 미포함)
- 누수 QA 4종(아래 검증 방법)
- 완료 기준: 정산 집계에 seller=SUPPLIER 0건, 누수 0건

### T10.5 공급자 vi 체크인·아웃 검수 (UX-VN/BE) — D5
- 공급자 vi 신규 라우트(`app/(supplier)/` 하위, 예: `/my-bookings/[id]/checkin`·`/checkout`). 권한 `seller=SUPPLIER` AND `villa.supplierId === session.user.id`
- 체크인: 여권 업로드→Gemini OCR→보증금 기록→`lib/agreement.ts` 동의서(수영장 조항 자동) 서명→`lib/checkin.ts` 재사용으로 CHECKED_IN. **"운영자 전달" 단계 제외**(공급자 본인 임시거주신고)
- 체크아웃: 기준사진 대조→파손/보증금→**미니바 소모 정산 블록(D6)**→`lib/checkout.ts` 재사용으로 CHECKED_OUT + CleaningTask + isSellable=false. 미니바=운영자 재고이므로 소모분(소비수량×판매가)은 우리 매출로 게스트 청구(공급자 직접판매여도). **전환별 자동 보충/회수(다음 seller 인지)는 본 태스크 범위 밖 → ADR-0019 미니바 실재고 Phase 2**. Phase A는 체크아웃 정산 UI만(미니바 실재고 미구축 시 화면 노출 가드)
- 여권·서명은 기존 비공개 증빙 파이프라인 재사용(공급자도 자기 게스트분만 접근). 서명 비게이트+미서명 배지(T3.1 조건 C 연속)
- 완료 기준: 공급자가 자기 직접예약만 검수 가능(타 예약 403), 여권 비공개 유지, 운영자 예약엔 공급자 검수 진입 불가

## 범위 밖 (Out)
- Phase B 전체(T10.6 공급자 판매가, T10.7 공급자 판매 링크) — 별도 스프린트
- PARTNER-1~4(여행사·랜드사 AR/여신) — 다른 세션
- Railway cron 신규 등록(직접예약은 cron 불필요), 공급자 직접예약 Zalo 발송 실연결(Notification 큐 적재까지)

## 검증 방법 (QA 독립 평가 — 작성자≠평가자)
1. 권한 누수 4종: ① 공급자가 타인 빌라 직접예약 POST → 403 ② 직접예약 API 응답·타임라인 공급자뷰에 운영자 salePriceKrw/margin → 0건 ③ 운영자 홀드 날짜에 공급자 직접예약 → 409(상세 비노출) ④ 정산 집계 seller=SUPPLIER 혼입 → 0건
2. 선착순: 동일 날짜에 운영자 홀드 vs 공급자 직접예약 경합 — 먼저 잡은 쪽만 성공(트랜잭션 잠금)
3. D5 검수: 공급자가 자기 직접예약 체크인(여권 OCR·서명)·체크아웃(청소 게이트) 실수행, 타 공급자/운영자 예약 검수 진입 403
4. 게이트: typecheck 0 · 단위테스트 · `next build` 그린(배포 게이트)

## 합의 편차 (QA 판단 요청)
- 직접예약 status: 수동 기록이므로 즉시 `CONFIRMED` 생성(HOLD 단계 생략) — 공급자가 이미 자기 고객 수금 완료 가정. QA 수용 여부 확인.
- 서명 비게이트(D5): 운영자 플로우와 동일하게 미서명 허용+배지. 강제 게이트는 운영 후 검토.
