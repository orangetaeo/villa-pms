// 버그 시절 과대 보증금 상계 정정 (T-guest-bill-double-count-fix 후속, 테오 지시 2026-07-13)
//
// 배경: 청구 이중 계상 버그(₫원천+₩표시 스냅샷 합산) 시절, 체크아웃 화면이 청구를 과대 표시해
//   보증금 상계(DEPOSIT 수납 라인)가 실제 청구보다 크게 승인된 레코드가 있다(예: 청구 2.8M인데 상계 3.0M).
//   운영자 의도는 "청구만큼 차감 후 잔액 환불"이므로, 과대 상계분을 감액해 기록을 정정한다
//   → 영수증·상세가 "상계=정정 청구, 환불액=차액"으로 표시된다.
//
// 정정 규칙(레코드별):
//   correctedCharge(₫환산) = 미니바 라인 + 정정 청구(원천 1회 계상, settlementFx로 KRW 환산)
//   paid(₫환산) = Σ수납 라인(통화별, settlementFx 환산)
//   excess = paid − correctedCharge (>1만₫일 때만 정정 대상)
//   감액 = min(excess, DEPOSIT VND 라인 금액) — DEPOSIT 라인·settledVnd·depositDeductVnd에서 동일 감액.
//   수납(현금·이체) 라인은 불변(실제 받은 돈), 감액은 보증금 상계에서만(보증금 환불로 자연 반환).
//   ★DEPOSIT 라인이 비VND(보증금 통화 상계 일반화 이후)는 대상 아님 — 버그 시절엔 VND 전용이었음.
//   AuditLog(UPDATE, CheckOutRecord) 기록. DepositStatus는 잔여 차감>0이면 PARTIAL_DEDUCTED 유지.
//
// 실행: npx tsx scripts/fix-overcollected-deposit-offset.ts            # dry-run
//       npx tsx scripts/fix-overcollected-deposit-offset.ts --apply    # 적용
import { PrismaClient, ServiceOrderStatus } from "@prisma/client";
import { computeGuestBill } from "@/lib/checkout-settlement";
import { writeAuditLog } from "@/lib/audit-log";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const TOL = 10_000n; // 끝전 면제(운영 규칙과 동일)

async function main() {
  console.log(`=== 과대 보증금 상계 정정 ${APPLY ? "(APPLY)" : "(DRY-RUN)"} ===`);

  // 운영자 = OWNER (실제 Role enum — ADMIN은 개념 명칭). 감사 로그 actor.
  const admin = await prisma.user.findFirst({ where: { role: "OWNER" }, select: { id: true } });
  if (!admin) throw new Error("OWNER(운영자) 사용자 없음 — 감사 로그 기록 불가");

  const records = await prisma.checkOutRecord.findMany({
    where: { settlementLines: { some: { method: "DEPOSIT" } } },
    select: {
      id: true,
      bookingId: true,
      deductionVnd: true,
      settledVnd: true,
      settlementFx: true,
      minibarLines: { select: { lineVnd: true } },
      settlementLines: { select: { id: true, method: true, currency: true, amount: true } },
      booking: { select: { guestName: true } },
    },
  });

  let fixed = 0;
  for (const r of records) {
    const fx = r.settlementFx as { vndPerKrw?: number; vndPerUsd?: number } | null;
    const vndPerKrw = fx?.vndPerKrw && fx.vndPerKrw > 0 ? fx.vndPerKrw : null;
    const vndPerUsd = fx?.vndPerUsd && fx.vndPerUsd > 0 ? fx.vndPerUsd : null;

    const orders = await prisma.serviceOrder.findMany({
      where: {
        bookingId: r.bookingId,
        status: { in: [ServiceOrderStatus.CONFIRMED, ServiceOrderStatus.DELIVERED] },
      },
      select: { priceVnd: true, priceKrw: true },
    });
    const minibarVnd = r.minibarLines.reduce((a, m) => a + m.lineVnd, 0n);
    const bill = computeGuestBill(minibarVnd, orders);
    // 정정 청구 ₫환산 — KRW-원천 청구가 있는데 환율 스냅샷 없으면 환산 불가 → 건너뜀(오정정 방지)
    if (bill.totalKrw > 0 && !vndPerKrw) {
      console.log(`  [${r.booking.guestName}] SKIP — KRW 청구 환산 불가(fx 없음)`);
      continue;
    }
    const charge =
      bill.totalVnd + (bill.totalKrw > 0 && vndPerKrw ? BigInt(Math.round(bill.totalKrw * vndPerKrw)) : 0n);

    // 수납 ₫환산 — 비VND 수납 라인이 있는데 환산 불가면 건너뜀
    let paid = 0n;
    let convertible = true;
    for (const l of r.settlementLines) {
      if (l.currency === "VND") paid += l.amount;
      else if (l.currency === "KRW" && vndPerKrw) paid += BigInt(Math.round(Number(l.amount) * vndPerKrw));
      else if (l.currency === "USD" && vndPerUsd) paid += BigInt(Math.round(Number(l.amount) * vndPerUsd));
      else convertible = false;
    }
    if (!convertible) {
      console.log(`  [${r.booking.guestName}] SKIP — 수납 라인 환산 불가`);
      continue;
    }

    const excess = paid - charge;
    if (excess <= TOL) continue; // 과대 상계 아님

    const depositLine = r.settlementLines.find((l) => l.method === "DEPOSIT" && l.currency === "VND");
    if (!depositLine) {
      console.log(`  [${r.booking.guestName}] SKIP — VND DEPOSIT 라인 없음(수동 확인 필요)`);
      continue;
    }
    const cut = excess < depositLine.amount ? excess : depositLine.amount;
    const newLineAmount = depositLine.amount - cut;
    const newSettledVnd = (r.settledVnd ?? 0n) - cut;
    const newDeduction = (r.deductionVnd ?? 0n) - cut;

    fixed += 1;
    console.log(
      `  [${r.booking.guestName}] record=${r.id} 청구환산=${charge} 수납환산=${paid} 초과=${excess}\n` +
        `    DEPOSIT 라인: ${depositLine.amount} → ${newLineAmount}\n` +
        `    settledVnd: ${r.settledVnd} → ${newSettledVnd} / deductionVnd: ${r.deductionVnd} → ${newDeduction}`
    );

    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        if (newLineAmount > 0n) {
          await tx.checkoutSettlementLine.update({
            where: { id: depositLine.id },
            data: { amount: newLineAmount },
          });
        } else {
          await tx.checkoutSettlementLine.delete({ where: { id: depositLine.id } });
        }
        await tx.checkOutRecord.update({
          where: { id: r.id },
          data: {
            settledVnd: newSettledVnd > 0n ? newSettledVnd : null,
            deductionVnd: newDeduction > 0n ? newDeduction : null,
          },
        });
        await tx.booking.update({
          where: { id: r.bookingId },
          data: {
            depositDeductVnd: newDeduction > 0n ? newDeduction : null,
            depositStatus: newDeduction > 0n ? "PARTIAL_DEDUCTED" : "REFUNDED",
          },
        });
        await writeAuditLog({
          db: tx,
          userId: admin.id,
          action: "UPDATE",
          entity: "CheckOutRecord",
          entityId: r.id,
          changes: {
            reason: { new: "이중 계상 버그 과대 상계 정정 (T-guest-bill-double-count-fix)" },
            depositOffsetVnd: { old: depositLine.amount.toString(), new: newLineAmount.toString() },
            settledVnd: { old: (r.settledVnd ?? 0n).toString(), new: newSettledVnd.toString() },
            deductionVnd: { old: (r.deductionVnd ?? 0n).toString(), new: newDeduction.toString() },
          },
        });
      });
    }
  }

  console.log(`=== 완료 — DEPOSIT 라인 보유 ${records.length}건 스캔 / 정정 ${fixed}건 ${APPLY ? "(적용됨)" : ""} ===`);
  if (!APPLY && fixed > 0) console.log("DRY-RUN — 반영하려면 --apply");
}

main()
  .catch((e) => {
    console.error("정정 실패:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
