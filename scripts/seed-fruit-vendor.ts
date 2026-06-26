/**
 * ADR-0023 S1 — 과일 부가서비스 시드 (멱등)
 *
 * 원천 공급자(ServiceVendor) 1건 + 과일 카탈로그(ServiceCatalogItem) 2건을 적재한다.
 *   - 과일 바구니: audiences=["ADMIN","PARTNER"]  (게스트 비노출)
 *   - 과일 도시락: audiences=["ADMIN","PARTNER","GUEST"]
 * type=FRUIT, vendorId=위 공급자, priceVnd만(원가 costVnd는 시드 대상 아님 — 마진 비공개).
 *
 * 실행:   npx tsx scripts/seed-fruit-vendor.ts
 * 멱등성: 공급자는 name으로, 카탈로그는 nameKo로 findFirst → 없으면 create(두 번 실행해도 행 수 불변).
 * 적재:   프로덕션 DB 적재는 DATABASE_URL 확인 후 수동 실행(재실행 안전).
 *
 * 자동번역(buildCatalogI18n)은 best-effort — GEMINI 키 없으면 nameKo만으로 저장(실패해도 시드 진행).
 */
import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { parseAudiences } from "../lib/service-catalog";

const prisma = new PrismaClient();

const VENDOR_NAME = "푸꾸옥 과일 공급처";

interface FruitItem {
  nameKo: string;
  priceVnd: bigint;
  unitLabelKo: string;
  audiences: string[];
}

const FRUIT_ITEMS: FruitItem[] = [
  { nameKo: "과일 바구니", priceVnd: 300000n, unitLabelKo: "1개", audiences: ["ADMIN", "PARTNER"] },
  { nameKo: "과일 도시락", priceVnd: 150000n, unitLabelKo: "1개", audiences: ["ADMIN", "PARTNER", "GUEST"] },
];

/** best-effort 자동번역 — 실패 시 null(시드 진행). 동적 import로 GEMINI 미설정 환경에서도 모듈 로드 안전. */
async function tryBuildI18n(nameKo: string): Promise<Prisma.InputJsonValue | undefined> {
  try {
    const { buildCatalogI18n } = await import("../lib/service-i18n");
    const i18n = await buildCatalogI18n({ nameKo });
    return i18n.nameI18n ? (i18n.nameI18n as unknown as Prisma.InputJsonValue) : undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  // ── 공급자 upsert (name 기준) ──
  let vendor = await prisma.serviceVendor.findFirst({ where: { name: VENDOR_NAME } });
  if (!vendor) {
    vendor = await prisma.serviceVendor.create({
      data: { name: VENDOR_NAME, nameKo: VENDOR_NAME, active: true },
    });
    console.log(`[+] ServiceVendor 생성: ${vendor.id} (${VENDOR_NAME})`);
  } else {
    console.log(`[=] ServiceVendor 존재: ${vendor.id} (${VENDOR_NAME})`);
  }

  // ── 카탈로그 2건 upsert (nameKo 기준) ──
  const createdIds: string[] = [];
  for (const item of FRUIT_ITEMS) {
    const existing = await prisma.serviceCatalogItem.findFirst({ where: { nameKo: item.nameKo } });
    if (existing) {
      console.log(`[=] ServiceCatalogItem 존재: ${existing.id} (${item.nameKo})`);
      createdIds.push(existing.id);
      continue;
    }
    const nameI18n = await tryBuildI18n(item.nameKo);
    const audiences = parseAudiences(item.audiences); // 항상 ADMIN 포함 정규화
    const created = await prisma.serviceCatalogItem.create({
      data: {
        type: "FRUIT",
        nameKo: item.nameKo,
        nameI18n,
        unitLabelKo: item.unitLabelKo,
        priceVnd: item.priceVnd,
        vendorId: vendor.id,
        audiences: audiences as unknown as Prisma.InputJsonValue,
        // ★ 비활성 시드 — 배포된 prod의 게스트 /g 로더에 audience 필터(이 브랜치)가 배포되기 전엔
        //   active 항목이 게스트에 노출된다(과일 바구니=PARTNER 전용 누수). 기능 전체(S2~S4) 배포 후 활성화.
        active: false,
      },
    });
    console.log(`[+] ServiceCatalogItem 생성: ${created.id} (${item.nameKo}, audiences=${JSON.stringify(audiences)})`);
    createdIds.push(created.id);
  }

  console.log("\n=== 시드 완료 ===");
  console.log(`vendorId: ${vendor.id}`);
  console.log(`catalogIds: ${createdIds.join(", ")}`);
}

main()
  .catch((e) => {
    console.error("[!] 시드 실패:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
