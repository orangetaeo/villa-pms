// scripts/setup-ticket-catalog-2026-07-12b.ts — VinWonders·Safari·GrandWorld 파트너 넷가 표 반영 (테오 2026-07-12)
//   실행: node --env-file=.env --import tsx scripts/setup-ticket-catalog-2026-07-12b.ts
//   해석: LISTING=소비자 판매가(priceVnd) / DISCOUNT=파트너 넷가=매입 원가(costVnd — 게스트·벤더 비노출).
//   구분: 성인(>1.4m 기본) / 어린이(1m–1.4m, heightMaxCm=140) / 시니어(60세+, bornBeforeYear=1966) / 무료(<1m, 0동).
//   "Valid until 2026-03-31" 기한부 6종(패스트패스 3·그랜드월드 콤보 3)은 기한 경과로 생략(테오 보고).
//   멱등: nameKo 기준 upsert. 기존 3종(빈원더스·빈사파리·콤보)은 표 가격으로 variants 재구성(+원가).
import { PrismaClient, Prisma } from "@prisma/client";
import { buildCatalogI18n } from "@/lib/service-i18n";
import { writeAuditLog } from "@/lib/audit-log";

const prisma = new PrismaClient();
const VENDOR_TICKET = "cmrfrqysr0004pe0fbid2t7cw"; // 티켓업체

type Tier = { price: string; cost: string };
type ItemSpec = {
  nameKo: string;
  descKo?: string;
  adult: Tier;
  child?: Tier; // 없으면 단일가(성인=전체)
  senior?: Tier; // 없으면 시니어 구분 없음
  freeUnder1m?: boolean; // 기본 true
};

// NET PRICE 2026 FOR PARTNERS 표 (Children under 1m completely free)
const ITEMS: ItemSpec[] = [
  // ── VinWonders Phu Quoc ──
  { nameKo: "빈원더스", adult: { price: "950000", cost: "884000" }, child: { price: "710000", cost: "663200" }, senior: { price: "710000", cost: "663200" } },
  { nameKo: "빈사파리", adult: { price: "850000", cost: "792000" }, child: { price: "650000", cost: "608000" }, senior: { price: "650000", cost: "608000" } },
  {
    nameKo: "콤보(빈원더스+빈사파리)",
    adult: { price: "1500000", cost: "1390000" }, child: { price: "1100000", cost: "1022000" }, senior: { price: "1100000", cost: "1022000" },
  },
  {
    nameKo: "콤보 빈원더스+빈사파리 2일권",
    descKo: "빈원더스와 빈사파리를 2일에 걸쳐 이용하는 콤보 티켓. 데일리 투어 + 베어 뮤지엄 무료 포함.",
    adult: { price: "1700000", cost: "1574000" }, child: { price: "1300000", cost: "1206000" }, senior: { price: "1300000", cost: "1206000" },
  },
  {
    nameKo: "올인원 패키지(빈원더스+빈사파리+투어+크루즈)",
    descKo: "빈원더스 + 빈사파리 티켓에 데일리 투어, 베어 뮤지엄, 베니스 리버 크루즈, 베트남 요리 2일이 포함된 올인원 패키지.",
    adult: { price: "2000000", cost: "1850000" }, child: { price: "1500000", cost: "1390000" }, senior: { price: "1500000", cost: "1390000" },
  },
  {
    nameKo: "푸꾸옥 나이트 사파리",
    descKo: "야간에 즐기는 푸꾸옥 사파리.",
    adult: { price: "950000", cost: "884000" }, child: { price: "710000", cost: "663200" }, senior: { price: "710000", cost: "663200" },
  },
  // ── Grand World Phu Quoc ──
  {
    nameKo: "퀸테센스 오브 베트남 쇼",
    descKo: "그랜드월드 푸꾸옥의 대표 야외 공연 '퀸테센스 오브 베트남'.",
    adult: { price: "300000", cost: "260000" }, child: { price: "230000", cost: "200500" }, senior: { price: "230000", cost: "200500" },
  },
  {
    nameKo: "베어 뮤지엄 입장권",
    descKo: "그랜드월드 푸꾸옥 테디베어 뮤지엄 입장권.",
    adult: { price: "200000", cost: "175000" }, child: { price: "150000", cost: "132500" }, senior: { price: "150000", cost: "132500" },
  },
  {
    nameKo: "베니스 커낼 크루즈",
    descKo: "그랜드월드 푸꾸옥 베니스 운하 크루즈 탑승권.",
    adult: { price: "200000", cost: "175000" }, child: { price: "150000", cost: "132500" }, senior: { price: "150000", cost: "132500" },
  },
  {
    nameKo: "콤보 퀸테센스 쇼+베어 뮤지엄",
    descKo: "퀸테센스 오브 베트남 쇼 + 베어 뮤지엄 콤보 티켓.",
    adult: { price: "450000", cost: "392500" }, child: { price: "340000", cost: "299000" }, senior: { price: "340000", cost: "299000" },
  },
  {
    nameKo: "그랜드월드 데일리 투어(올인클루시브)",
    descKo: "그랜드월드 푸꾸옥 데일리 투어 패키지 — 올인클루시브. 전 연령 동일가.",
    adult: { price: "300000", cost: "290000" }, // 전 구분 동일가 → 단일가
  },
  {
    nameKo: "그랜드월드 데일리 투어(어메이징 익스피리언스)",
    descKo: "그랜드월드 푸꾸옥 데일리 투어 패키지 — 어메이징 익스피리언스. 전 연령 동일가.",
    adult: { price: "350000", cost: "290000" }, // 전 구분 동일가 → 단일가
  },
];

function buildVariants(s: ItemSpec) {
  const singlePrice = !s.child && !s.senior;
  const variants: Record<string, unknown>[] = [];
  if (singlePrice) {
    variants.push({ key: "standard", labelKo: "일반 (1m 이상)", priceVnd: s.adult.price, costVnd: s.adult.cost });
  } else {
    variants.push({ key: "adult", labelKo: "성인 (1.4m 이상)", priceVnd: s.adult.price, costVnd: s.adult.cost });
    if (s.child) variants.push({ key: "child", labelKo: "어린이 (1m–1.4m)", priceVnd: s.child.price, costVnd: s.child.cost, heightMaxCm: 140 });
    if (s.senior) variants.push({ key: "senior", labelKo: "시니어 (60세 이상)", priceVnd: s.senior.price, costVnd: s.senior.cost, bornBeforeYear: 1966 });
  }
  if (s.freeUnder1m !== false) variants.push({ key: "free", labelKo: "무료 (1m 미만)", priceVnd: "0", heightMaxCm: 100 });
  return variants;
}

async function main() {
  const owner = await prisma.user.findFirst({ where: { role: "OWNER" }, select: { id: true } });
  if (!owner) throw new Error("OWNER 사용자 없음");

  for (const spec of ITEMS) {
    const variants = buildVariants(spec);
    const i18n = await buildCatalogI18n({
      nameKo: spec.nameKo,
      descKo: spec.descKo ?? null,
      options: { variants: variants as never, addons: [], modifiers: [] },
    });
    const optionsJson = i18n.options as unknown as Prisma.InputJsonValue;
    const existing = await prisma.serviceCatalogItem.findFirst({
      where: { nameKo: spec.nameKo, vendorId: VENDOR_TICKET },
      select: { id: true },
    });
    if (existing) {
      await prisma.serviceCatalogItem.update({
        where: { id: existing.id },
        data: {
          priceVnd: BigInt(spec.adult.price), // base=성인 판매가(표시 기준)
          costVnd: BigInt(spec.adult.cost), // 참고 매입원가 — 게스트·공급자 비노출
          options: optionsJson,
          ...(spec.descKo ? { descKo: spec.descKo, descI18n: (i18n.descI18n ?? undefined) as Prisma.InputJsonValue | undefined } : {}),
        },
      });
      await writeAuditLog({
        db: prisma, userId: owner.id, action: "UPDATE", entity: "ServiceCatalogItem", entityId: existing.id,
        changes: { priceVnd: { new: spec.adult.price }, costVnd: { new: spec.adult.cost }, options: { new: "2026 파트너 넷가 표 반영(setup-2026-07-12b)" } },
      });
      console.log(`UPDATED: ${spec.nameKo} — 성인 ${spec.adult.price}/원가 ${spec.adult.cost}, variants ${variants.length}`);
    } else {
      const created = await prisma.serviceCatalogItem.create({
        data: {
          type: "TICKET",
          nameKo: spec.nameKo,
          nameI18n: (i18n.nameI18n ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
          descKo: spec.descKo ?? null,
          descI18n: (i18n.descI18n ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
          priceVnd: BigInt(spec.adult.price),
          costVnd: BigInt(spec.adult.cost),
          unitLabelKo: "1장",
          vendorId: VENDOR_TICKET,
          options: optionsJson,
          audiences: ["ADMIN", "GUEST"], // 테오 기존 티켓 품목 패턴(ADMIN·GUEST). PARTNER 개방은 테오 판단
          active: true,
        },
        select: { id: true },
      });
      await writeAuditLog({
        db: prisma, userId: owner.id, action: "CREATE", entity: "ServiceCatalogItem", entityId: created.id,
        changes: { nameKo: { new: spec.nameKo }, priceVnd: { new: spec.adult.price }, costVnd: { new: spec.adult.cost } },
      });
      console.log(`CREATED: ${spec.nameKo} — 성인 ${spec.adult.price}/원가 ${spec.adult.cost}, variants ${variants.length}`);
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
