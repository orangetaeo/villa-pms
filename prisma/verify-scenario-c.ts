import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const villas = await prisma.villa.count({ where: { status: "ACTIVE" } });
  const bookings = await prisma.booking.count();
  const usdBookings = await prisma.booking.count({ where: { totalSaleUsd: { gt: 0 } } });
  const serviceOrders = await prisma.serviceOrder.count();
  const serviceVendors = await prisma.serviceVendor.count();
  
  const totalSaleVnd = await prisma.booking.aggregate({
    _sum: { totalSaleVnd: true },
    where: { status: { in: ["CHECKED_OUT", "NO_SHOW"] } },
  });
  
  const totalSaleKrw = await prisma.booking.aggregate({
    _sum: { totalSaleKrw: true },
    where: { status: { in: ["CHECKED_OUT", "NO_SHOW"] } },
  });
  
  const totalSaleUsd = await prisma.booking.aggregate({
    _sum: { totalSaleUsd: true },
    where: { totalSaleUsd: { gt: 0 } },
  });
  
  const totalServiceRevenue = await prisma.serviceOrder.aggregate({
    _sum: { costVnd: true },
  });
  
  const totalMinibarRevenue = await prisma.checkoutMinibarLine.aggregate({
    _sum: { costVnd: true },
  });
  
  const payments = await prisma.payment.count();
  
  console.log("=== Scenario A + B + C 최종 검증 ===");
  console.log(`✅ ACTIVE 빌라: ${villas}개`);
  console.log(`✅ 총 예약: ${bookings}건 (USD ${usdBookings}건)`);
  console.log(`✅ 예약 판매액 (VND): ${totalSaleVnd._sum.totalSaleVnd?.toLocaleString() || 0} VND`);
  console.log(`✅ 예약 판매액 (KRW): ${totalSaleKrw._sum.totalSaleKrw?.toLocaleString() || 0} KRW`);
  console.log(`✅ 예약 판매액 (USD): $${totalSaleUsd._sum.totalSaleUsd?.toLocaleString() || 0}`);
  console.log(`✅ 부가서비스: ${serviceOrders}건 (매출 ${totalServiceRevenue._sum.costVnd?.toLocaleString() || 0} VND)`);
  console.log(`✅ 미니바 판매: ${totalMinibarRevenue._sum.costVnd?.toLocaleString() || 0} VND`);
  console.log(`✅ 거래처: ${serviceVendors}개`);
  console.log(`✅ 결제 기록: ${payments}건`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
