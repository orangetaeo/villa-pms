import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const villas = await prisma.villa.count({ where: { status: "ACTIVE" } });
  const bookings = await prisma.booking.count();
  const serviceOrders = await prisma.serviceOrder.count();
  const serviceVendors = await prisma.serviceVendor.count();
  
  const totalServiceRevenue = await prisma.serviceOrder.aggregate({
    _sum: { costVnd: true },
  });
  
  const totalMinibarRevenue = await prisma.checkoutMinibarLine.aggregate({
    _sum: { costVnd: true },
  });
  
  const totalSaleVnd = await prisma.booking.aggregate({
    _sum: { totalSaleVnd: true },
    where: { status: { in: ["CHECKED_OUT", "NO_SHOW"] } },
  });
  
  const totalSaleKrw = await prisma.booking.aggregate({
    _sum: { totalSaleKrw: true },
    where: { status: { in: ["CHECKED_OUT", "NO_SHOW"] } },
  });
  
  console.log("=== Scenario A + B 최종 검증 ===");
  console.log(`✅ ACTIVE 빌라: ${villas}개`);
  console.log(`✅ 예약: ${bookings}건`);
  console.log(`✅ 예약 판매액 (VND): ${totalSaleVnd._sum.totalSaleVnd?.toLocaleString() || 0}`);
  console.log(`✅ 예약 판매액 (KRW): ${totalSaleKrw._sum.totalSaleKrw?.toLocaleString() || 0}`);
  console.log(`✅ 부가서비스: ${serviceOrders}건 (매출 ${totalServiceRevenue._sum.costVnd?.toLocaleString() || 0} VND)`);
  console.log(`✅ 거래처: ${serviceVendors}개`);
  console.log(`✅ 미니바 판매: ${totalMinibarRevenue._sum.costVnd?.toLocaleString() || 0} VND`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
