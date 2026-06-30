/**
 * 공급자 직접예약(seller=SUPPLIER) 랜덤 시드 (수동 1회용, 시연/테스트 DB 전용)
 *
 *   공급자가 자기 고객에게 직접 판 예약(F10 / ADR-0021 §6)을 캘린더에 채운다.
 *   - lib/supplier-direct-booking.ts 와 동일 형태: seller=SUPPLIER, channel=DIRECT,
 *     supplierCostVnd=0(우리가 매입 안 함 → 정산 제외), supplierSalePriceVnd=공급자 수금액(VND),
 *     saleCurrency=VND. 판매가 KRW·마진 없음(마진 비공개 원칙).
 *   - 과거(체크아웃<오늘)=CHECKED_OUT, 현재=CHECKED_IN, 미래=CONFIRMED.
 *   - 빌라별 날짜 겹침(기존 모든 예약·차단 + 신규)을 피한다.
 *
 *   실행: npx tsx --env-file=.env prisma/seed-direct-bookings-random.ts
 *   멱등: id 접두 `demo-dbk-` 예약을 먼저 전부 삭제 후 재생성.
 */
import {
  PrismaClient,
  BookingStatus,
  BookingChannel,
  BookingSeller,
  Currency,
  Prisma,
} from "@prisma/client";

const prisma = new PrismaClient();
const ID_PREFIX = "demo-dbk-";
const TODAY = new Date("2026-06-30T00:00:00.000Z");
const WIN_FROM = Date.UTC(2026, 3, 1); // 2026-04-01
const WIN_TO = Date.UTC(2026, 8, 30); // 2026-09-30

const VI_NAMES = [
  "Nguyễn Văn An", "Trần Thị Mai", "Phạm Minh Tuấn", "Lê Hoàng Long",
  "Hoàng Thị Linh", "Vũ Đức Nam", "Đặng Thu Hà", "Bùi Quang Huy",
  "Đỗ Ngọc Anh", "Ngô Văn Thành",
];

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
function pick<T>(a: readonly T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}
function dayMs(n: number) {
  return n * 86400000;
}
function overlaps(aFrom: number, aTo: number, bFrom: number, bTo: number) {
  return aFrom < bTo && bFrom < aTo;
}

async function main() {
  // 직접예약은 공급자 보유 ACTIVE 빌라 대상 (Villa.supplierId 는 항상 존재)
  const villas = await prisma.villa.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      maxGuests: true,
      ratePeriods: {
        where: { isBase: true },
        select: { supplierCostVnd: true, salePriceVnd: true },
      },
    },
  });
  const villaIds = villas.map((v) => v.id);

  // 기존 예약 점유 구간 (겹침 회피) — 취소/만료 제외
  const existing = await prisma.booking.findMany({
    where: { villaId: { in: villaIds }, status: { notIn: ["CANCELLED", "EXPIRED"] } },
    select: { villaId: true, checkIn: true, checkOut: true },
  });
  // 기존 차단(CalendarBlock)도 회피
  const blocks = await prisma.calendarBlock.findMany({
    where: { villaId: { in: villaIds } },
    select: { villaId: true, startDate: true, endDate: true },
  });

  const occByVilla = new Map<string, Array<[number, number]>>();
  for (const id of villaIds) occByVilla.set(id, []);
  for (const b of existing) {
    occByVilla.get(b.villaId)?.push([b.checkIn.getTime(), b.checkOut.getTime()]);
  }
  for (const b of blocks) {
    occByVilla.get(b.villaId)?.push([b.startDate.getTime(), b.endDate.getTime()]);
  }

  // 기존 demo-dbk 정리(멱등)
  const del = await prisma.booking.deleteMany({ where: { id: { startsWith: ID_PREFIX } } });

  let seq = 1;
  const rows: Prisma.BookingCreateManyInput[] = [];

  for (const v of villas) {
    const base = v.ratePeriods[0];
    const occ = occByVilla.get(v.id)!;
    // 빌라당 3~5건 직접예약 시도
    const target = randInt(3, 5);
    let made = 0;
    let cursor = WIN_FROM + dayMs(randInt(0, 10));
    let guard = 0;

    while (made < target && cursor < WIN_TO && guard < 60) {
      guard++;
      const nights = randInt(2, 5);
      const ci = cursor;
      const co = ci + dayMs(nights);
      const hit = occ.find(([f, t]) => overlaps(ci, co, f, t));
      if (hit) {
        cursor = hit[1] + dayMs(randInt(1, 3));
        continue;
      }
      occ.push([ci, co]);
      cursor = co + dayMs(randInt(2, 8));

      // 상태 — 체크아웃/체크인 시점 기준
      let status: BookingStatus;
      if (co <= TODAY.getTime()) status = "CHECKED_OUT";
      else if (ci <= TODAY.getTime()) status = "CHECKED_IN";
      else status = "CONFIRMED";

      // 공급자 수금액(VND) — 기본요율 판매가 근사치(±15%) × 박수, 없으면 박당 2~5M
      const perNight = base?.salePriceVnd
        ? BigInt(
            Math.round(Number(base.salePriceVnd) * (0.85 + Math.random() * 0.3))
          )
        : BigInt(randInt(2_000_000, 5_000_000));
      const supplierSaleVnd = perNight * BigInt(nights);

      rows.push({
        id: `${ID_PREFIX}${seq++}`,
        villaId: v.id,
        seller: BookingSeller.SUPPLIER,
        status,
        channel: BookingChannel.DIRECT,
        checkIn: new Date(ci),
        checkOut: new Date(co),
        nights,
        guestName: pick(VI_NAMES),
        guestCount: randInt(2, Math.max(2, v.maxGuests)),
        guestPhone: "+84-90-" + randInt(100, 999) + "-" + randInt(1000, 9999),
        saleCurrency: Currency.VND,
        // 직접판매: 우리 매입 없음 → 원가 0(정산은 seller 필터로 제외)
        supplierCostVnd: 0n,
        supplierSalePriceVnd: supplierSaleVnd,
        breakfastIncluded: false,
        createdAt: new Date(ci - dayMs(randInt(3, 14))),
      });
      made++;
    }
  }

  await prisma.booking.createMany({ data: rows });

  const dist = new Map<string, number>();
  for (const r of rows) dist.set(r.status as string, (dist.get(r.status as string) ?? 0) + 1);
  console.log(
    `완료 — 기존 ${del.count}건 삭제 후 직접예약 ${rows.length}건 생성 (빌라 ${villas.length}개). ` +
      `상태분포: ${[...dist.entries()].map(([k, c]) => `${k}:${c}`).join(" ")}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
