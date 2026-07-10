/**
 * 시연용 아시아써니(랜드사) 미수 거래 시드 (수동 1회용, 시연/테스트 DB 전용)
 *
 *   목적: 테오가 관리자 화면에서 "미수채권 → 파트너 입금통보 → 수납 확인" 흐름을 시연.
 *   현재 라이브: Partner p-asiasunny(랜드사, 등급 B·선금 30%·15일·MONTHLY, APPROVED) 예약 654건은
 *   있으나 PartnerReceivable 0건 → 미수 원장이 비어 시연 불가. 이 스크립트가 기존 예약을 재사용해
 *   채권 5건을 소급 생성한다(신규 예약 생성 없음).
 *
 *   생성 데이터 (전부 id 접두 `demo-ar-` — 정리 용이):
 *     - demo-ar-1  OVERDUE  (연체·미입금)         — 에이징 30+ 버킷, 대시보드 빨간 KPI 시연
 *     - demo-ar-2  PARTIAL  (선금 30% 입금)        — 정상 수납 경로(Payment purpose=DEPOSIT + LEDGER COLLECTION)
 *     - demo-ar-3  PENDING  + 파트너 입금통보 완료  — AuditLog(PARTNER_PAYMENT_NOTICE, entity=PartnerReceivable)
 *                                                     → 관리자 대시보드 "활동" 피드에 amber 신호로 노출(확인 대상)
 *     - demo-ar-4  PENDING  (미입금)
 *     - demo-ar-5  PENDING  (미입금)
 *
 *   ★ 정상 경로 정합:
 *     - 필드 산출은 lib/partner-booking.ensureReceivableForBooking 과 동일 공식
 *       (totalVnd = Booking.totalSaleVnd 스냅샷, depositDueVnd = computeDepositDue(total, 30%)).
 *     - 부분입금은 app/api/bookings/[id]/payments(purpose=DEPOSIT)와 동형:
 *       Payment(purpose=DEPOSIT, partnerId, receivableId) + LEDGER COLLECTION 분개(CASH_VND +/ REVENUE −).
 *     - 입금통보는 app/api/partner/receivables/payment-notice 와 동형 AuditLog(상태 미변경).
 *     - Zalo 발송은 트리거하지 않음 — DB 아티팩트만 적재.
 *
 *   ★ dueDate 설계: 시연 시점 무관하게 에이징이 또렷하도록 실행시각(now) 기준 상대 오프셋으로 설정.
 *     (예약 checkIn+15 자연 기한은 전 후보가 미래(Sept)라 연체가 안 생기므로 데모용으로 오프셋 지정.)
 *     status=OVERDUE 는 cron(markOverdueReceivables)이 기한경과 PENDING을 전이시킨 결과와 동일.
 *
 *   실행:
 *     npx tsx --env-file=.env prisma/seed-demo-asiasunny-receivables.ts            # dry-run(쓰기 0)
 *     npx tsx --env-file=.env prisma/seed-demo-asiasunny-receivables.ts --execute  # 본실행
 *   멱등: --execute 시 기존 demo-ar-* (채권·결제·원장·입금통보 로그)를 먼저 삭제 후 재생성.
 */
import {
  PrismaClient,
  Currency,
  PaymentMethod,
  PaymentPurpose,
  ReceivableStatus,
  LedgerEntryType,
} from "@prisma/client";
import { computeDepositDue } from "@/lib/partner";
import { buildCollectionLines } from "@/lib/ledger";

const prisma = new PrismaClient();

const EXECUTE = process.argv.includes("--execute");
const PARTNER_ID = "p-asiasunny";
const PARTNER_USER_ID = "u-asiasunny-land"; // 입금통보 AuditLog.userId (role=PARTNER)
const ID_PREFIX = "demo-ar-";
const DEPOSITOR_NAME = "Asia Sunny"; // 파트너 자진신고 입금자명

/** UTC 자정 기준 날짜 (@db.Date 규약) */
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fmtVnd(v: bigint): string {
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " ₫";
}

/** 채권 1건 설계 — 실행시각 기준 dueDate 오프셋으로 에이징 분산 */
interface RcvPlan {
  id: string;
  dueOffsetDays: number;
  status: ReceivableStatus;
  /** 선금 입금(부분수납) 여부 — true면 Payment(purpose=DEPOSIT)+LEDGER 적재 */
  payDeposit: boolean;
  /** 파트너 입금통보(AuditLog) 여부 */
  paymentNotice: boolean;
  label: string;
}

const PLAN: RcvPlan[] = [
  { id: `${ID_PREFIX}1`, dueOffsetDays: -35, status: ReceivableStatus.OVERDUE, payDeposit: false, paymentNotice: false, label: "연체(미입금) — 에이징 30+" },
  { id: `${ID_PREFIX}2`, dueOffsetDays: 5, status: ReceivableStatus.PARTIAL, payDeposit: true, paymentNotice: false, label: "부분입금(선금 30% 수납)" },
  { id: `${ID_PREFIX}3`, dueOffsetDays: 2, status: ReceivableStatus.PENDING, payDeposit: false, paymentNotice: true, label: "미입금 + 파트너 입금통보(확인 대상)" },
  { id: `${ID_PREFIX}4`, dueOffsetDays: 12, status: ReceivableStatus.PENDING, payDeposit: false, paymentNotice: false, label: "미입금" },
  { id: `${ID_PREFIX}5`, dueOffsetDays: 20, status: ReceivableStatus.PENDING, payDeposit: false, paymentNotice: false, label: "미입금" },
];

async function main() {
  const now = new Date();
  const today = startOfUtcDay(now);

  // ── 사전 점검 ────────────────────────────────────────────────
  const partner = await prisma.partner.findUnique({
    where: { id: PARTNER_ID },
    select: { id: true, name: true, creditTier: true, depositRatePct: true, approvalStatus: true, userId: true, status: true },
  });
  if (!partner) throw new Error(`Partner ${PARTNER_ID} 없음 — 시드 중단`);
  console.log(`파트너: ${partner.name} (등급 ${partner.creditTier}, 선금 ${partner.depositRatePct}%, 승인 ${partner.approvalStatus}, 상태 ${partner.status})`);
  if (partner.approvalStatus !== "APPROVED") {
    console.log(`  ⚠ approvalStatus=${partner.approvalStatus} — 포털 로그인 차단 상태. (본 스크립트는 승인 보정 불필요: 이미 APPROVED면 미개입)`);
  }
  const depositRatePct = partner.depositRatePct ?? 30;

  // 기존 demo-ar-* 현황
  const existing = await prisma.partnerReceivable.findMany({
    where: { id: { startsWith: ID_PREFIX } },
    select: { id: true, bookingId: true },
  });
  if (existing.length > 0) {
    console.log(`기존 demo-ar-* 채권 ${existing.length}건 존재 — ${EXECUTE ? "삭제 후 재생성" : "dry-run(재생성 예정으로 표시)"}`);
  }
  const existingBookingIds = new Set(existing.map((e) => e.bookingId));

  // ── 후보 예약 선택 (기존 CONFIRMED·VND·채권 미보유, checkIn 내림차순 5건) ──
  const candidates = await prisma.booking.findMany({
    where: {
      partnerId: PARTNER_ID,
      status: "CONFIRMED",
      saleCurrency: Currency.VND,
      totalSaleVnd: { not: null },
    },
    select: { id: true, checkIn: true, checkOut: true, totalSaleVnd: true, guestName: true, villa: { select: { name: true } } },
    orderBy: [{ checkIn: "desc" }, { id: "asc" }],
    take: 60,
  });
  // 이미 채권 보유한 예약 제외 (demo-ar 재생성 시엔 곧 삭제될 것이므로 재사용 허용)
  const withRcv = await prisma.partnerReceivable.findMany({
    where: { bookingId: { in: candidates.map((c) => c.id) } },
    select: { bookingId: true, id: true },
  });
  const blockedBookingIds = new Set(
    withRcv.filter((r) => !r.id.startsWith(ID_PREFIX)).map((r) => r.bookingId)
  );
  const usable = candidates.filter((c) => !blockedBookingIds.has(c.id));
  if (usable.length < PLAN.length) {
    throw new Error(`재사용 가능한 CONFIRMED·VND 예약이 부족(${usable.length} < ${PLAN.length}) — 시드 중단`);
  }
  const chosen = usable.slice(0, PLAN.length);

  // ── 계획 합성 ────────────────────────────────────────────────
  interface Built {
    plan: RcvPlan;
    bookingId: string;
    villaName: string;
    guestName: string;
    checkIn: Date;
    totalVnd: bigint;
    depositDueVnd: bigint;
    dueDate: Date;
    depositPaidVnd: bigint;
    payId: string | null;
  }
  const built: Built[] = chosen.map((b, i) => {
    const plan = PLAN[i];
    const totalVnd = b.totalSaleVnd as bigint;
    const depositDueVnd = computeDepositDue(totalVnd, depositRatePct);
    const dueDate = addDays(today, plan.dueOffsetDays);
    const depositPaidVnd = plan.payDeposit ? depositDueVnd : 0n;
    return {
      plan,
      bookingId: b.id,
      villaName: b.villa.name,
      guestName: b.guestName,
      checkIn: b.checkIn,
      totalVnd,
      depositDueVnd,
      dueDate,
      depositPaidVnd,
      payId: plan.payDeposit ? `${ID_PREFIX}pay-${i + 1}` : null,
    };
  });

  // ── 출력 (dry-run·execute 공통 계획표) ──────────────────────
  console.log(`\n오늘(UTC): ${fmtDate(today)}  |  대상 채권 ${built.length}건 (파트너 ${partner.name})\n`);
  let totalOutstanding = 0n;
  let overdueOutstanding = 0n;
  for (const x of built) {
    const paid = x.depositPaidVnd;
    const outstanding = x.totalVnd - paid;
    totalOutstanding += outstanding;
    const isOverdue = x.plan.status === ReceivableStatus.OVERDUE || x.dueDate < today;
    if (isOverdue && outstanding > 0n) overdueOutstanding += outstanding;
    console.log(
      `  ${x.plan.id.padEnd(11)} ${x.plan.status.padEnd(8)} 기한 ${fmtDate(x.dueDate)} ` +
        `총 ${fmtVnd(x.totalVnd).padStart(16)}  입금 ${fmtVnd(paid).padStart(14)}  잔 ${fmtVnd(outstanding).padStart(16)}`
    );
    console.log(`      ↳ 예약 ${x.bookingId} · ${x.villaName} · ${x.guestName} (체크인 ${fmtDate(x.checkIn)}) — ${x.plan.label}`);
    if (x.plan.payDeposit) {
      console.log(`      ↳ Payment ${x.payId}: VND ${x.depositDueVnd} (purpose=DEPOSIT, VN_BANK_TRANSFER) + LEDGER COLLECTION 분개`);
    }
    if (x.plan.paymentNotice) {
      console.log(`      ↳ AuditLog PARTNER_PAYMENT_NOTICE (entity=PartnerReceivable, userId=${PARTNER_USER_ID}, amountVnd=${x.totalVnd})`);
    }
  }
  console.log(`\n  미수 합계(전체 잔액): ${fmtVnd(totalOutstanding)}`);
  console.log(`  연체 미수(기한경과 잔액): ${fmtVnd(overdueOutstanding)}`);
  console.log(`  파트너 신용한도 대비: 이 미수는 등급 B 한도(2,000,000,000₫) 내 — 포털/발주 차단 없음(단, 연체 존재 시 신규 예약 신용게이트는 차단됨=정상 시연)`);

  if (!EXECUTE) {
    console.log(`\n[DRY-RUN] 쓰기 0건. 본실행: --execute 플래그 추가.`);
    return;
  }

  // ── 본실행 ───────────────────────────────────────────────────
  const admin = await prisma.user.findFirst({
    where: { role: "OWNER" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  if (!admin) throw new Error("OWNER 사용자 없음 — LEDGER createdBy 불가, 중단");

  await prisma.$transaction(async (tx) => {
    // 1) 기존 demo-ar-* 정리 (원장 → 결제 → 입금통보 로그 → 채권 순, FK 안전)
    const oldPays = await tx.payment.findMany({ where: { id: { startsWith: ID_PREFIX } }, select: { id: true } });
    const oldPayIds = oldPays.map((p) => p.id);
    if (oldPayIds.length) {
      await tx.ledgerTransaction.deleteMany({ where: { paymentId: { in: oldPayIds } } });
      await tx.payment.deleteMany({ where: { id: { in: oldPayIds } } });
    }
    await tx.auditLog.deleteMany({
      where: { action: "PARTNER_PAYMENT_NOTICE", entity: "PartnerReceivable", entityId: { startsWith: ID_PREFIX } },
    });
    // Payment(CREATE) 감사로그도 정리 (payId 기준)
    if (oldPayIds.length) {
      await tx.auditLog.deleteMany({ where: { entity: "Payment", entityId: { in: oldPayIds } } });
    }
    await tx.partnerReceivable.deleteMany({ where: { id: { startsWith: ID_PREFIX } } });

    // 2) 채권 생성
    for (const x of built) {
      await tx.partnerReceivable.create({
        data: {
          id: x.plan.id,
          partnerId: PARTNER_ID,
          bookingId: x.bookingId,
          totalVnd: x.totalVnd,
          depositDueVnd: x.depositDueVnd,
          depositPaidVnd: x.depositPaidVnd,
          balancePaidVnd: 0n,
          dueDate: x.dueDate,
          status: x.plan.status,
        },
      });

      // 3) 부분입금(선금) — 정상 수납 경로와 동형: Payment + LEDGER COLLECTION
      if (x.plan.payDeposit && x.payId) {
        const receivedAt = addDays(today, -3);
        const amount = x.depositDueVnd;
        await tx.payment.create({
          data: {
            id: x.payId,
            bookingId: x.bookingId,
            currency: Currency.VND,
            amount,
            method: PaymentMethod.VN_BANK_TRANSFER,
            fxRateToVnd: null,
            vndEquivalent: amount,
            receivedAt,
            note: "[demo] 아시아써니 선금 입금(시연)",
            purpose: PaymentPurpose.DEPOSIT,
            partnerId: PARTNER_ID,
            receivableId: x.plan.id,
          },
        });
        // LEDGER COLLECTION 분개 (CASH_VND +/ REVENUE −) — paymentId 1:1 멱등
        const lines = buildCollectionLines(Currency.VND, amount);
        await tx.ledgerTransaction.create({
          data: {
            type: LedgerEntryType.COLLECTION,
            occurredAt: receivedAt,
            paymentId: x.payId,
            memo: "[demo] 아시아써니 선금 수납",
            createdBy: admin.id,
            lines: { create: lines.map((l) => ({ account: l.account, currency: l.currency, amount: l.amount })) },
          },
        });
        await tx.auditLog.create({
          data: {
            userId: admin.id,
            action: "CREATE",
            entity: "Payment",
            entityId: x.payId,
            changes: {
              bookingId: { old: null, new: x.bookingId },
              amount: { old: null, new: `VND ${amount}` },
              purpose: { old: null, new: "DEPOSIT" },
            },
          },
        });
      }

      // 4) 파트너 입금통보 — payment-notice 라우트와 동형 AuditLog(상태 미변경)
      if (x.plan.paymentNotice) {
        await tx.auditLog.create({
          data: {
            userId: PARTNER_USER_ID,
            action: "PARTNER_PAYMENT_NOTICE",
            entity: "PartnerReceivable",
            entityId: x.plan.id,
            changes: {
              amountVnd: { new: x.totalVnd.toString() },
              depositorName: { new: DEPOSITOR_NAME },
              notedAt: { new: new Date(now.getTime() - 60 * 60 * 1000).toISOString() },
            },
            // 활동 피드 최상단 노출용 — 최근 시각
            createdAt: new Date(now.getTime() - 60 * 60 * 1000),
          },
        });
      }
    }
  });

  console.log(`\n[EXECUTE] 완료 — 채권 ${built.length}건 + 선금결제/원장 1건 + 입금통보 로그 1건 적재.`);
  console.log(`시연 동선:`);
  console.log(`  1) /receivables — KPI(총 미수·연체 미수·연체 파트너 1) + 에이징(30+ 빨강) 확인, 목록에서 '${partner.name}' 클릭`);
  console.log(`  2) /partners/${PARTNER_ID} — 채권 5건(연체/부분/미입금) 상태 배지·기한·입금액 확인`);
  console.log(`  3) 대시보드 활동 피드 — 파트너 입금통보(amber) 신호 확인 → 확인할 미수 입금 인지`);
  console.log(`  4) 입금통보 채권(demo-ar-3)의 예약(${built[2].bookingId}) 상세 → 결제 기록(purpose=BALANCE, VND) → 채권 PAID 전이 시연`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
