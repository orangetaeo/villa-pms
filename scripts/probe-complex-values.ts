// [읽기 전용] 라이브 DB의 지역(단지) 실제 값 분포 프로브 — T-complex-area-master
// 어떤 데이터도 수정하지 않음. 정규화 매핑/초기 마스터 목록 확정용.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const villaByComplex = await prisma.villa.groupBy({
    by: ["complex"],
    _count: { _all: true },
    orderBy: { _count: { complex: "desc" } },
  });
  console.log("=== Villa.complex 분포 (총 " + villaByComplex.reduce((s, r) => s + r._count._all, 0) + "개 빌라) ===");
  for (const r of villaByComplex) {
    console.log(`  ${JSON.stringify(r.complex).padEnd(24)} : ${r._count._all}개`);
  }

  const vendorByRegion = await prisma.serviceVendorRegion.groupBy({
    by: ["region", "serviceType"],
    _count: { _all: true },
  });
  console.log("\n=== ServiceVendorRegion.region 분포 (업체 커버리지) ===");
  if (vendorByRegion.length === 0) console.log("  (없음)");
  for (const r of vendorByRegion) {
    console.log(`  ${JSON.stringify(r.region).padEnd(24)} [${r.serviceType}] : ${r._count._all}건`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
