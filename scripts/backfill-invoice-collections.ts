// ADR-0027 — 파트너 청구서 수납 LEDGER COLLECTION 백필
//
// 배경: 코드 변경(recordInvoicePayment) 이전에 청구서로 수납된 금액(PartnerInvoice.paidVnd)은
// Payment row 없이 누적만 됐기 때문에 복식부기 LEDGER에서 누락돼 있다. 이 스크립트는 그
// 누락분을 합성 Payment + COLLECTION 분개로 멱등 생성한다.
//
// 실행: npx tsx scripts/backfill-invoice-collections.ts
//   (먼저 Payment.bookingId nullable ALTER 적용 필수 — prisma/migrations-manual)
//
// 범위(테오 결정 D2 / ADR-0018 #3): 실거래만 — 데모(id "demo-" 접두) 제외.
// 이중계상 방지: 청구서별 paidVnd 중 "이미 Payment row로 적재된 금액"을 빼고 부족분만 적재.
//   배포 후 신규 수납은 recordInvoicePayment가 인라인으로 Payment+COLLECTION을 만들므로
//   그만큼은 realLedgered로 잡혀 중복되지 않는다.
// 멱등: 합성 Payment id = `bf-invpay-{invoiceId}` 결정형. 이미 있으면 skip(재실행 안전).
import { Currency, PaymentMethod, PaymentPurpose, PrismaClient } from "@prisma/client";
import { postCollection } from "@/lib/ledger";

const prisma = new PrismaClient();
const CREATED_BY = "system:backfill-invoice-collections";
const notDemo = { not: { startsWith: "demo-" } };

async function main() {
  const counts = { backfilled: 0, skippedExisting: 0, skippedNothingMissing: 0 };

  const invoices = await prisma.partnerInvoice.findMany({
    where: { id: notDemo, partnerId: notDemo, paidVnd: { gt: 0 } },
    select: { id: true, partnerId: true, paidVnd: true, paidAt: true, issuedAt: true, createdAt: true },
  });

  for (const inv of invoices) {
    const syntheticId = `bf-invpay-${inv.id}`;
    const existing = await prisma.payment.findUnique({ where: { id: syntheticId } });
    if (existing) {
      counts.skippedExisting += 1;
      continue;
    }

    // 이미 Payment row로 적재된 금액(신규 코드가 만든 실수납 이벤트) 합계
    const realLedgered = await prisma.payment.aggregate({
      where: { invoiceId: inv.id },
      _sum: { amount: true },
    });
    const missing = inv.paidVnd - (realLedgered._sum.amount ?? 0n);
    if (missing <= 0n) {
      counts.skippedNothingMissing += 1;
      continue;
    }

    const occurredAt = inv.paidAt ?? inv.issuedAt ?? inv.createdAt;
    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          id: syntheticId,
          currency: Currency.VND,
          amount: missing,
          method: PaymentMethod.VN_BANK_TRANSFER,
          vndEquivalent: missing,
          receivedAt: occurredAt,
          purpose: PaymentPurpose.BALANCE,
          partnerId: inv.partnerId,
          invoiceId: inv.id,
          note: "ADR-0027 백필(청구서 수납 LEDGER 소급)",
        },
      });
      await postCollection(tx, {
        paymentId: syntheticId,
        currency: Currency.VND,
        amount: missing,
        occurredAt,
        createdBy: CREATED_BY,
        memo: `청구서 ${inv.id} 수납 백필`,
      });
    });
    counts.backfilled += 1;
  }

  console.log("=== 청구서 수납 COLLECTION 백필 완료 ===");
  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch((e) => {
    console.error("백필 실패:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
