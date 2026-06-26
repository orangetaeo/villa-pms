/**
 * 파트너 여신 한도 초과 사례 2건 추가 — 등급B 파트너에 큰 미납(OVERDUE) 채권을 더해
 *   미수잔액이 creditLimitVnd를 넘게 만든다(과다 외상 → 신용차단 대상 시연).
 * 실행: npx tsx --env-file=.env prisma/seed-partner-overlimit.ts
 * 멱등: demo-vs-over-bk-* / demo-rcv-over-* 접두 → 재실행 시 정리 후 재생성.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const TODAY = new Date("2026-06-26T00:00:00.000Z");
const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
function addDays(d: Date, n: number) { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; }
const dateStr = (d: Date) => d.toISOString().slice(0, 10);

const TARGETS = [
  { name: "모두투어", channel: "TRAVEL_AGENCY", over: randInt(20_000_000, 30_000_000) },
  { name: "베트남퍼스트랜드", channel: "LAND_AGENCY", over: randInt(15_000_000, 25_000_000) },
];

async function main() {
  const villas = await prisma.villa.findMany({ where: { status: "ACTIVE" }, select: { id: true } });

  // purge
  await prisma.$executeRawUnsafe(`DELETE FROM "PartnerReceivable" WHERE id LIKE 'demo-rcv-over-%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM "Booking" WHERE id LIKE 'demo-vs-over-bk-%'`);

  let i = 0;
  for (const tgt of TARGETS) {
    const prow: any[] = await prisma.$queryRawUnsafe(`
      SELECT pt.id, pt."creditLimitVnd"::text climit,
        COALESCE(SUM(CASE WHEN rc.status NOT IN ('PAID','WRITTEN_OFF')
          THEN rc."totalVnd"-rc."depositPaidVnd"-rc."balancePaidVnd" ELSE 0 END),0)::text outstanding
      FROM "Partner" pt LEFT JOIN "PartnerReceivable" rc ON rc."partnerId"=pt.id
      WHERE pt.name='${tgt.name}' GROUP BY pt.id, pt."creditLimitVnd"`);
    if (prow.length === 0) { console.log(`${tgt.name} 없음 — 건너뜀`); continue; }
    const partnerId = prow[0].id;
    const limit = BigInt(prow[0].climit);
    const outstanding = BigInt(prow[0].outstanding);
    const headroom = limit - outstanding;
    // 새 미납 채권 = 남은 여유 + 초과분 → 미수잔액이 한도를 over만큼 초과
    const totalVnd = headroom + BigInt(tgt.over);

    const nights = randInt(2, 4);
    const checkOut = addDays(TODAY, -randInt(20, 60)); // 과거 체크아웃
    const checkIn = addDays(checkOut, -nights);
    const bid = `demo-vs-over-bk-${i}`;
    await prisma.booking.create({
      data: {
        id: bid,
        villaId: villas[randInt(0, villas.length - 1)].id,
        status: "CHECKED_OUT",
        channel: tgt.channel as any,
        checkIn, checkOut, nights,
        guestName: `한도초과 샘플 ${i + 1}`,
        guestCount: randInt(2, 6),
        saleCurrency: "VND",
        totalSaleVnd: totalVnd,
        supplierCostVnd: (totalVnd * 6n) / 10n,
        depositStatus: "PARTIAL_DEDUCTED",
        breakfastIncluded: false,
        createdAt: checkIn,
      },
    });

    // OVERDUE 채권: 입금 0 → outstanding = totalVnd (한도 초과 유발), dueDate 과거
    const rid = `demo-rcv-over-${i}`;
    const depositDue = (totalVnd * 30n + 99n) / 100n;
    await prisma.$executeRawUnsafe(`
      INSERT INTO "PartnerReceivable"
        (id,"partnerId","bookingId","totalVnd","depositDueVnd","depositPaidVnd","balancePaidVnd",
         "dueDate",status,"createdAt","updatedAt")
      VALUES ('${rid}','${partnerId}','${bid}',${totalVnd},${depositDue},0,0,
        '${dateStr(addDays(checkOut, 15))}'::date,'OVERDUE'::"ReceivableStatus",now(),now())`);
    await prisma.$executeRawUnsafe(`UPDATE "Booking" SET "partnerId"='${partnerId}' WHERE id='${bid}'`);

    const newOut = outstanding + totalVnd;
    console.log(`${tgt.name}: 한도 ${limit.toLocaleString()}₫ · 새 미수 ${newOut.toLocaleString()}₫ → 초과 ${(newOut - limit).toLocaleString()}₫ (추가 채권 ${totalVnd.toLocaleString()}₫)`);
    i++;
  }
  console.log("완료 — 한도 초과 사례", i, "건");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
