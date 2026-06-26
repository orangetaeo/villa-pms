/**
 * 파트너(B2B 여행사·랜드사) + 미수/여신 랜덤 샘플 시드 (ADR-0022).
 *   ① 신규 파트너 랜덤 생성(등급 A/B/C·여신한도·마감주기).
 *   ② 파트너 채널 빌라예약(TRAVEL_AGENCY·LAND_AGENCY)에 파트너 매칭 + Booking.partnerId 연결.
 *   ③ 예약 현황(과거 완납/연체·현재 선금·미래 미수·홀드 대기)에 맞게 PartnerReceivable 생성.
 *   ④ 등급B 파트너는 과거 채권 묶음 PartnerInvoice(마감 청구서) 1건씩.
 *
 *   ★ 로컬 Prisma 클라이언트엔 Partner 모델이 없어(메인 스키마 파트너 머지 이전) 전부 raw SQL.
 * 실행: npx tsx --env-file=.env prisma/seed-partner-random.ts
 * 멱등: id 접두 demo-ptr-/demo-rcv-/demo-inv- → 재실행 시 정리 후 재생성.
 * ⚠️ 대상 DB = .env DATABASE_URL(프로덕션).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TODAY = new Date("2026-06-26T00:00:00.000Z");
const FX = 18.5;
const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T,>(arr: T[]): T => arr[randInt(0, arr.length - 1)];
const q = (s: string) => s.replace(/'/g, "''"); // SQL 문자열 이스케이프
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

// 신규 파트너 정의 (type, name, nameVi, tier, limitVnd, depositPct, termDays, billing, status, phone)
const PARTNERS = [
  ["TRAVEL_AGENCY", "하나투어", null, "B", 200_000_000, 30, 30, "MONTHLY", "ACTIVE", "02-1234-5678"],
  ["TRAVEL_AGENCY", "모두투어", null, "B", 150_000_000, 30, 15, "BIWEEKLY", "ACTIVE", "02-2345-6789"],
  ["TRAVEL_AGENCY", "노랑풍선", null, "A", 0, 100, 0, null, "ACTIVE", "02-3456-7890"],
  ["TRAVEL_AGENCY", "참좋은여행", null, "C", 100_000_000, 50, 30, "MONTHLY", "ACTIVE", "02-4567-8901"],
  ["LAND_AGENCY", "푸꾸옥한인랜드", "Phú Quốc Korea Land", "B", 120_000_000, 30, 15, "BIWEEKLY", "ACTIVE", "+84-297-111-2222"],
  ["LAND_AGENCY", "사이공드림투어", "Saigon Dream Tour", "A", 0, 100, 0, null, "ACTIVE", "+84-28-333-4444"],
  ["LAND_AGENCY", "베트남퍼스트랜드", "Vietnam First Land", "B", 80_000_000, 30, 7, "WEEKLY", "SUSPENDED", "+84-297-555-6666"],
] as const;

async function main() {
  // ── purge (자식→부모 순서) ──
  await prisma.$executeRawUnsafe(`UPDATE "Booking" SET "partnerId"=NULL WHERE "partnerId" LIKE 'demo-ptr-%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM "PartnerReceivable" WHERE id LIKE 'demo-rcv-%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM "PartnerInvoice" WHERE id LIKE 'demo-inv-%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM "Partner" WHERE id LIKE 'demo-ptr-%'`);

  // ── ① 파트너 생성 ──
  const partnerIds: { id: string; type: string; tier: string; depositPct: number; termDays: number }[] = [];
  for (let i = 0; i < PARTNERS.length; i++) {
    const [type, name, nameVi, tier, limit, dep, term, billing, status, phone] = PARTNERS[i];
    const id = `demo-ptr-${i}`;
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Partner"
        (id, type, name, "nameVi", "contactPhone", "creditTier", "creditLimitVnd",
         "depositRatePct", "paymentTermDays", "billingCycle", status, memo, "createdAt", "updatedAt")
      VALUES ('${id}', '${type}'::"PartnerType", '${q(name)}',
        ${nameVi ? `'${q(nameVi)}'` : "NULL"}, '${phone}', '${tier}'::"CreditTier", ${limit},
        ${dep}, ${term}, ${billing ? `'${billing}'` : "NULL"}, '${status}'::"PartnerStatus",
        '랜덤 샘플 파트너', now(), now())`);
    partnerIds.push({ id, type: type as string, tier: tier as string, depositPct: dep as number, termDays: term as number });
  }
  console.log(`① 파트너 ${partnerIds.length}명 생성`);

  // ── ② 파트너 채널 빌라예약 조회(demo-vs) — enum은 ::text로 ──
  const bookings: any[] = await prisma.$queryRawUnsafe(`
    SELECT id, channel::text AS channel, status::text AS status,
           "totalSaleVnd"::text AS vnd, "totalSaleKrw" AS krw,
           "checkIn"::text AS checkin, "checkOut"::text AS checkout
    FROM "Booking"
    WHERE id LIKE 'demo-vs-bk-%' AND channel IN ('TRAVEL_AGENCY','LAND_AGENCY')`);

  const travel = partnerIds.filter((p) => p.type === "TRAVEL_AGENCY");
  const land = partnerIds.filter((p) => p.type === "LAND_AGENCY");

  // ── ③ 채권 생성 + Booking.partnerId 연결 ──
  let rcvCount = 0;
  const byPartner = new Map<string, string[]>(); // partnerId → 과거 PAID/OVERDUE receivable ids(인보이스 묶음용)
  const statTally: Record<string, number> = {};

  for (const b of bookings) {
    const partner = pick(b.channel === "TRAVEL_AGENCY" ? travel : land);
    // 객실료 VND 총액 (KRW 예약은 환산)
    const totalVnd = b.vnd != null ? BigInt(b.vnd) : BigInt(Math.round(Number(b.krw) * FX));
    if (totalVnd <= 0n) continue;
    const depositDue = ceilDiv(totalVnd * BigInt(partner.depositPct), 100n);

    // dueDate: 등급A=체크인일, B/C=체크아웃+termDays
    const checkIn = new Date(b.checkin);
    const checkOut = new Date(b.checkout);
    const dueDate = partner.tier === "A" ? checkIn : addDays(checkOut, partner.termDays);

    // 예약 현황별 미수 상태
    let status: string, depositPaid: bigint, balancePaid: bigint;
    const balance = totalVnd - depositDue;
    if (b.status === "CHECKED_OUT") {
      // 과거 완료: 대부분 완납, 일부 잔금 연체(미수)
      if (Math.random() < 0.75) { status = "PAID"; depositPaid = depositDue; balancePaid = balance; }
      else { status = "OVERDUE"; depositPaid = depositDue; balancePaid = 0n; }
    } else if (b.status === "NO_SHOW") {
      // 노쇼: 선금만 수취, 잔금은 대손/연체
      status = Math.random() < 0.5 ? "OVERDUE" : "WRITTEN_OFF"; depositPaid = depositDue; balancePaid = 0n;
    } else if (b.status === "CHECKED_IN") {
      status = "PARTIAL"; depositPaid = depositDue; balancePaid = 0n; // 투숙중: 선금만
    } else if (b.status === "CONFIRMED") {
      // 미래 확정: 선금 납부(PARTIAL) 또는 미납(PENDING)
      if (Math.random() < 0.7) { status = "PARTIAL"; depositPaid = depositDue; balancePaid = 0n; }
      else { status = "PENDING"; depositPaid = 0n; balancePaid = 0n; }
    } else { // HOLD
      status = "PENDING"; depositPaid = 0n; balancePaid = 0n; // 가예약: 미납
    }
    statTally[status] = (statTally[status] ?? 0) + 1;

    const rid = `demo-rcv-${b.id}`;
    await prisma.$executeRawUnsafe(`
      INSERT INTO "PartnerReceivable"
        (id, "partnerId", "bookingId", "totalVnd", "depositDueVnd", "depositPaidVnd",
         "balancePaidVnd", "dueDate", status, "createdAt", "updatedAt")
      VALUES ('${rid}', '${partner.id}', '${b.id}', ${totalVnd}, ${depositDue}, ${depositPaid},
        ${balancePaid}, '${dateStr(dueDate)}'::date, '${status}'::"ReceivableStatus", now(), now())`);
    await prisma.$executeRawUnsafe(`UPDATE "Booking" SET "partnerId"='${partner.id}' WHERE id='${b.id}'`);
    rcvCount++;

    if (b.status === "CHECKED_OUT" && partner.tier !== "A") {
      const arr = byPartner.get(partner.id) ?? [];
      arr.push(rid);
      byPartner.set(partner.id, arr);
    }
  }
  console.log(`② 파트너 채널 예약 ${bookings.length}건에 채권 연결 / ③ 채권 ${rcvCount}건 생성`);
  console.log("   채권 상태 분포:", JSON.stringify(statTally));

  // ── ④ 등급B 마감 청구서(여신) — 과거 채권 묶음 1건/파트너 ──
  let invCount = 0;
  for (const [partnerId, rids] of byPartner) {
    if (rids.length < 2) continue;
    const p = partnerIds.find((x) => x.id === partnerId)!;
    // 묶인 채권 totalVnd 합
    const sumRow: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM("totalVnd"),0)::text AS s FROM "PartnerReceivable" WHERE id IN (${rids.map((r) => `'${r}'`).join(",")})`
    );
    const total = BigInt(sumRow[0].s);
    const periodStart = addDays(TODAY, -30);
    const periodEnd = addDays(TODAY, -1);
    const dueDate = addDays(periodEnd, p.termDays);
    const id = `demo-inv-${partnerId}`;
    // 일부는 완납(PAID), 일부 미수(ISSUED/OVERDUE)
    const paidFull = Math.random() < 0.5;
    const status = paidFull ? "PAID" : "ISSUED";
    const paid = paidFull ? total : 0n;
    await prisma.$executeRawUnsafe(`
      INSERT INTO "PartnerInvoice"
        (id, "partnerId", "periodStart", "periodEnd", "dueDate", "totalVnd", "paidVnd",
         status, "issuedAt", "paidAt", "createdAt")
      VALUES ('${id}', '${partnerId}', '${dateStr(periodStart)}'::date, '${dateStr(periodEnd)}'::date,
        '${dateStr(dueDate)}'::date, ${total}, ${paid}, '${status}'::"PartnerInvoiceStatus",
        now(), ${paidFull ? "now()" : "NULL"}, now())`);
    // 채권을 인보이스에 연결
    await prisma.$executeRawUnsafe(
      `UPDATE "PartnerReceivable" SET "invoiceId"='${id}' WHERE id IN (${rids.map((r) => `'${r}'`).join(",")})`
    );
    invCount++;
  }
  console.log(`④ 등급B 마감 청구서(여신) ${invCount}건 생성`);
  console.log("완료.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
