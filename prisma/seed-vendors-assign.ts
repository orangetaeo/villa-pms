/**
 * 부가서비스 거래처(ServiceVendor) 생성 + 카탈로그 연결 (시연/테스트 DB 전용).
 *   카테고리별 현실적 업체를 만들어(demo-vnd-*) 각 카탈로그 항목의 vendorId에 연결.
 *   → 주문이 vendorId를 스냅샷하므로, 이후 부가서비스 시드 재실행 시 업체별 집계가 의미 있어진다.
 *   실행: npx tsx --env-file=.env prisma/seed-vendors-assign.ts (멱등 upsert)
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// 카탈로그 nameKo → {업체 고정id, 업체명}
const MAP: Record<string, { id: string; name: string }> = {
  "빈사파리": { id: "demo-vnd-safari", name: "빈펄 사파리 매표" },
  "혼똔섬 케이블카": { id: "demo-vnd-cablecar", name: "혼톤섬 케이블카 운영" },
  "심포니쇼": { id: "demo-vnd-show", name: "선월드 심포니쇼" },
  "Nautilus Namaste Cruise": { id: "demo-vnd-cruise", name: "노틸러스 크루즈" },
  "통돼지 BBQ": { id: "demo-vnd-bbq", name: "푸꾸옥 BBQ 케이터링" },
  "일일가이드": { id: "demo-vnd-guide", name: "푸꾸옥 한인 가이드" },
  "차량랜트": { id: "demo-vnd-car", name: "푸꾸옥 렌터카" },
  "조식 도시락": { id: "demo-vnd-breakfast", name: "데일리 조식 공급" },
  "오토바이랜트": { id: "demo-vnd-moto", name: "비치 모토 렌탈" },
  "이발소": { id: "demo-vnd-barber", name: "사오비치 바버샵" },
};

async function main() {
  const items = await prisma.serviceCatalogItem.findMany({ select: { id: true, nameKo: true, vendorId: true } });
  let made = 0, linked = 0;
  for (const it of items) {
    const m = MAP[it.nameKo];
    if (!m) continue; // 마사지·과일은 기존 업체 유지
    await prisma.serviceVendor.upsert({
      where: { id: m.id },
      update: { name: m.name, active: true, approvalStatus: "APPROVED" },
      create: { id: m.id, name: m.name, nameKo: m.name, active: true, approvalStatus: "APPROVED" },
    });
    made += 1;
    if (it.vendorId !== m.id) {
      await prisma.serviceCatalogItem.update({ where: { id: it.id }, data: { vendorId: m.id } });
      linked += 1;
    }
  }
  const vendors = await prisma.serviceVendor.count();
  console.log(`완료 — 업체 ${made} upsert · 카탈로그 연결 ${linked}건. 전체 ServiceVendor ${vendors}개`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
