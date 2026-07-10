import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const villas = await prisma.villa.count({ where: { status: "ACTIVE" } });
  const bookings = await prisma.booking.count();
  const bookingByStatus = await prisma.booking.groupBy({
    by: ["status"],
    _count: true,
  });
  const totalSaleVnd = await prisma.booking.aggregate({
    _sum: { totalSaleVnd: true },
    where: { status: { in: ["CHECKED_OUT", "NO_SHOW"] } },
  });
  const totalSaleKrw = await prisma.booking.aggregate({
    _sum: { totalSaleKrw: true },
    where: { status: { in: ["CHECKED_OUT", "NO_SHOW"] } },
  });
  
  console.log("=== Scenario A 검증 ===");
  console.log(`✅ ACTIVE 빌라: ${villas}개`);
  console.log(`✅ 예약 총수: ${bookings}건`);
  console.log(`✅ 상태별 분포:`, bookingByStatus);
  console.log(`✅ 판매액(VND): ${totalSaleVnd._sum.totalSaleVnd?.toLocaleString() || 0} VND`);
  console.log(`✅ 판매액(KRW): ${totalSaleKrw._sum.totalSaleKrw?.toLocaleString() || 0} KRW`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
