/**
 * 시연용 빌라 비품 시드 (수동 1회용) — 데모 공급자(u-tyy-villa-manager, seed-supplier-pilot)의
 *   모든 빌라에 KITCHEN·BATHROOM·APPLIANCE 사전 비품 + 일부 custom(직접입력) 항목을 채운다.
 *   비품 수량+직접입력(custom) 기능(docs/contracts/T-amenity-quantity-custom.md)의 시연 데이터.
 *
 * 규칙
 *  - 대상: supplierId ∈ {u-tyy-villa-manager, seed-supplier-pilot} 인 빌라 전부.
 *  - 스킵: 이미 비-MINIBAR VillaAmenity가 1행이라도 있는 빌라는 건너뜀(수동 입력 보존).
 *  - 추가만: deleteMany 절대 없음. createMany로 새 행만 삽입.
 *  - MINIBAR 카테고리 생성 안 함(회사표준 분리 — 손대지 않음).
 *  - itemKey는 lib/amenities.ts 사전 값 또는 "custom"만 사용.
 *  - 결정적 해시(villa.id) 기반 — 재실행해도 동일 결과(단, 스킵된 빌라는 계속 스킵).
 *
 * 실행(미리보기, 쓰기 0): npx tsx --env-file=.env prisma/seed-demo-amenities.ts
 * 실행(본실행):          npx tsx --env-file=.env prisma/seed-demo-amenities.ts --execute
 *   (정션 worktree에서 tsx 모듈해석 실패 시: node --env-file=.env -r ts-node/register prisma/seed-demo-amenities.ts [--execute]
 *    또는 메인 폴더에서 실행. 대상 DB = .env DATABASE_URL)
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { AMENITY_ITEMS, type AmenityCategoryKey } from "../lib/amenities";

const prisma = new PrismaClient();

const SUPPLIER_IDS = ["u-tyy-villa-manager", "seed-supplier-pilot"];
const EXECUTE = process.argv.includes("--execute");
const CHUNK = 500;

// ── 결정적 의사난수: villa.id + 키 → [0,1) (FNV-1a + 최종 믹싱). 호출 순서와 무관하게 안정적 ──
function hashUnit(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 결정적 [min,max] 정수 (villaId+key 시드) */
function detInt(villaId: string, key: string, min: number, max: number): number {
  const u = hashUnit(`${villaId}|${key}`);
  return min + Math.floor(u * (max - min + 1));
}

/** 결정적 확률 판정 (villaId+key 시드) */
function detChance(villaId: string, key: string, p: number): boolean {
  return hashUnit(`${villaId}|prob|${key}`) < p;
}

/** 1~99 clamp */
function clampQty(n: number): number {
  return Math.max(1, Math.min(99, Math.round(n)));
}

type Villa = {
  id: string;
  name: string;
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
};

type PlannedRow = {
  category: AmenityCategoryKey;
  itemKey: string;
  quantity: number;
  customLabel?: string;
  customLabelKo?: string;
};

// ── 사전 항목 검증용 집합 (사전에 없는 itemKey 주입 방지) ──
function assertDictKey(category: AmenityCategoryKey, itemKey: string): void {
  const ok = AMENITY_ITEMS[category]?.some((it) => it.itemKey === itemKey);
  if (!ok) throw new Error(`사전에 없는 itemKey: ${category}.${itemKey}`);
}

// ── 직접입력(custom) 고정 풀 (카테고리·vi·ko) ──
const CUSTOM_POOL: { category: AmenityCategoryKey; vi: string; ko: string }[] = [
  { category: "KITCHEN", vi: "Nồi chiên không dầu", ko: "에어프라이어" },
  { category: "KITCHEN", vi: "Máy xay sinh tố", ko: "믹서기" },
  { category: "KITCHEN", vi: "Lò nướng", ko: "오븐" },
  { category: "KITCHEN", vi: "Nồi lẩu điện", ko: "전기 전골냄비" },
  { category: "KITCHEN", vi: "Máy pha cà phê", ko: "커피머신" },
  { category: "BATHROOM", vi: "Áo choàng tắm", ko: "목욕 가운" },
  { category: "BATHROOM", vi: "Chậu tắm cho bé", ko: "유아 욕조" },
  { category: "BATHROOM", vi: "Cân sức khỏe", ko: "체중계" },
  { category: "APPLIANCE", vi: "Máy lọc không khí", ko: "공기청정기" },
  { category: "APPLIANCE", vi: "Máy chiếu", ko: "프로젝터" },
  { category: "APPLIANCE", vi: "Robot hút bụi", ko: "로봇청소기" },
  { category: "APPLIANCE", vi: "Quạt trần", ko: "실링팬" },
  { category: "APPLIANCE", vi: "Loa karaoke", ko: "노래방 스피커" },
];

/** 빌라 1개의 계획 행 생성 (사전 + custom). */
function planVilla(v: Villa): PlannedRow[] {
  const rows: PlannedRow[] = [];
  const g = v.maxGuests;
  const bd = v.bedrooms;
  const ba = v.bathrooms;

  const add = (category: AmenityCategoryKey, itemKey: string, quantity: number) => {
    assertDictKey(category, itemKey);
    rows.push({ category, itemKey, quantity: clampQty(quantity) });
  };
  const addIf = (
    category: AmenityCategoryKey,
    itemKey: string,
    p: number,
    quantity: number
  ) => {
    if (detChance(v.id, `${category}.${itemKey}`, p)) add(category, itemKey, quantity);
  };
  // maxGuests 근사값 (±2 변주)
  const nearGuests = (item: string) => clampQty(g + detInt(v.id, `var|${item}`, -2, 2));

  // ── KITCHEN (필수) ──
  add("KITCHEN", "riceCooker", 1);
  add("KITCHEN", "stove", 1);
  add("KITCHEN", "pan", detInt(v.id, "k|pan", 1, 2));
  add("KITCHEN", "pot", detInt(v.id, "k|pot", 1, 2));
  add("KITCHEN", "knifeBoard", 1);
  add("KITCHEN", "kettle", 1);
  add("KITCHEN", "dishSoap", 1);
  add("KITCHEN", "bottleOpener", 1);
  add("KITCHEN", "trashBin", detInt(v.id, "k|trashBin", 1, 2));
  add("KITCHEN", "dishes", nearGuests("dishes"));
  add("KITCHEN", "cutlery", nearGuests("cutlery"));
  add("KITCHEN", "glasses", nearGuests("glasses"));
  add("KITCHEN", "mug", nearGuests("mug"));
  // KITCHEN 확률 옵션
  addIf("KITCHEN", "microwave", 0.8, 1);
  addIf("KITCHEN", "spices", 0.6, 1);
  addIf("KITCHEN", "waterPurifier", 0.5, 1);
  addIf("KITCHEN", "toaster", 0.4, 1);

  // ── BATHROOM ──
  add("BATHROOM", "towelLarge", g);
  add("BATHROOM", "towelMedium", g);
  add("BATHROOM", "towelSmall", g);
  add("BATHROOM", "shampoo", ba);
  add("BATHROOM", "bodyWash", ba);
  add("BATHROOM", "soap", ba);
  add("BATHROOM", "handWash", ba);
  add("BATHROOM", "hairDryer", ba);
  add("BATHROOM", "bathMat", ba);
  add("BATHROOM", "bathTrashBin", ba);
  add("BATHROOM", "toiletPaper", ba * 2);
  add("BATHROOM", "slippers", g);
  // BATHROOM 확률
  addIf("BATHROOM", "conditioner", 0.7, ba);
  addIf("BATHROOM", "toothbrushKit", 0.8, g);

  // ── APPLIANCE ──
  add("APPLIANCE", "airConditioner", bd + 1);
  add("APPLIANCE", "tv", detInt(v.id, "a|tv", 1, 2));
  add("APPLIANCE", "fridge", 1);
  add("APPLIANCE", "wifi", 1);
  add("APPLIANCE", "waterHeater", ba);
  // APPLIANCE 확률
  addIf("APPLIANCE", "washingMachine", 0.9, 1);
  addIf("APPLIANCE", "dryingRack", 0.7, 1);
  addIf("APPLIANCE", "fan", 0.7, bd);
  addIf("APPLIANCE", "iron", 0.6, 1);
  addIf("APPLIANCE", "vacuum", 0.6, 1);
  addIf("APPLIANCE", "safeBox", 0.5, 1);
  addIf("APPLIANCE", "speaker", 0.3, 1);
  addIf("APPLIANCE", "dehumidifier", 0.2, 1);

  // ── 직접입력(custom): ~60% 빌라에 1~3개 ──
  if (detChance(v.id, "custom|include", 0.6)) {
    const count = detInt(v.id, "custom|count", 1, 3);
    // 풀을 (villaId 시드) 결정적으로 셔플 후 앞에서 count개 (라벨 유일 → 중복 없음)
    const shuffled = CUSTOM_POOL.map((entry, idx) => ({
      entry,
      k: hashUnit(`${v.id}|custom|pick|${idx}`),
    }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.entry);
    for (let i = 0; i < count; i++) {
      const c = shuffled[i];
      rows.push({
        category: c.category,
        itemKey: "custom",
        customLabel: c.vi,
        customLabelKo: c.ko,
        quantity: detInt(v.id, `custom|qty|${i}`, 1, 2),
      });
    }
  }

  return rows;
}

async function main() {
  const allVillas: Villa[] = await prisma.villa.findMany({
    where: { supplierId: { in: SUPPLIER_IDS } },
    select: { id: true, name: true, bedrooms: true, bathrooms: true, maxGuests: true },
    orderBy: { id: "asc" },
  });

  if (allVillas.length === 0) {
    console.log("대상 공급자의 빌라가 없습니다 — 종료.");
    return;
  }

  // 이미 비-MINIBAR VillaAmenity가 있는 빌라 → 스킵
  const withAmenity = await prisma.villaAmenity.findMany({
    where: {
      villaId: { in: allVillas.map((v) => v.id) },
      category: { not: "MINIBAR" },
    },
    select: { villaId: true },
    distinct: ["villaId"],
  });
  const skipSet = new Set(withAmenity.map((r) => r.villaId));
  const targets = allVillas.filter((v) => !skipSet.has(v.id));

  // ── 계획 수립 ──
  const allRows: Prisma.VillaAmenityCreateManyInput[] = [];
  const catTotals: Record<string, number> = { KITCHEN: 0, BATHROOM: 0, APPLIANCE: 0 };
  let customRows = 0;
  let villasWithCustom = 0;
  const sampleDetails: string[] = [];

  for (const v of targets) {
    const planned = planVilla(v);
    let villaCustom = 0;
    for (const p of planned) {
      catTotals[p.category] = (catTotals[p.category] ?? 0) + 1;
      if (p.itemKey === "custom") {
        customRows += 1;
        villaCustom += 1;
      }
      allRows.push({
        villaId: v.id,
        category: p.category,
        itemKey: p.itemKey,
        quantity: p.quantity,
        customLabel: p.customLabel ?? null,
        customLabelKo: p.customLabelKo ?? null,
        unitPrice: null,
        note: null,
      });
    }
    if (villaCustom > 0) villasWithCustom += 1;

    // 샘플 상세 (앞 3빌라)
    if (sampleDetails.length < 3) {
      const byCat = (cat: AmenityCategoryKey) =>
        planned
          .filter((p) => p.category === cat)
          .map((p) =>
            p.itemKey === "custom"
              ? `custom「${p.customLabel}/${p.customLabelKo}」×${p.quantity}`
              : `${p.itemKey}×${p.quantity}`
          )
          .join(", ");
      sampleDetails.push(
        `  · ${v.name} [${v.id}] (침실 ${v.bedrooms}·욕실 ${v.bathrooms}·정원 ${v.maxGuests}) — 총 ${planned.length}행\n` +
          `    KITCHEN: ${byCat("KITCHEN")}\n` +
          `    BATHROOM: ${byCat("BATHROOM")}\n` +
          `    APPLIANCE: ${byCat("APPLIANCE")}`
      );
    }
  }

  // ── 출력 ──
  console.log("=".repeat(70));
  console.log(`시연용 빌라 비품 시드 — ${EXECUTE ? "본실행(--execute)" : "DRY-RUN(쓰기 없음)"}`);
  console.log("=".repeat(70));
  console.log(`대상 공급자: ${SUPPLIER_IDS.join(", ")}`);
  console.log(`공급자 빌라 총 ${allVillas.length}개`);
  console.log(`  스킵(이미 비-MINIBAR 비품 보유): ${skipSet.size}개`);
  console.log(`  채울 대상: ${targets.length}개`);
  console.log("");
  console.log("생성 예정 행(카테고리별):");
  console.log(`  KITCHEN   : ${catTotals.KITCHEN}행`);
  console.log(`  BATHROOM  : ${catTotals.BATHROOM}행`);
  console.log(`  APPLIANCE : ${catTotals.APPLIANCE}행`);
  console.log(`  custom 소계: ${customRows}행 (위 카테고리 행에 포함) — ${villasWithCustom}개 빌라`);
  console.log(`  전체 합계 : ${allRows.length}행`);
  console.log("");
  console.log("샘플 3빌라 상세:");
  console.log(sampleDetails.join("\n"));
  console.log("");

  if (!EXECUTE) {
    console.log("DRY-RUN 종료 — 쓰기 없음. 본실행: --execute 플래그 추가.");
    return;
  }

  // ── 본실행: chunk 단위 createMany ──
  let inserted = 0;
  for (let i = 0; i < allRows.length; i += CHUNK) {
    const chunk = allRows.slice(i, i + CHUNK);
    const res = await prisma.villaAmenity.createMany({ data: chunk });
    inserted += res.count;
  }
  console.log(`본실행 완료 — VillaAmenity ${inserted}행 삽입 (대상 빌라 ${targets.length}개).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
