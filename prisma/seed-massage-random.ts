/**
 * 마사지(MASSAGE) 부가서비스 판매 랜덤 시드 (수동 1회용, 시연/테스트 DB 전용)
 *
 *   ① 과거(이번달=2026-06 체크아웃 예약)에 DELIVERED 마사지 주문 수십개 — 통계 매출 인식 = booking.checkOut.
 *   ② 미래 예약(checkIn ≥ 오늘)에 CONFIRMED·REQUESTED 마사지 주문 — 예정된 부가서비스.
 *
 *   실행: npx tsx --env-file=.env prisma/seed-massage-random.ts
 *
 *   ⚠️ 대상 DB = .env DATABASE_URL (시연용 Neon — 실거래 아님).
 *   멱등: id 접두 `demo-massage-` 주문을 먼저 전부 삭제 후 재생성 → 재실행해도 중복 없음·정리 쉬움.
 *
 *   필드 의미는 운영자 생성 라우트(app/api/bookings/[id]/service-orders)와 동일하게 맞춤:
 *     priceVnd = 단가(variant)×수량 합계, priceKrw = priceKrwCeil(priceVnd, fx), costVnd = 원가×수량 합계.
 *     selectedOptions = variant 스냅샷, vendorId/vendorName = 카탈로그 원천 공급자(ADR-0023).
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { priceKrwCeil } from "../lib/service-display";
import {
  parseCatalogOptions,
  type CatalogOptionDef,
} from "../lib/service-catalog";

const prisma = new PrismaClient();
const ID_PREFIX = "demo-massage-";

const NOW = new Date("2026-06-26T00:00:00.000Z");
const JUNE_FROM = new Date("2026-06-01T00:00:00.000Z");
const JUNE_TO = new Date("2026-07-01T00:00:00.000Z");

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
/** [from, to) 안의 UTC date-only 균등 랜덤 (둘 다 자정 UTC) */
function randDateOnly(from: Date, to: Date): Date {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));
  const offset = randInt(0, days - 1);
  return new Date(from.getTime() + offset * 86400000);
}
/** date-only(UTC 자정)에 시·분을 더한 타임스탬프 */
function at(date: Date, hours: number, minutes = 0): Date {
  return new Date(date.getTime() + hours * 3600000 + minutes * 60000);
}
function clamp(d: Date, lo: Date, hi: Date): Date {
  return new Date(Math.min(Math.max(d.getTime(), lo.getTime()), hi.getTime()));
}

async function main() {
  const item = await prisma.serviceCatalogItem.findFirst({
    where: { type: "MASSAGE", active: true },
    include: { vendor: { select: { id: true, name: true } } },
  });
  if (!item) throw new Error("활성 MASSAGE 카탈로그 항목이 없습니다 — 먼저 카탈로그 등록 필요");

  const variants = (parseCatalogOptions(item.options).variants ?? []).filter(
    (v): v is CatalogOptionDef & { priceVnd: string } => !!v.priceVnd
  );
  if (variants.length === 0) throw new Error("MASSAGE variant 옵션이 없습니다");

  const fxRow = await prisma.appSetting.findUnique({ where: { key: "FX_VND_PER_KRW" } });
  const fx = fxRow?.value ?? "18.87";

  const vendorId = item.vendorId;
  const vendorName = item.vendor?.name ?? null;
  const catalogItemId = item.id; // 클로저 내 null 협소화 유지용

  // 기존 데모 마사지 주문 정리(멱등)
  const del = await prisma.serviceOrder.deleteMany({ where: { id: { startsWith: ID_PREFIX } } });

  // 인기 가중치: 저렴한 옵션이 더 자주 팔리도록 앞쪽 variant에 가중
  const weighted: CatalogOptionDef[] = [];
  variants.forEach((v, i) => {
    const w = Math.max(1, variants.length - i); // 앞쪽일수록 큰 가중
    for (let k = 0; k < w; k++) weighted.push(v);
  });

  /** 주문 1건 data 생성 — group 옵션(variant) 1택 스냅샷 + 가격 재계산 */
  function buildOrder(opts: {
    seq: number;
    bookingId: string;
    stayFrom: Date;
    stayTo: Date;
    delivered: boolean;
    requested?: boolean; // 미래 일부: 아직 미확정(REQUESTED)
  }): Prisma.ServiceOrderCreateInput {
    const v = pick(weighted);
    const qty = randInt(1, 3);
    const unitVnd = BigInt(v.priceVnd!);
    const unitCostVnd = v.costVnd ? BigInt(v.costVnd) : 0n;
    const totalVnd = unitVnd * BigInt(qty);
    const totalCostVnd = unitCostVnd * BigInt(qty);
    const priceKrw = priceKrwCeil(totalVnd, fx);

    const serviceDate = randDateOnly(opts.stayFrom, opts.stayTo);
    const snapshot = [
      {
        group: "variant",
        key: v.key,
        labelKo: v.labelKo,
        labelI18n: v.labelI18n ?? null,
        priceVnd: v.priceVnd ?? null,
      },
    ];

    const requestedVia = pick(["GUEST", "GUEST", "ADMIN"] as const);
    const serviceTime = pick(["10:00", "14:00", "15:30", "16:00", "18:00", "19:00", "20:00"]);

    let status: "REQUESTED" | "CONFIRMED" | "DELIVERED";
    let vendorStatus: "PENDING_VENDOR" | "VENDOR_ACCEPTED" | null;
    let poSentAt: Date | null = null;
    let vendorRespondedAt: Date | null = null;
    let vendorSettledAt: Date | null = null;
    let vendorSettleMethod: "CASH" | "BANK_TRANSFER" | null = null;
    let costVnd = 0n; // 미확정 단계는 0 placeholder (라우트와 동일)

    if (opts.delivered) {
      status = "DELIVERED";
      vendorStatus = "VENDOR_ACCEPTED";
      poSentAt = at(new Date(serviceDate.getTime() - 86400000), 9);
      vendorRespondedAt = at(new Date(serviceDate.getTime() - 86400000), 11);
      vendorSettledAt = at(serviceDate, 22);
      vendorSettleMethod = pick(["CASH", "BANK_TRANSFER"] as const);
      costVnd = totalCostVnd; // 확정·정산 완료 → 실원가 반영(마진 집계)
    } else if (opts.requested) {
      status = "REQUESTED";
      vendorStatus = "PENDING_VENDOR";
      poSentAt = at(NOW, 9);
      costVnd = totalCostVnd; // 발주 시 카탈로그 원가 스냅샷 → 공급자가 지급 예정액 확인 가능
    } else {
      status = "CONFIRMED";
      vendorStatus = "VENDOR_ACCEPTED";
      poSentAt = at(NOW, 9);
      vendorRespondedAt = at(NOW, 12);
      costVnd = totalCostVnd; // 확정 시 원가 입력
    }

    const createdAt = opts.delivered
      ? at(new Date(serviceDate.getTime() - 2 * 86400000), randInt(8, 20))
      : at(NOW, randInt(8, 20));

    return {
      id: `${ID_PREFIX}${opts.seq}`,
      booking: { connect: { id: opts.bookingId } },
      type: "MASSAGE",
      status,
      serviceDate,
      serviceTime,
      costVnd,
      priceKrw,
      priceVnd: totalVnd,
      catalogItemId,
      quantity: qty,
      selectedOptions: snapshot as unknown as Prisma.InputJsonValue,
      requestedVia,
      vendorName,
      ...(vendorId ? { vendor: { connect: { id: vendorId } } } : {}),
      vendorStatus,
      poSentAt,
      vendorRespondedAt,
      vendorSettledAt,
      vendorSettleMethod,
      createdAt,
    };
  }

  // ── ① 과거: 6월 체크아웃 예약 → DELIVERED 마사지 (수십개) ──────────────
  const juneBookings = await prisma.booking.findMany({
    where: {
      checkOut: { gte: JUNE_FROM, lt: JUNE_TO },
      status: { in: ["CHECKED_OUT", "CHECKED_IN", "CONFIRMED"] },
    },
    select: { id: true, checkIn: true, checkOut: true },
    orderBy: { checkOut: "asc" },
  });

  let seq = 1;
  const orders: Prisma.ServiceOrderCreateInput[] = [];
  for (const b of juneBookings) {
    // serviceDate 범위는 투숙기간 ∩ 6월 (체크아웃 당일은 제외 위해 [checkIn, checkOut))
    const from = clamp(b.checkIn, JUNE_FROM, JUNE_TO);
    const to = clamp(b.checkOut, JUNE_FROM, JUNE_TO);
    const stayTo = to.getTime() > from.getTime() ? to : new Date(from.getTime() + 86400000);
    // 예약마다 1건, 30%는 2건째 추가 → ~45건
    const n = Math.random() < 0.3 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      orders.push(buildOrder({ seq: seq++, bookingId: b.id, stayFrom: from, stayTo: stayTo, delivered: true }));
    }
  }
  const pastCount = orders.length;

  // ── ② 미래: 확정 예약(checkIn ≥ 오늘, HOLD 제외) → CONFIRMED·REQUESTED ──
  const futureBookings = await prisma.booking.findMany({
    where: {
      checkIn: { gte: NOW },
      status: { in: ["CONFIRMED", "CHECKED_IN"] },
    },
    select: { id: true, checkIn: true, checkOut: true },
    orderBy: { checkIn: "asc" },
  });
  for (const b of futureBookings) {
    // 일부 예약은 마사지 미예약(건너뜀) — 모든 예약에 다 넣지 않음
    if (Math.random() < 0.2) continue;
    const requested = Math.random() < 0.3; // 30%는 아직 발주 대기(REQUESTED)
    orders.push(
      buildOrder({
        seq: seq++,
        bookingId: b.id,
        stayFrom: b.checkIn,
        stayTo: b.checkOut,
        delivered: false,
        requested,
      })
    );
  }
  const futureCount = orders.length - pastCount;

  // 일괄 생성
  for (const data of orders) {
    await prisma.serviceOrder.create({ data });
  }

  console.log(
    `완료 — 기존 데모 마사지 ${del.count}건 삭제 후 재생성: ` +
      `과거(6월 체크아웃) DELIVERED ${pastCount}건 · 미래 예약 ${futureCount}건 = 총 ${orders.length}건. ` +
      `(공급처=${vendorName ?? "직접"}, fx=${fx})`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
