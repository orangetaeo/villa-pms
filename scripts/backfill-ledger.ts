// 정산 2차 P2-3 — 복식부기 LEDGER 백필 (ADR-0018)
//
// 기존 실거래(Payment·정산 상태)를 LEDGER 분개로 멱등 생성한다.
// 실행: npx tsx scripts/backfill-ledger.ts   (먼저 prisma/migrations-manual 의 SQL 적용 필수)
//
// 범위(테오 결정 #3): 실거래만 — 데모(id "demo-" 접두) 제외.
// 멱등: post* 함수가 paymentId/settlementId+type 으로 중복을 막으므로 재실행 안전.
//   - COLLECTION: 모든 실 Payment(KRW·VND) → CASH_{C} +/ REVENUE −
//   - COST_ACCRUAL: COLLECTED·FX_ADJUSTED·PAID 정산 → COGS +/ SUPPLIER_PAYABLE −
//   - PAYOUT: PAID 정산 → SUPPLIER_PAYABLE +/ CASH_VND −
//   - FX_ADJUSTMENT: fxAdjustmentVnd 설정된 정산 → CASH_VND ±/ FX_GAIN_LOSS ∓
import { Currency, PrismaClient, SettlementStatus } from "@prisma/client";
import {
  postCollection,
  postCostAccrual,
  postFxAdjustment,
  postPayout,
} from "@/lib/ledger";

const prisma = new PrismaClient();
const CREATED_BY = "system:backfill-ledger";
const notDemo = { not: { startsWith: "demo-" } };

async function main() {
  const counts = {
    collection: 0,
    collectionSkippedCurrency: 0,
    costAccrual: 0,
    payout: 0,
    fxAdjustment: 0,
  };

  // 1) COLLECTION — 실 Payment (KRW·VND만; 그 외 통화는 현금 계정 없음 → skip 로그)
  const payments = await prisma.payment.findMany({
    where: { id: notDemo },
    select: {
      id: true,
      currency: true,
      amount: true,
      receivedAt: true,
    },
  });
  for (const p of payments) {
    if (p.currency !== Currency.KRW && p.currency !== Currency.VND) {
      counts.collectionSkippedCurrency += 1;
      console.warn(`  ! Payment ${p.id} 통화 ${p.currency} — LEDGER 미지원, skip`);
      continue;
    }
    await postCollection(prisma, {
      paymentId: p.id,
      currency: p.currency,
      amount: p.amount,
      occurredAt: p.receivedAt,
      createdBy: CREATED_BY,
    });
    counts.collection += 1;
  }

  // 2) 정산 상태별 분개 — 실거래, totalVnd>0
  const settlements = await prisma.settlement.findMany({
    where: { id: notDemo, totalVnd: { gt: 0 } },
    select: {
      id: true,
      status: true,
      totalVnd: true,
      fxAdjustmentVnd: true,
      collectedAt: true,
      fxAdjustedAt: true,
      paidAt: true,
      createdAt: true,
    },
  });
  for (const s of settlements) {
    const accrued =
      s.status === SettlementStatus.COLLECTED ||
      s.status === SettlementStatus.FX_ADJUSTED ||
      s.status === SettlementStatus.PAID;

    if (accrued) {
      await postCostAccrual(prisma, {
        settlementId: s.id,
        totalVnd: s.totalVnd,
        occurredAt: s.collectedAt ?? s.createdAt,
        createdBy: CREATED_BY,
      });
      counts.costAccrual += 1;
    }

    // 환차 — fxAdjustmentVnd 설정된 정산(0이면 분개 없음, replace)
    if (s.fxAdjustmentVnd != null) {
      const tx = await postFxAdjustment(prisma, {
        settlementId: s.id,
        fxAdjustmentVnd: s.fxAdjustmentVnd,
        occurredAt: s.fxAdjustedAt ?? s.createdAt,
        createdBy: CREATED_BY,
      });
      if (tx) counts.fxAdjustment += 1;
    }

    // PAID — COST_ACCRUAL(위에서 보장) 후 PAYOUT으로 채무 상계
    if (s.status === SettlementStatus.PAID) {
      await postPayout(prisma, {
        settlementId: s.id,
        totalVnd: s.totalVnd,
        occurredAt: s.paidAt ?? s.createdAt,
        createdBy: CREATED_BY,
      });
      counts.payout += 1;
    }
  }

  console.log("=== LEDGER 백필 완료 ===");
  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch((e) => {
    console.error("백필 실패:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
