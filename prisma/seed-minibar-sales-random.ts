/**
 * 미니바 판매 랜덤 샘플 시드 — 과거 날짜(최근 ~6개월)에 분산된 체크아웃 예약 + 미니바 판매 라인 생성.
 *   미니바 통계는 CheckoutMinibarLine을 booking.checkOut 기준으로 집계하므로,
 *   과거 checkOut 날짜를 가진 예약 + CheckOutRecord + 미니바 라인을 함께 만든다.
 *
 * 실행: npx tsx --env-file=.env prisma/seed-minibar-sales-random.ts
 *
 * 멱등: id 접두 `demo-mb-` → 재실행 시 기존 분 삭제 후 재생성(쌓이지 않음).
 * 정리: 이 스크립트 상단의 purge 블록만 돌리거나, demo-mb- 접두로 수동 삭제.
 * ⚠️ 대상 DB = .env DATABASE_URL(프로덕션). 판매가·원가는 현재 MinibarItem 값 스냅샷.
 */
import { PrismaClient, BookingChannel } from "@prisma/client";

const prisma = new PrismaClient();

const NUM_BOOKINGS = 40; // 생성할 과거 체크아웃 예약 수
const SPREAD_DAYS = 180; // 과거 분산 범위(일)
const TODAY = new Date("2026-06-26T00:00:00.000Z"); // 기준일(고정 — 재현성)

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}
/** UTC 자정 기준 날짜 — n일 전 */
function daysAgoUtc(n: number): Date {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

const CHANNELS: BookingChannel[] = ["TRAVEL_AGENCY", "LAND_AGENCY", "DIRECT"];

async function main() {
  const [actor, villas, items] = await Promise.all([
    prisma.user.findFirst({
      where: { role: { in: ["ADMIN", "OWNER", "MANAGER", "STAFF"] } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.villa.findMany({ where: { status: "ACTIVE" }, select: { id: true } }),
    prisma.minibarItem.findMany({
      where: { active: true },
      select: { id: true, nameKo: true, unitPriceVnd: true, costVnd: true, stockQty: true },
    }),
  ]);
  if (!actor) throw new Error("운영자 사용자 없음 — 먼저 seed 실행 필요");
  if (villas.length === 0 || items.length === 0) {
    console.log(`빌라 ${villas.length} · 품목 ${items.length} — 대상 없음`);
    return;
  }

  // ── purge: 기존 demo-mb- 분 제거(라인은 CheckOutRecord cascade로 삭제) ──
  const old = await prisma.booking.findMany({
    where: { id: { startsWith: "demo-mb-bk-" } },
    select: { id: true },
  });
  if (old.length > 0) {
    const oldIds = old.map((b) => b.id);
    await prisma.checkOutRecord.deleteMany({ where: { bookingId: { in: oldIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: oldIds } } });
    console.log(`기존 demo-mb 예약 ${oldIds.length}건 정리`);
  }

  let totalLines = 0;
  let totalRevenue = 0n;

  for (let i = 0; i < NUM_BOOKINGS; i++) {
    const nights = randInt(1, 4);
    const checkOut = daysAgoUtc(randInt(1, SPREAD_DAYS));
    const checkIn = new Date(checkOut);
    checkIn.setUTCDate(checkIn.getUTCDate() - nights);
    const villaId = pick(villas).id;

    // 이 체크아웃에서 판매된 미니바 품목 1~3종(중복 없이)
    const k = randInt(1, Math.min(3, items.length));
    const shuffled = [...items].sort(() => Math.random() - 0.5).slice(0, k);

    const lines = shuffled.map((it) => {
      const consumedQty = randInt(1, Math.max(2, it.stockQty)); // 1~비치수량
      const unit = it.unitPriceVnd;
      const cost = it.costVnd; // 현재 입고가 스냅샷(있으면 마진 산입)
      const lineVnd = unit * BigInt(consumedQty);
      const lineCostVnd = cost != null ? cost * BigInt(consumedQty) : null;
      return {
        minibarItemId: it.id,
        nameKo: it.nameKo,
        stockedQty: it.stockQty,
        consumedQty,
        unitPriceVnd: unit,
        costVnd: cost,
        lineVnd,
        lineCostVnd,
        createdAt: checkOut,
      };
    });
    const minibarChargeVnd = lines.reduce((s, l) => s + l.lineVnd, 0n);
    totalRevenue += minibarChargeVnd;
    totalLines += lines.length;

    await prisma.booking.create({
      data: {
        id: `demo-mb-bk-${i}`,
        villaId,
        status: "CHECKED_OUT",
        channel: pick(CHANNELS),
        checkIn,
        checkOut,
        nights,
        guestName: `샘플 투숙객 ${i + 1}`,
        guestCount: randInt(2, 6),
        saleCurrency: "VND",
        supplierCostVnd: BigInt(nights * randInt(800_000, 2_000_000)),
        breakfastIncluded: false,
        createdAt: checkIn,
        checkOutRecord: {
          create: {
            id: `demo-mb-co-${i}`,
            photoUrls: [],
            minibarChargeVnd,
            guestChargeVnd: minibarChargeVnd,
            createdBy: actor.id,
            createdAt: checkOut,
            minibarLines: { create: lines },
          },
        },
      },
    });
  }

  console.log(
    `완료 — 과거 체크아웃 ${NUM_BOOKINGS}건 · 미니바 판매 라인 ${totalLines}건 · 총 매출 ${totalRevenue.toLocaleString()}₫ (최근 ${SPREAD_DAYS}일 분산)`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
