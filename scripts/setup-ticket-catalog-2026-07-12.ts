// scripts/setup-ticket-catalog-2026-07-12.ts — 티켓 카탈로그 공시가 세팅 (테오 확정 2026-07-12)
//   실행: node --env-file=.env --import tsx scripts/setup-ticket-catalog-2026-07-12.ts
//   ADR-0036 개정(variant 규칙 자동판정) 배포 직후 1회성 데이터 세팅. 멱등(nameKo upsert).
//   - 기존 품목 가격(테오 기설정)은 변경하지 않는다: 심포니쇼는 variants만 추가(700k 유지).
//   - 빈사파리·혼똔섬 케이블카는 어린이/노인 가격 미정 → 이 스크립트에서 손대지 않음(가격 확정 후 별도).
//   - 무료(<1m) variant: 테오 확정 기준표 — 0동 라인으로 인원 추적(발행 수량 비강제, ADR-0034).
import { PrismaClient, Prisma } from "@prisma/client";
import { buildCatalogI18n } from "@/lib/service-i18n";
import { writeAuditLog } from "@/lib/audit-log";

const prisma = new PrismaClient();
const VENDOR_TICKET = "cmrfrqysr0004pe0fbid2t7cw"; // 티켓업체 (기존 실벤더)

type VariantSpec = {
  key: string;
  labelKo: string;
  priceVnd: string;
  heightMaxCm?: number;
};

type ItemSpec = {
  nameKo: string;
  priceVnd: string; // base = 성인가(variant가 대체하지만 목록 표시 기준)
  descKo?: string;
  variants: VariantSpec[];
  createOnly?: boolean; // false면 기존 항목에 variants/desc만 갱신
};

// 공시가 (SunWorld Hon Thom 2026-01-01 / Sun Paradise Land 2026-03-01 보드, 테오 전달)
const ITEMS: ItemSpec[] = [
  {
    nameKo: "심포니쇼",
    priceVnd: "700000", // 기존 테오 설정가 유지 — 단일가 + 1m 미만 무료
    variants: [
      { key: "standard", labelKo: "일반 (1m 이상)", priceVnd: "700000" },
      { key: "free", labelKo: "무료 (1m 미만)", priceVnd: "0", heightMaxCm: 100 },
    ],
  },
  {
    nameKo: "키스 오브 더 씨 쇼",
    priceVnd: "1000000",
    descKo: "누 혼 꾸어 비엔 까(Kiss of the Sea) 쇼. 공연 21:00–21:30. 성인·어린이 동일가, 1m 미만 무료.",
    variants: [
      { key: "standard", labelKo: "일반 (1m 이상)", priceVnd: "1000000" },
      { key: "free", labelKo: "무료 (1m 미만)", priceVnd: "0", heightMaxCm: 100 },
    ],
  },
  {
    nameKo: "콤보 비엔 까",
    priceVnd: "1500000",
    descKo: "키스 오브 더 씨 쇼 콤보. 공연 21:00–21:30. 성인·어린이 동일가, 1m 미만 무료.",
    variants: [
      { key: "standard", labelKo: "일반 (1m 이상)", priceVnd: "1500000" },
      { key: "free", labelKo: "무료 (1m 미만)", priceVnd: "0", heightMaxCm: 100 },
    ],
  },
  {
    nameKo: "디너쇼",
    priceVnd: "1000000",
    descKo: "세트 디너 + 심포니 오브 더 씨 + 맥주 500ml. 성인·어린이 동일가, 1m 미만 무료.",
    variants: [
      { key: "standard", labelKo: "일반 (1m 이상)", priceVnd: "1000000" },
      { key: "free", labelKo: "무료 (1m 미만)", priceVnd: "0", heightMaxCm: 100 },
    ],
  },
  {
    nameKo: "콤보 나이트 파라다이스",
    priceVnd: "1650000",
    descKo: "키스 오브 더 씨 쇼 + 디너쇼. 성인·어린이 동일가, 1m 미만 무료.",
    variants: [
      { key: "standard", labelKo: "일반 (1m 이상)", priceVnd: "1650000" },
      { key: "free", labelKo: "무료 (1m 미만)", priceVnd: "0", heightMaxCm: 100 },
    ],
  },
  {
    nameKo: "콤보 선 파라다이스",
    priceVnd: "2550000",
    descKo: "케이블카 + 뷔페 + 디너쇼 + 키스 오브 더 씨 쇼.",
    variants: [
      { key: "adult", labelKo: "성인 (1.4m 이상)", priceVnd: "2550000" },
      { key: "child", labelKo: "어린이 (1m–1.4m)", priceVnd: "2250000", heightMaxCm: 140 },
      { key: "free", labelKo: "무료 (1m 미만)", priceVnd: "0", heightMaxCm: 100 },
    ],
  },
  {
    nameKo: "키스 브릿지 입장권",
    priceVnd: "100000",
    descKo:
      "탐 꽌 꺼우 혼(Kiss Bridge) 입장. 운영 07:00–19:00, 20:30–23:00. 혼똔섬/케이블카/키스 쇼/심포니 티켓 구매 시 무료입장 가능 — 해당 티켓이 있으면 별도 구매가 필요 없습니다. 1m 미만 무료.",
    variants: [
      { key: "standard", labelKo: "일반 (1m 이상)", priceVnd: "100000" },
      { key: "free", labelKo: "무료 (1m 미만)", priceVnd: "0", heightMaxCm: 100 },
    ],
  },
];

async function main() {
  const owner = await prisma.user.findFirst({ where: { role: "OWNER" }, select: { id: true } });
  if (!owner) throw new Error("OWNER 사용자 없음");

  for (const spec of ITEMS) {
    const existing = await prisma.serviceCatalogItem.findFirst({
      where: { nameKo: spec.nameKo, vendorId: VENDOR_TICKET },
      select: { id: true, priceVnd: true },
    });

    // 자동번역(best-effort — 실패 시 ko 폴백, throw 안 함)
    const i18n = await buildCatalogI18n({
      nameKo: spec.nameKo,
      descKo: spec.descKo ?? null,
      options: {
        variants: spec.variants.map((v) => ({
          key: v.key,
          labelKo: v.labelKo,
          priceVnd: v.priceVnd,
          ...(v.heightMaxCm != null ? { heightMaxCm: v.heightMaxCm } : {}),
        })),
        addons: [],
        modifiers: [],
      },
    });

    const optionsJson = i18n.options as unknown as Prisma.InputJsonValue;
    if (existing) {
      // 기존 항목: 가격(base)은 테오 기설정 유지, variants/desc/i18n만 갱신
      await prisma.serviceCatalogItem.update({
        where: { id: existing.id },
        data: {
          options: optionsJson,
          ...(spec.descKo ? { descKo: spec.descKo, descI18n: (i18n.descI18n ?? undefined) as Prisma.InputJsonValue | undefined } : {}),
          ...(i18n.nameI18n ? { nameI18n: i18n.nameI18n as unknown as Prisma.InputJsonValue } : {}),
        },
      });
      await writeAuditLog({
        db: prisma,
        userId: owner.id,
        action: "UPDATE",
        entity: "ServiceCatalogItem",
        entityId: existing.id,
        changes: { options: { new: "variants(ADR-0036 규칙) 세팅 — setup-ticket-catalog-2026-07-12" } },
      });
      console.log(`UPDATED: ${spec.nameKo} (base ${existing.priceVnd} 유지, variants ${spec.variants.length}개)`);
    } else {
      const created = await prisma.serviceCatalogItem.create({
        data: {
          type: "TICKET",
          nameKo: spec.nameKo,
          nameI18n: (i18n.nameI18n ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
          descKo: spec.descKo ?? null,
          descI18n: (i18n.descI18n ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
          priceVnd: BigInt(spec.priceVnd),
          unitLabelKo: "1장",
          vendorId: VENDOR_TICKET,
          options: optionsJson,
          audiences: ["ADMIN", "PARTNER", "GUEST"],
          active: true,
        },
        select: { id: true },
      });
      await writeAuditLog({
        db: prisma,
        userId: owner.id,
        action: "CREATE",
        entity: "ServiceCatalogItem",
        entityId: created.id,
        changes: { nameKo: { new: spec.nameKo }, priceVnd: { new: spec.priceVnd } },
      });
      console.log(`CREATED: ${spec.nameKo} (${spec.priceVnd}₫, variants ${spec.variants.length}개)`);
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
