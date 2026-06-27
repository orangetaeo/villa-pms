/**
 * USD 결제 LEDGER 백필 (수동 1회용) — CASH_USD 도입 전 생성된 USD Payment를 COLLECTION 분개로 적재.
 *   분개: CASH_USD +amount / REVENUE −amount (USD 통화, 합 0). lib/ledger buildCollectionLines와 동형.
 *   멱등: paymentId로 기존 LedgerTransaction 있으면 건너뜀.
 *   실행: node --env-file=.env prisma/backfill-usd-ledger.mjs
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const CREATED_BY = "seed-admin-theo"; // 시스템 백필 주체
async function main() {
  const usd = await prisma.payment.findMany({ where: { currency: "USD" }, select: { id: true, amount: true, receivedAt: true } });
  let posted = 0, skipped = 0;
  for (const p of usd) {
    const existing = await prisma.ledgerTransaction.findUnique({ where: { paymentId: p.id } });
    if (existing) { skipped++; continue; }
    await prisma.ledgerTransaction.create({
      data: {
        type: "COLLECTION", paymentId: p.id, occurredAt: p.receivedAt, createdBy: CREATED_BY,
        memo: "USD 수납 LEDGER 백필(CASH_USD 도입)",
        lines: { create: [
          { account: "CASH_USD", currency: "USD", amount: p.amount },
          { account: "REVENUE",  currency: "USD", amount: -p.amount },
        ] },
      },
    });
    posted++;
  }
  console.log(`USD 결제 ${usd.length}건 중 적재 ${posted} · 기존스킵 ${skipped}`);
  // 검증: USD 통화 LEDGER 합 = 0 (균형), CASH_USD 잔액
  const bal = await prisma.$queryRawUnsafe(`SELECT account, currency, SUM(amount)::text total FROM "LedgerLine" WHERE currency='USD' GROUP BY account,currency ORDER BY account`);
  console.log("USD LedgerLine 잔액:", JSON.stringify(bal,null,2));
  const sum = await prisma.$queryRawUnsafe(`SELECT currency, SUM(amount)::text total FROM "LedgerLine" GROUP BY currency ORDER BY currency`);
  console.log("통화별 전체 합(모두 0이어야 균형):", JSON.stringify(sum,null,2));
}
main().then(()=>prisma.$disconnect()).catch(async e=>{console.error(e);await prisma.$disconnect();process.exit(1);});
