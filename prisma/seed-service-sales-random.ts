/**
 * 부가서비스(옵션 상품) 판매 랜덤 시드 — 마사지 외 전 활성 카탈로그 (시연/테스트 DB 전용)
 *
 *   ★ 현실적 모델: 유형별 부착률·수량 규칙(인원수 g·박수 n 비례).
 *     - 티켓(입장권): 1인 1매 → qty≈인원수, 명소 1~2개. 부착률 높음(관광객 대부분 구매).
 *     - 조식: 1인 1식 → qty≈인원×일부 박수.
 *     - 가이드/차량: 일수 비례. 오토바이: 대수. 과일/이발/BBQ: 소량.
 *   과거 CHECKED_OUT = DELIVERED(발주·정산 완료, 체크아웃월 매출). 미래 확정 = CONFIRMED(+소수 REQUESTED).
 *   변형(variant) 항목은 코스 스냅샷(가격 포함, 표시 시 라벨만 추출). 가격·원가 정합.
 *
 *   실행: npx tsx --env-file=.env prisma/seed-service-sales-random.ts
 *   멱등: id 접두 `demo-svc-` 주문을 먼저 전부 삭제 후 재생성.
 */
import { PrismaClient, Prisma, type ServiceType } from "@prisma/client";
import { parseCatalogOptions, type CatalogOptionDef } from "../lib/service-catalog";
import { priceKrwCeil } from "../lib/service-display";

const prisma = new PrismaClient();
const ID_PREFIX = "demo-svc-";
const TODAY = new Date("2026-06-26T00:00:00.000Z");
const PAST_FROM = new Date("2026-02-01T00:00:00.000Z");

function randInt(min: number, max: number): number { return min + Math.floor(Math.random() * (max - min + 1)); }
function pick<T>(a: readonly T[]): T { return a[Math.floor(Math.random() * a.length)]; }
function chance(p: number): boolean { return Math.random() < p; }
function randDateOnly(from: Date, to: Date): Date {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));
  return new Date(from.getTime() + randInt(0, days - 1) * 86400000);
}
function at(date: Date, h: number): Date { return new Date(date.getTime() + h * 3600000); }

type ItemRow = Prisma.ServiceCatalogItemGetPayload<{ include: { vendor: { select: { id: true; name: true } } } }>;

/** 유형별 부착률(과거 기준)·수량 규칙. 미래는 부착률 ×0.6. */
const RULES: Record<string, { attach: number; qty: (g: number, n: number) => number; picks?: number }> = {
  TICKET: { attach: 0.85, qty: (g) => randInt(Math.max(1, Math.round(g * 0.6)), g), picks: 1 }, // 명소별 1인1매
  BREAKFAST: { attach: 0.5, qty: (g, n) => g * randInt(1, n) }, // 인원 × 일부 박수
  FRUIT: { attach: 0.5, qty: (g) => randInt(1, Math.max(2, Math.ceil(g / 2))) }, // 바구니/도시락 소량
  BBQ: { attach: 0.35, qty: () => (chance(0.15) ? 2 : 1) }, // 파티 1회(대형은 2)
  CAR_RENTAL: { attach: 0.3, qty: (g, n) => randInt(1, Math.max(1, n - 1)) }, // 일수
  GUIDE: { attach: 0.22, qty: (g, n) => randInt(1, Math.max(1, n - 1)) }, // 일일가이드 일수
  MOTORBIKE_RENTAL: { attach: 0.4, qty: (g) => randInt(1, Math.max(1, g)) }, // 대수
  BARBER: { attach: 0.18, qty: () => randInt(1, 2) },
  MASSAGE: { attach: 0.45, qty: (g) => randInt(1, Math.max(1, Math.ceil(g / 2))) }, // 일행 일부 마사지
};

async function main() {
  const fxRow = await prisma.appSetting.findUnique({ where: { key: "FX_VND_PER_KRW" } });
  const fx = fxRow?.value ?? "18.87";

  const items = await prisma.serviceCatalogItem.findMany({
    where: { active: true },
    include: { vendor: { select: { id: true, name: true } } },
  });
  const byType = new Map<ServiceType, ItemRow[]>();
  for (const it of items) {
    const arr = byType.get(it.type) ?? [];
    arr.push(it);
    byType.set(it.type, arr);
  }

  const pastBookings = await prisma.booking.findMany({
    where: { status: "CHECKED_OUT", checkOut: { gte: PAST_FROM, lt: TODAY } },
    select: { id: true, checkIn: true, checkOut: true, guestCount: true, nights: true },
  });
  const futureBookings = await prisma.booking.findMany({
    where: { status: { in: ["CONFIRMED", "CHECKED_IN"] }, checkIn: { gte: TODAY } },
    select: { id: true, checkIn: true, checkOut: true, guestCount: true, nights: true },
  });

  const del = await prisma.serviceOrder.deleteMany({ where: { id: { startsWith: ID_PREFIX } } });

  let seq = 1;
  const created: Prisma.ServiceOrderCreateManyInput[] = [];

  function makeOrder(
    bk: { id: string; checkIn: Date; checkOut: Date },
    item: ItemRow,
    qty: number,
    isPast: boolean
  ) {
    const variants = (parseCatalogOptions(item.options).variants ?? []).filter(
      (v): v is CatalogOptionDef & { priceVnd: string } => !!v.priceVnd
    );
    let unitVnd: bigint, unitCostVnd: bigint;
    let snapshot: Prisma.InputJsonValue | undefined;
    if (variants.length > 0) {
      const v = pick(variants);
      unitVnd = BigInt(v.priceVnd);
      unitCostVnd = v.costVnd ? BigInt(v.costVnd) : 0n;
      snapshot = [{ group: "variant", key: v.key, labelKo: v.labelKo, labelI18n: v.labelI18n ?? null, priceVnd: v.priceVnd }] as unknown as Prisma.InputJsonValue;
    } else {
      unitVnd = item.priceVnd ?? 0n;
      unitCostVnd = item.costVnd ?? 0n;
    }
    const q = Math.max(1, qty);
    const totalVnd = unitVnd * BigInt(q);
    const totalCostVnd = unitCostVnd * BigInt(q);
    const priceKrw = priceKrwCeil(totalVnd, fx);
    const serviceDate = randDateOnly(bk.checkIn, bk.checkOut);

    const auds = Array.isArray(item.audiences) ? (item.audiences as string[]) : ["ADMIN"];
    const via = auds.includes("GUEST")
      ? pick(["GUEST", "GUEST", "ADMIN"] as const)
      : auds.includes("PARTNER")
      ? pick(["PARTNER", "ADMIN"] as const)
      : "ADMIN";

    const hasVendor = !!item.vendorId;
    let status: "REQUESTED" | "CONFIRMED" | "DELIVERED";
    let vendorStatus: "PENDING_VENDOR" | "VENDOR_ACCEPTED" | null = null;
    let poSentAt: Date | null = null;
    let vendorRespondedAt: Date | null = null;
    let vendorSettledAt: Date | null = null;
    let vendorSettleMethod: "CASH" | "BANK_TRANSFER" | null = null;

    if (isPast) {
      status = "DELIVERED";
      if (hasVendor) {
        vendorStatus = "VENDOR_ACCEPTED";
        poSentAt = at(new Date(serviceDate.getTime() - 86400000), 9);
        vendorRespondedAt = at(new Date(serviceDate.getTime() - 86400000), 11);
        vendorSettledAt = at(serviceDate, 22);
        vendorSettleMethod = pick(["CASH", "BANK_TRANSFER"] as const);
      }
    } else {
      const requested = chance(0.3) && hasVendor;
      status = requested ? "REQUESTED" : "CONFIRMED";
      if (hasVendor) {
        vendorStatus = requested ? "PENDING_VENDOR" : "VENDOR_ACCEPTED";
        poSentAt = at(TODAY, 9);
        if (!requested) vendorRespondedAt = at(TODAY, 12);
      }
    }

    created.push({
      id: `${ID_PREFIX}${seq++}`,
      bookingId: bk.id,
      type: item.type,
      status,
      serviceDate,
      serviceTime: pick(["09:00", "10:00", "14:00", "16:00", "18:00", "19:00"]),
      costVnd: totalCostVnd,
      priceKrw,
      priceVnd: totalVnd,
      catalogItemId: item.id,
      quantity: q,
      ...(snapshot ? { selectedOptions: snapshot } : {}),
      requestedVia: via,
      vendorName: item.vendor?.name ?? null,
      vendorId: item.vendorId,
      vendorStatus,
      poSentAt,
      vendorRespondedAt,
      vendorSettledAt,
      vendorSettleMethod,
      createdAt: isPast ? at(new Date(serviceDate.getTime() - 2 * 86400000), randInt(8, 20)) : at(TODAY, randInt(8, 20)),
    });
  }

  function fillBooking(bk: { id: string; checkIn: Date; checkOut: Date; guestCount: number; nights: number }, isPast: boolean) {
    const g = Math.max(1, bk.guestCount);
    const n = Math.max(1, bk.nights);
    const attachMul = isPast ? 1 : 0.6;
    for (const [type, rule] of Object.entries(RULES)) {
      const pool = byType.get(type as ServiceType);
      if (!pool || pool.length === 0) continue;
      if (!chance(rule.attach * attachMul)) continue;
      // 티켓 등 picks>1이면 서로 다른 명소 여러 개
      const numItems = type === "TICKET" ? (chance(0.4) ? 2 : 1) : 1;
      const chosen = new Set<string>();
      for (let k = 0; k < numItems; k++) {
        const candidates = pool.filter((p) => !chosen.has(p.id));
        if (candidates.length === 0) break;
        const item = pick(candidates);
        chosen.add(item.id);
        makeOrder(bk, item, rule.qty(g, n), isPast);
      }
    }
  }

  for (const bk of pastBookings) fillBooking(bk, true);
  for (const bk of futureBookings) fillBooking(bk, false);

  // BigInt 직렬화 위해 createMany 분할(대량)
  await prisma.serviceOrder.createMany({ data: created });

  // 유형별 건수·매출(VND) 분포
  const dist = new Map<string, { cnt: number; vnd: bigint; qty: number }>();
  for (const o of created) {
    const d = dist.get(o.type) ?? { cnt: 0, vnd: 0n, qty: 0 };
    d.cnt += 1; d.vnd += (o.priceVnd as bigint) ?? 0n; d.qty += o.quantity ?? 0;
    dist.set(o.type, d);
  }
  console.log(`완료 — 기존 ${del.count}건 삭제 후 ${created.length}건 생성 (과거숙박 ${pastBookings.length}·미래숙박 ${futureBookings.length}, fx=${fx})`);
  for (const [t, d] of [...dist.entries()].sort((a, b) => Number(b[1].vnd - a[1].vnd))) {
    console.log(`  ${t}: ${d.cnt}건 수량합 ${d.qty} 매출 ${Math.round(Number(d.vnd) / 1e6)}M`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
