/**
 * 판매가 0/누락 예약 정상화 (시연/테스트 DB 전용) — 원가만 있고 판매가 없는 예약에 일반 판매가 부여.
 *   대상: supplierCostVnd>0 이면서 totalSaleVnd·totalSaleKrw 둘 다 없음(null/0).
 *   보정: 판매가 = 원가×1.2(마진 20%, 1만 단위). 통화별 컬럼만 채움(ADR-0003).
 *     - VND 채널: totalSaleVnd=판매가
 *     - KRW 채널: totalSaleKrw=판매가÷환율 올림(1천), fxVndPerKrw 보장
 *   멱등: 이미 판매가 있는 예약은 건드리지 않음. 기존 정산/스냅샷엔 영향 없음(데모 DB).
 *   실행: npx tsx --env-file=.env prisma/fix-zero-sale-bookings.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const fxRow = await prisma.appSetting.findUnique({ where: { key: "FX_VND_PER_KRW" } });
  const fx = Number(fxRow?.value ?? "18.87");
  const round = (v: number, unit: number) => Math.round(v / unit) * unit;

  const all = await prisma.booking.findMany({
    select: { id: true, saleCurrency: true, totalSaleVnd: true, totalSaleKrw: true, supplierCostVnd: true, fxVndPerKrw: true, status: true },
  });
  const targets = all.filter(
    (b) => b.supplierCostVnd > 0n && (b.totalSaleVnd == null || b.totalSaleVnd === 0n) && (b.totalSaleKrw == null || b.totalSaleKrw === 0)
  );

  let vndFix = 0, krwFix = 0;
  for (const b of targets) {
    const saleVnd = BigInt(round(Number(b.supplierCostVnd) * 1.2, 10_000)); // 마진 20%
    if (b.saleCurrency === "KRW") {
      const saleKrw = Math.ceil(Number(saleVnd) / fx / 1000) * 1000;
      await prisma.booking.update({
        where: { id: b.id },
        data: { totalSaleKrw: saleKrw, totalSaleVnd: null, fxVndPerKrw: b.fxVndPerKrw ?? new Prisma.Decimal(fx) },
      });
      krwFix++;
    } else {
      await prisma.booking.update({
        where: { id: b.id },
        data: { totalSaleVnd: saleVnd, totalSaleKrw: null },
      });
      vndFix++;
    }
  }
  // 상태 분포
  const byStatus = new Map<string, number>();
  for (const b of targets) byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + 1);
  console.log(`완료 — 판매가 0 예약 ${targets.length}건 정상화 (VND채널 ${vndFix} · KRW채널 ${krwFix}, fx=${fx})`);
  console.log(`  상태분포: ${[...byStatus.entries()].map(([k, v]) => `${k}:${v}`).join(" ")}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
