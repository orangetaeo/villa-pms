/**
 * USD 예약 + 실제 결제 완료 데모 시드 (수동 1회용, 시연/테스트 DB 전용)
 *
 *   USD 판매통화(Phase 2, PR #86) 예약에 "실질적으로 결제가 이루어진 것처럼" 데이터를 넣는다.
 *   - Booking: saleCurrency=USD, totalSaleUsd(정수 달러), fxVndPerUsd(예약 시점 USD→VND 스냅샷)
 *   - Payment: currency=USD, amount=정수 달러(표시층이 ÷100 안 함 → totalSaleUsd와 동일 단위),
 *              vndEquivalent=usdToVndSnapshot(usd, fx), fxRateToVnd=fx, purpose=GUEST
 *   - AuditLog: Booking·Payment 생성 기록 (글로벌 규칙: 데이터 변경엔 감사로그)
 *   ※ USD는 LEDGER 미지원(CASH_USD 계정 없음·cashAccountFor throw) → COLLECTION 분개는 생성하지 않음
 *     (시스템 현실과 일치. /revenue·정산 USD 수납은 Booking.totalSaleUsd에서 파생, Payment는 결제 증빙).
 *
 *   실행: node --env-file=.env prisma/seed-usd-payments.mjs
 *   멱등: id 접두 `demo-usd-` 의 Booking·Payment·AuditLog 를 먼저 전부 삭제 후 재생성.
 *   정리: 같은 접두로 언제든 삭제 가능 (실거래 아님).
 *
 *   raw SQL 사용 이유: 공유 폴더 prisma client 가 origin/main(USD 컬럼)보다 stale → 타입드 클라이언트에
 *     totalSaleUsd/fxVndPerUsd 없음. 라이브 Neon 에는 additive ALTER 로 컬럼 존재.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ID = "demo-usd-";
const ADMIN_ID = "seed-admin-theo";
const FX_VND_PER_USD = "26261.4225"; // 2026-06-27 FX_DAILY_RATES_VND.USD 스냅샷 (제안 흐름과 동일)

/** lib/pricing.ts usdToVndSnapshot 와 동형: vnd = usd × fx, half-up */
function usdToVndSnapshot(usd, fxStr) {
  const [int, frac = ""] = fxStr.split(".");
  const fxScaled = BigInt(int + frac.padEnd(4, "0")); // ×1e4
  return (BigInt(usd) * fxScaled + 5_000n) / 10_000n;
}

const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d)); // @db.Date (자정 UTC)
const dayMs = 86400000;
const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

// 데모 명세 — 실제 외국인 게스트가 USD 현금/이체로 완납한 것처럼
const SPECS = [
  {
    villaId: "demo-rv-001", perNightCostVnd: 3_500_000n, nights: 3, usd: 1500,
    status: "CHECKED_OUT", channel: "DIRECT", guestName: "John Anderson",
    guestPhone: "+1-415-555-0142", method: "CASH", startHint: D(2026, 6, 10),
  },
  {
    villaId: "demo-rv-033", perNightCostVnd: 3_700_000n, nights: 4, usd: 2000,
    status: "CHECKED_OUT", channel: "DIRECT", guestName: "Михаил Иванов",
    guestPhone: "+7-921-555-0177", method: "VN_BANK_TRANSFER", startHint: D(2026, 6, 17),
  },
  {
    villaId: "demo-rv-025", perNightCostVnd: 4_800_000n, nights: 2, usd: 1200,
    status: "CONFIRMED", channel: "DIRECT", guestName: "Emma Wilson",
    guestPhone: "+44-20-7946-0023", method: "CASH", startHint: D(2026, 7, 15),
  },
];

async function freeWindow(villaId, startHint, nights, extraTaken) {
  const existing = await prisma.booking.findMany({
    where: { villaId, status: { notIn: ["CANCELLED", "EXPIRED"] } },
    select: { checkIn: true, checkOut: true },
  });
  const taken = existing
    .map((b) => [b.checkIn.getTime(), b.checkOut.getTime()])
    .concat(extraTaken);
  for (let off = 0; off < 120; off++) {
    const ci = startHint.getTime() + off * dayMs;
    const co = ci + nights * dayMs;
    if (!taken.some(([t1, t2]) => overlaps(ci, co, t1, t2))) {
      return [new Date(ci), new Date(co)];
    }
  }
  throw new Error(`빈 구간 못 찾음: ${villaId}`);
}

async function main() {
  // 멱등 정리 (Payment·AuditLog 먼저, FK 없지만 명시)
  await prisma.$executeRawUnsafe(`DELETE FROM "Payment" WHERE id LIKE '${ID}%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE id LIKE '${ID}%'`);
  const delB = await prisma.$executeRawUnsafe(`DELETE FROM "Booking" WHERE id LIKE '${ID}%'`);
  console.log(`정리: 기존 demo-usd 예약 ${delB}건 삭제`);

  const usedByVilla = new Map();
  let n = 0;
  const summary = [];

  for (const s of SPECS) {
    n++;
    const bid = `${ID}b${String(n).padStart(3, "0")}`;
    const pid = `${ID}p${String(n).padStart(3, "0")}`;
    const extra = usedByVilla.get(s.villaId) ?? [];
    const [checkIn, checkOut] = await freeWindow(s.villaId, s.startHint, s.nights, extra);
    extra.push([checkIn.getTime(), checkOut.getTime()]);
    usedByVilla.set(s.villaId, extra);

    const supplierCostVnd = s.perNightCostVnd * BigInt(s.nights);
    const vndEq = usdToVndSnapshot(s.usd, FX_VND_PER_USD);
    const createdAt = new Date(checkIn.getTime() - 14 * dayMs); // 예약은 체크인 2주 전 생성
    const receivedAt = new Date(checkIn.getTime() - 10 * dayMs); // 입금은 체크인 10일 전 완료
    const guestCount = Math.min(s.nights + 1, 6);

    // ── Booking (USD 판매통화) ──
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Booking"
        (id, "villaId", status, channel, "checkIn", "checkOut", nights,
         "guestName", "guestCount", "guestPhone", "saleCurrency",
         "totalSaleKrw", "totalSaleVnd", "totalSaleUsd", "fxVndPerKrw", "fxVndPerUsd",
         "supplierCostVnd", "depositStatus", "breakfastIncluded", seller, note,
         "createdAt", "updatedAt")
       VALUES
        ($1,$2,$3::"BookingStatus",$4::"BookingChannel",$5,$6,$7,
         $8,$9,$10,'USD'::"Currency",
         NULL,NULL,$11,NULL,$12::numeric,
         $13,'NONE'::"DepositStatus",true,'OPERATOR'::"BookingSeller",$14,
         $15,$16)`,
      bid, s.villaId, s.status, s.channel, checkIn, checkOut, s.nights,
      s.guestName, guestCount, s.guestPhone,
      s.usd, FX_VND_PER_USD,
      supplierCostVnd, "USD 결제 데모 (실거래 아님)",
      createdAt, new Date()
    );

    // ── Payment (USD 완납, 결제 증빙) ──
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Payment"
        (id, "bookingId", currency, amount, method, "fxRateToVnd", "vndEquivalent",
         "receivedAt", note, purpose, "createdAt")
       VALUES
        ($1,$2,'USD'::"Currency",$3,$4::"PaymentMethod",$5::numeric,$6,
         $7,$8,'GUEST'::"PaymentPurpose",$9)`,
      pid, bid, BigInt(s.usd), s.method, FX_VND_PER_USD, vndEq,
      receivedAt, "USD 객실료 완납 (데모)", receivedAt
    );

    // ── AuditLog ──
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", changes, "createdAt")
       VALUES ($1,$2,'CREATE','Booking',$3,$4::jsonb,$5)`,
      `${ID}aB${n}`, ADMIN_ID, bid,
      JSON.stringify({ saleCurrency: { old: null, new: "USD" }, totalSaleUsd: { old: null, new: s.usd } }),
      createdAt
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", changes, "createdAt")
       VALUES ($1,$2,'CREATE','Payment',$3,$4::jsonb,$5)`,
      `${ID}aP${n}`, ADMIN_ID, pid,
      JSON.stringify({ amount: { old: null, new: `USD ${s.usd}` }, purpose: { old: null, new: "GUEST" } }),
      receivedAt
    );

    summary.push({
      booking: bid, villa: s.villaId, status: s.status, guest: s.guestName,
      stay: `${checkIn.toISOString().slice(0, 10)} ~ ${checkOut.toISOString().slice(0, 10)} (${s.nights}박)`,
      usd: `$${s.usd}`, vndEquivalent: vndEq.toString(),
      supplierCostVnd: supplierCostVnd.toString(),
      marginVnd: (vndEq - supplierCostVnd).toString(),
    });
  }

  console.log("\n=== 생성된 USD 결제 데모 ===");
  console.table(summary);

  // 검증: 라이브 DB에서 USD 예약/결제 재조회
  const check = await prisma.$queryRawUnsafe(
    `SELECT b.id, b.status, b."totalSaleUsd", b."fxVndPerUsd",
            p.id AS payment_id, p.currency AS pay_cur, p.amount AS pay_amt, p."vndEquivalent"
     FROM "Booking" b JOIN "Payment" p ON p."bookingId"=b.id
     WHERE b.id LIKE '${ID}%' ORDER BY b.id`
  );
  console.log("\n=== DB 재조회 검증 (Booking ⋈ Payment) ===");
  console.log(JSON.stringify(check, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
