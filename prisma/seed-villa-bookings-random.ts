/**
 * 빌라 예약(판매) 랜덤 시드 (수동 1회용, 시연/테스트 DB 전용)
 *
 *   정상 빌라(판매가·마진 정상)들에 2026-02 ~ 2026-09 구간 예약을 충분히 생성.
 *   - 과거(체크아웃<오늘) = CHECKED_OUT 중심(+소수 NO_SHOW/CANCELLED) → 매출·정산 통계 인식
 *   - 현재 = CHECKED_IN, 미래 = CONFIRMED 중심(+소수 HOLD)
 *   채널·파트너·통화를 섞고, 빌라별 날짜 겹침(기존+신규)을 피한다.
 *
 *   실행: npx tsx --env-file=.env prisma/seed-villa-bookings-random.ts
 *   멱등: id 접두 `demo-rbk-` 예약을 먼저 전부 삭제 후 재생성.
 *   ★ 매출은 booking.totalSaleKrw/Vnd(체크아웃·CHECKED_OUT/NO_SHOW)에서 집계 — 별도 Payment 불필요.
 */
import { PrismaClient, BookingStatus, BookingChannel, Currency, DepositStatus, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const ID_PREFIX = "demo-rbk-";
const FX = new Prisma.Decimal("18.87");
const TODAY = new Date("2026-06-26T00:00:00.000Z");
const WIN_FROM = Date.UTC(2026, 1, 1); // 2026-02-01
const WIN_TO = Date.UTC(2026, 8, 30); // 2026-09-30

const KO_NAMES = ["김민준", "이서연", "박지후", "최예은", "정도윤", "강하은", "윤서진", "임채원", "한지민", "서준호", "오지안", "신하준", "조시우", "임수아"];
const VI_NAMES = ["Nguyễn An", "Trần My", "Phạm Thảo", "Lê Hùng", "Hoàng Linh", "Vũ Nam"];

function randInt(min: number, max: number): number { return min + Math.floor(Math.random() * (max - min + 1)); }
function pick<T>(a: readonly T[]): T { return a[Math.floor(Math.random() * a.length)]; }
function dayMs(n: number) { return n * 86400000; }
function overlaps(aFrom: number, aTo: number, bFrom: number, bTo: number) { return aFrom < bTo && bFrom < aTo; }

async function main() {
  // ★ 전체 ACTIVE 빌라(유효 기본요율 보유)에 예약 생성 — 정크(INACTIVE)는 자동 제외
  const villas = await prisma.villa.findMany({
    where: { status: "ACTIVE", ratePeriods: { some: { isBase: true, salePriceKrw: { gt: 0 } } } },
    select: {
      id: true, name: true, maxGuests: true, breakfastAvailable: true,
      ratePeriods: { where: { isBase: true }, select: { supplierCostVnd: true, salePriceVnd: true, salePriceKrw: true } },
    },
  });
  const villaIds = villas.map((v) => v.id);

  const partners = await prisma.partner.findMany({ select: { id: true, type: true } });
  const travelPtr = partners.filter((p) => p.type === "TRAVEL_AGENCY").map((p) => p.id);
  const landPtr = partners.filter((p) => p.type === "LAND_AGENCY").map((p) => p.id);

  // 기존 예약(빌라별 점유 구간) — 겹침 회피
  const existing = await prisma.booking.findMany({
    where: { villaId: { in: villaIds }, status: { notIn: ["CANCELLED", "EXPIRED"] } },
    select: { villaId: true, checkIn: true, checkOut: true },
  });
  const occByVilla = new Map<string, Array<[number, number]>>();
  for (const id of villaIds) occByVilla.set(id, []);
  for (const b of existing) {
    occByVilla.get(b.villaId)?.push([b.checkIn.getTime(), b.checkOut.getTime()]);
  }

  // 기존 demo-rbk 정리(멱등) — 모든 외래키 먼저 정리
  const demoIds = await prisma.booking.findMany({ where: { id: { startsWith: ID_PREFIX } }, select: { id: true } });
  const demoBookingIds = demoIds.map(b => b.id);
  if (demoBookingIds.length > 0) {
    try { await prisma.bookingChangeRequest.deleteMany({ where: { bookingId: { in: demoBookingIds } } }); } catch {}
    try { await prisma.serviceOrder.deleteMany({ where: { bookingId: { in: demoBookingIds } } }); } catch {}
    try { await prisma.checkOutRecord.deleteMany({ where: { bookingId: { in: demoBookingIds } } }); } catch {}
    try { await prisma.checkInRecord.deleteMany({ where: { bookingId: { in: demoBookingIds } } }); } catch {}
    try { await prisma.partnerReceivable.deleteMany({ where: { bookingId: { in: demoBookingIds } } }); } catch {}
    try { await prisma.payment.deleteMany({ where: { bookingId: { in: demoBookingIds } } }); } catch {}
  }
  const del = await prisma.booking.deleteMany({ where: { id: { startsWith: ID_PREFIX } } });

  let seq = 1;
  const rows: Prisma.BookingCreateManyInput[] = [];

  for (const v of villas) {
    const base = v.ratePeriods[0];
    if (!base) continue;
    const occ = occByVilla.get(v.id)!;
    let cursor = WIN_FROM + dayMs(randInt(0, 2));

    while (cursor < WIN_TO) {
      const nights = randInt(2, 6);
      const ci = cursor;
      const co = ci + dayMs(nights);
      // 겹치면 점유 끝으로 점프
      const hit = occ.find(([f, t]) => overlaps(ci, co, f, t));
      if (hit) { cursor = hit[1] + dayMs(randInt(1, 2)); continue; }

      occ.push([ci, co]);
      cursor = co + dayMs(randInt(1, 3));

      // 상태 — 체크아웃 시점 기준
      let status: BookingStatus;
      if (co <= TODAY.getTime()) {
        const r = Math.random();
        status = r < 0.9 ? "CHECKED_OUT" : r < 0.95 ? "NO_SHOW" : "CANCELLED";
      } else if (ci <= TODAY.getTime()) {
        status = "CHECKED_IN";
      } else {
        status = Math.random() < 0.85 ? "CONFIRMED" : "HOLD";
      }

      // 채널·파트너·통화
      const channel = pick([BookingChannel.TRAVEL_AGENCY, BookingChannel.LAND_AGENCY, BookingChannel.DIRECT, BookingChannel.TRAVEL_AGENCY]);
      let partnerId: string | null = null;
      let cur: Currency;
      if (channel === "TRAVEL_AGENCY") { partnerId = travelPtr.length ? pick(travelPtr) : null; cur = "KRW"; }
      else if (channel === "LAND_AGENCY") { partnerId = landPtr.length ? pick(landPtr) : null; cur = Math.random() < 0.5 ? "KRW" : "VND"; }
      else { cur = Math.random() < 0.75 ? "VND" : "KRW"; }

      const costVnd = base.supplierCostVnd * BigInt(nights);
      const saleVnd = base.salePriceVnd * BigInt(nights);
      const saleKrw = base.salePriceKrw * nights;

      const guestName = cur === "KRW" ? pick(KO_NAMES) : Math.random() < 0.6 ? pick(VI_NAMES) : pick(KO_NAMES);
      const guests = randInt(2, v.maxGuests);

      let depositStatus: DepositStatus = DepositStatus.NONE;
      if (status === "CONFIRMED" || status === "CHECKED_IN") depositStatus = DepositStatus.HELD;
      else if (status === "CHECKED_OUT") depositStatus = DepositStatus.REFUNDED;

      const holdExpiresAt = status === "HOLD" ? new Date(TODAY.getTime() + dayMs(randInt(1, 2))) : null;

      rows.push({
        id: `${ID_PREFIX}${seq++}`,
        villaId: v.id,
        status,
        channel,
        seller: "OPERATOR",
        checkIn: new Date(ci),
        checkOut: new Date(co),
        nights,
        guestName,
        guestCount: guests,
        guestPhone: cur === "KRW" ? "+82-10-1234-5678" : "+84-90-111-2222",
        partnerId,
        holdExpiresAt,
        saleCurrency: cur,
        totalSaleKrw: cur === "KRW" ? saleKrw : null,
        totalSaleVnd: cur === "VND" ? saleVnd : null,
        fxVndPerKrw: FX,
        supplierCostVnd: costVnd,
        depositAmount: depositStatus === "HELD" ? (cur === "KRW" ? 200_000 : 3_000_000) : null,
        depositCurrency: depositStatus === "HELD" ? cur : null,
        depositStatus,
        breakfastIncluded: v.breakfastAvailable,
        createdAt: new Date(ci - dayMs(randInt(7, 21))),
      });
    }
  }

  await prisma.booking.createMany({ data: rows });

  // 상태 분포 로그
  const dist = new Map<string, number>();
  for (const r of rows) dist.set(r.status, (dist.get(r.status) ?? 0) + 1);
  console.log(
    `완료 — 기존 ${del.count}건 삭제 후 ${rows.length}건 생성 (빌라 ${villas.length}개). ` +
      `상태분포: ${[...dist.entries()].map(([k, v]) => `${k}:${v}`).join(" ")}`
  );
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
