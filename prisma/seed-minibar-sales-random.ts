/**
 * 미니바 판매(소비) 랜덤 시드 (시연/테스트 DB 전용) — 대량 createMany 최적화판.
 *   모든 CHECKED_OUT 숙박에 인원·박수 비례 미니바 소비(생수·맥주·소주·콜라·과자) 생성.
 *   미니바 매출 = CheckoutMinibarLine.lineVnd(체크아웃월 인식).
 *   - 체크아웃 기록 없으면 생성(demo-cor-mbl-), 소비 라인 demo-mbl-.
 *   - minibarChargeVnd 캐시는 raw SQL 한 번으로 전체 라인 합 재계산.
 *   실행: npx tsx --env-file=.env prisma/seed-minibar-sales-random.ts (멱등: demo-mbl-/demo-cor-mbl- 선삭제)
 */
import { PrismaClient, Prisma } from "@prisma/client";
const prisma = new PrismaClient();
const LINE_PREFIX = "demo-mbl-";
const REC_PREFIX = "demo-cor-mbl-";

function randInt(min: number, max: number): number { return min + Math.floor(Math.random() * (max - min + 1)); }

async function main() {
  const actor = await prisma.user.findFirst({ where: { role: { in: ["OWNER", "ADMIN", "MANAGER"] } }, select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!actor) throw new Error("운영자 사용자 없음");

  const items = await prisma.minibarItem.findMany({ where: { active: true }, select: { id: true, nameKo: true, unitPriceVnd: true, costVnd: true, stockQty: true } });
  const byName = new Map(items.map((i) => [i.nameKo, i]));

  const delLines = await prisma.checkoutMinibarLine.deleteMany({ where: { id: { startsWith: LINE_PREFIX } } });
  const delRecs = await prisma.checkOutRecord.deleteMany({ where: { id: { startsWith: REC_PREFIX } } });

  const bookings = await prisma.booking.findMany({
    where: { status: "CHECKED_OUT" },
    select: { id: true, checkOut: true, guestCount: true, nights: true, checkOutRecord: { select: { id: true } } },
  });

  function basket(g: number, n: number): Array<[string, number]> {
    return [
      ["생수", randInt(2, g + n * 2)],
      ["맥주", randInt(0, g + n)],
      ["소주", randInt(0, Math.ceil(n / 2))],
      ["콜라", randInt(0, g)],
      ["과자", randInt(0, Math.max(1, g - 1))],
    ];
  }

  const newRecords: Prisma.CheckOutRecordCreateManyInput[] = [];
  const lines: Prisma.CheckoutMinibarLineCreateManyInput[] = [];
  const touchedRecIds: string[] = [];

  for (const b of bookings) {
    const recId = b.checkOutRecord?.id ?? `${REC_PREFIX}${b.id}`;
    if (!b.checkOutRecord) {
      newRecords.push({ id: recId, bookingId: b.id, photoUrls: [], damageFound: false, createdBy: actor.id, createdAt: b.checkOut });
    }
    touchedRecIds.push(recId);
    const g = Math.max(1, b.guestCount);
    const n = Math.max(1, b.nights);
    let idx = 0;
    for (const [name, qty] of basket(g, n)) {
      if (qty <= 0) continue;
      const item = byName.get(name);
      if (!item) continue;
      lines.push({
        id: `${LINE_PREFIX}${b.id}-${idx++}`,
        checkOutRecordId: recId,
        minibarItemId: item.id,
        nameKo: item.nameKo,
        stockedQty: item.stockQty,
        consumedQty: qty,
        unitPriceVnd: item.unitPriceVnd,
        costVnd: item.costVnd,
        lineVnd: item.unitPriceVnd * BigInt(qty),
        lineCostVnd: item.costVnd != null ? item.costVnd * BigInt(qty) : null,
        createdAt: b.checkOut,
      });
    }
  }

  if (newRecords.length) await prisma.checkOutRecord.createMany({ data: newRecords });
  // createMany는 대량도 단일 쿼리 — 청크 불필요(Prisma 내부 처리)
  if (lines.length) await prisma.checkoutMinibarLine.createMany({ data: lines });

  // minibarChargeVnd 캐시 재계산 — touched 기록만, raw SQL 1회(라인 합)
  if (touchedRecIds.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE "CheckOutRecord" cor
       SET "minibarChargeVnd" = sub.s
       FROM (SELECT "checkOutRecordId" AS rid, SUM("lineVnd") AS s FROM "CheckoutMinibarLine" GROUP BY "checkOutRecordId") sub
       WHERE cor.id = sub.rid AND cor.id = ANY($1::text[])`,
      touchedRecIds
    );
  }

  const all = await prisma.checkoutMinibarLine.aggregate({ _sum: { lineVnd: true, lineCostVnd: true } });
  console.log(
    `완료 — 기존 라인 ${delLines.count}·기록 ${delRecs.count} 삭제 후: 체크아웃 ${bookings.length}건, 기록 ${newRecords.length} 신규·라인 ${lines.length} 생성. ` +
      `전체 미니바 매출 ${all._sum.lineVnd ?? 0n}đ (마진 ${(all._sum.lineVnd ?? 0n) - (all._sum.lineCostVnd ?? 0n)}đ)`
  );
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
