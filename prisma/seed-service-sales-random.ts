/**
 * 부가서비스 판매 랜덤 샘플 시드 — 과거 날짜(최근 ~6개월)에 분산된 예약 + ServiceOrder 생성.
 *   부가서비스 통계는 ServiceOrder(status CONFIRMED·DELIVERED)를 booking.checkOut 기준으로 집계
 *   (매출 KRW/VND 분리 ADR-0003, 마진=VND 라인 priceVnd−costVnd). 카탈로그 실품목 가격 스냅샷 사용.
 *
 * 실행: npx tsx --env-file=.env prisma/seed-service-sales-random.ts
 *
 * 멱등: id 접두 `demo-sv-` → 재실행 시 기존 분 삭제 후 재생성.
 * ⚠️ 대상 DB = .env DATABASE_URL(프로덕션). 미니바 시드(demo-mb-)와 독립.
 */
import { PrismaClient, BookingChannel, ServiceOrderStatus } from "@prisma/client";

const prisma = new PrismaClient();

const NUM_BOOKINGS = 35;
const SPREAD_DAYS = 180;
const TODAY = new Date("2026-06-26T00:00:00.000Z");
const FX_VND_PER_KRW = 18.5; // 여행사 KRW 환산용(근사)

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}
function daysAgoUtc(n: number): Date {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

const CHANNELS: BookingChannel[] = ["TRAVEL_AGENCY", "LAND_AGENCY", "DIRECT"];
const STATUSES: ServiceOrderStatus[] = ["CONFIRMED", "DELIVERED"]; // 통계 산입 대상만

async function main() {
  const [actor, villas, catalog] = await Promise.all([
    prisma.user.findFirst({
      where: { role: { in: ["ADMIN", "OWNER", "MANAGER", "STAFF"] } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.villa.findMany({ where: { status: "ACTIVE" }, select: { id: true } }),
    prisma.serviceCatalogItem.findMany({
      where: { active: true, priceVnd: { not: null } },
      select: { id: true, type: true, nameKo: true, priceVnd: true, costVnd: true },
    }),
  ]);
  if (!actor) throw new Error("운영자 사용자 없음");
  if (villas.length === 0 || catalog.length === 0) {
    console.log(`빌라 ${villas.length} · 카탈로그 ${catalog.length} — 대상 없음`);
    return;
  }

  // ── purge: 기존 demo-sv- 분 제거(주문 먼저, 그 다음 예약) ──
  const old = await prisma.booking.findMany({
    where: { id: { startsWith: "demo-sv-bk-" } },
    select: { id: true },
  });
  if (old.length > 0) {
    const oldIds = old.map((b) => b.id);
    await prisma.serviceOrder.deleteMany({ where: { bookingId: { in: oldIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: oldIds } } });
    console.log(`기존 demo-sv 예약 ${oldIds.length}건 정리`);
  }

  let totalOrders = 0;
  let revVnd = 0n;
  let revKrw = 0;
  let marginVnd = 0n;

  for (let i = 0; i < NUM_BOOKINGS; i++) {
    const nights = randInt(1, 4);
    const checkOut = daysAgoUtc(randInt(1, SPREAD_DAYS));
    const checkIn = new Date(checkOut);
    checkIn.setUTCDate(checkIn.getUTCDate() - nights);
    const villaId = pick(villas).id;
    const isKrw = Math.random() < 0.3; // 30% 여행사 KRW 주문, 70% 현지 VND

    // 1~2개 주문(중복 타입 허용)
    const orderCount = randInt(1, 2);
    const orders = Array.from({ length: orderCount }).map((_, j) => {
      const it = pick(catalog);
      const quantity = randInt(1, 2);
      const unitVnd = it.priceVnd ?? 0n;
      const unitCost = it.costVnd ?? 0n;
      const lineVnd = unitVnd * BigInt(quantity);
      const lineCost = unitCost * BigInt(quantity);
      if (isKrw) {
        // 여행사 KRW: priceKrw 환산, priceVnd null, costVnd 0(placeholder — KRW 마진 제외)
        const krw = Math.round(Number(lineVnd) / FX_VND_PER_KRW / 1000) * 1000;
        revKrw += krw;
        return {
          id: `demo-sv-so-${i}-${j}`,
          type: it.type,
          status: pick(STATUSES),
          costVnd: 0n,
          priceKrw: krw,
          priceVnd: null as bigint | null,
          quantity,
          catalogItemId: it.id,
          requestedVia: "ADMIN" as const,
          serviceDate: checkIn,
          createdAt: checkIn,
        };
      }
      // 현지 VND: priceVnd 설정, priceKrw 0, costVnd 실원가 → 마진 산입
      revVnd += lineVnd;
      marginVnd += lineVnd - lineCost;
      return {
        id: `demo-sv-so-${i}-${j}`,
        type: it.type,
        status: pick(STATUSES),
        costVnd: lineCost,
        priceKrw: 0,
        priceVnd: lineVnd,
        quantity,
        catalogItemId: it.id,
        requestedVia: "ADMIN" as const,
        serviceDate: checkIn,
        createdAt: checkIn,
      };
    });
    totalOrders += orders.length;

    await prisma.booking.create({
      data: {
        id: `demo-sv-bk-${i}`,
        villaId,
        status: "CHECKED_OUT",
        channel: isKrw ? "TRAVEL_AGENCY" : pick(CHANNELS),
        checkIn,
        checkOut,
        nights,
        guestName: `샘플 부가서비스 고객 ${i + 1}`,
        guestCount: randInt(2, 6),
        saleCurrency: isKrw ? "KRW" : "VND",
        supplierCostVnd: BigInt(nights * randInt(800_000, 2_000_000)),
        breakfastIncluded: false,
        createdAt: checkIn,
        serviceOrders: { create: orders },
      },
    });
  }

  console.log(
    `완료 — 과거 예약 ${NUM_BOOKINGS}건 · 부가서비스 주문 ${totalOrders}건\n` +
      `  매출 VND ${revVnd.toLocaleString()}₫ · KRW ${revKrw.toLocaleString()}원 · VND마진 ${marginVnd.toLocaleString()}₫ (최근 ${SPREAD_DAYS}일 분산)`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
