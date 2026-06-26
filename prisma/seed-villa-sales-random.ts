/**
 * 빌라 판매 랜덤 샘플 시드 — 과거·현재·미래 예약을 상태별로 생성.
 *   매출 통계는 CHECKED_OUT·NO_SHOW + checkOut 기준(totalSale − supplierCost). 현재=CHECKED_IN,
 *   미래=CONFIRMED·HOLD(예약목록·공실보드·대시보드 노출). 통화 분리 ADR-0003(KRW=여행사 / VND=현지).
 *
 * 실행: npx tsx --env-file=.env prisma/seed-villa-sales-random.ts
 * 멱등: id 접두 `demo-vs-` → 재실행 시 기존 분 삭제 후 재생성.
 * ⚠️ 대상 DB = .env DATABASE_URL(프로덕션). 미니바/부가서비스 시드와 독립.
 */
import { PrismaClient, BookingChannel, BookingStatus, Currency, DepositStatus } from "@prisma/client";

const prisma = new PrismaClient();
const TODAY = new Date("2026-06-26T00:00:00.000Z");
const FX = 18.5; // VND per KRW

const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]): T => arr[randInt(0, arr.length - 1)];
const round = (n: number, unit: number) => Math.round(n / unit) * unit;
/** UTC 자정, 오늘 기준 n일 후(음수=과거) */
function dayUtc(n: number): Date {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

const NAMES = [
  "김민준", "이서연", "박지후", "최예은", "정도윤", "강하linh", "Nguyễn Anh", "Trần My",
  "Lê Hùng", "윤서진", "임채원", "오지안", "한유나", "서준호", "Phạm Thảo", "배수아",
];

interface Spec {
  status: BookingStatus;
  /** checkOut 결정 방식 */
  kind: "past" | "present" | "future" | "hold";
}

// 분포: 과거 18 CHECKED_OUT + 2 NO_SHOW / 현재 5 CHECKED_IN / 미래 8 CONFIRMED + 3 HOLD
const SPECS: Spec[] = [
  ...Array(18).fill({ status: "CHECKED_OUT", kind: "past" } as Spec),
  ...Array(2).fill({ status: "NO_SHOW", kind: "past" } as Spec),
  ...Array(5).fill({ status: "CHECKED_IN", kind: "present" } as Spec),
  ...Array(8).fill({ status: "CONFIRMED", kind: "future" } as Spec),
  ...Array(3).fill({ status: "HOLD", kind: "hold" } as Spec),
];

async function main() {
  const villas = await prisma.villa.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  if (villas.length === 0) {
    console.log("ACTIVE 빌라 없음 — 대상 없음");
    return;
  }

  // purge
  const old = await prisma.booking.deleteMany({ where: { id: { startsWith: "demo-vs-bk-" } } });
  if (old.count > 0) console.log(`기존 demo-vs 예약 ${old.count}건 정리`);

  const counts: Record<string, number> = {};
  let revVnd = 0n;
  let revKrw = 0;

  for (let i = 0; i < SPECS.length; i++) {
    const spec = SPECS[i];

    // 날짜 결정
    let checkIn: Date, checkOut: Date, nights: number;
    if (spec.kind === "present") {
      const before = randInt(1, 3);
      const after = randInt(1, 4);
      checkIn = dayUtc(-before);
      checkOut = dayUtc(after);
      nights = before + after;
    } else if (spec.kind === "past") {
      nights = randInt(1, 5);
      checkOut = dayUtc(-randInt(2, 150));
      checkIn = new Date(checkOut);
      checkIn.setUTCDate(checkIn.getUTCDate() - nights);
    } else {
      // future / hold
      nights = randInt(1, 5);
      checkIn = dayUtc(randInt(3, spec.kind === "hold" ? 60 : 90));
      checkOut = new Date(checkIn);
      checkOut.setUTCDate(checkOut.getUTCDate() + nights);
    }

    // 채널·통화
    const channel = pick<BookingChannel>(["TRAVEL_AGENCY", "LAND_AGENCY", "DIRECT"]);
    const currency: Currency =
      channel === "TRAVEL_AGENCY" ? "KRW" : channel === "LAND_AGENCY" ? "VND" : pick<Currency>(["KRW", "VND"]);

    // 금액
    let totalSaleKrw: number | null = null;
    let totalSaleVnd: bigint | null = null;
    let fxVndPerKrw: string | null = null;
    let supplierCostVnd: bigint;
    if (currency === "VND") {
      const nightly = round(rand(2_000_000, 6_000_000), 100_000);
      const total = nightly * nights;
      totalSaleVnd = BigInt(total);
      supplierCostVnd = BigInt(round(total * rand(0.55, 0.8), 1000));
    } else {
      const nightly = round(rand(200_000, 500_000), 10_000);
      const total = nightly * nights;
      totalSaleKrw = total;
      fxVndPerKrw = FX.toFixed(4);
      const vndEquiv = total * FX;
      supplierCostVnd = BigInt(round(vndEquiv * rand(0.55, 0.8), 1000));
    }

    // 보증금 상태(상태별)
    const depositStatus: DepositStatus =
      spec.status === "CHECKED_OUT"
        ? pick<DepositStatus>(["REFUNDED", "REFUNDED", "PARTIAL_DEDUCTED"])
        : spec.status === "NO_SHOW"
          ? "PARTIAL_DEDUCTED"
          : spec.status === "CHECKED_IN"
            ? "HELD"
            : spec.status === "CONFIRMED"
              ? pick<DepositStatus>(["HELD", "NONE"])
              : "NONE";

    // 매출 집계(과거 CHECKED_OUT·NO_SHOW만 통계 산입)
    if (spec.status === "CHECKED_OUT" || spec.status === "NO_SHOW") {
      if (totalSaleVnd != null) revVnd += totalSaleVnd;
      if (totalSaleKrw != null) revKrw += totalSaleKrw;
    }

    await prisma.booking.create({
      data: {
        id: `demo-vs-bk-${i}`,
        villaId: pick(villas).id,
        status: spec.status,
        channel,
        checkIn,
        checkOut,
        nights,
        guestName: pick(NAMES),
        guestCount: randInt(2, 8),
        saleCurrency: currency,
        totalSaleKrw,
        totalSaleVnd,
        fxVndPerKrw,
        supplierCostVnd,
        depositStatus,
        breakfastIncluded: Math.random() < 0.5,
        holdExpiresAt: spec.kind === "hold" ? dayUtc(randInt(1, 2)) : null,
        createdAt: spec.kind === "past" ? new Date(checkIn) : dayUtc(-randInt(1, 30)),
      },
    });
    counts[spec.status] = (counts[spec.status] ?? 0) + 1;
  }

  console.log("완료 — 빌라 판매 샘플 생성:");
  Object.entries(counts).forEach(([s, c]) => console.log(`  ${s}: ${c}건`));
  console.log(
    `과거(CHECKED_OUT·NO_SHOW) 매출 산입 → VND ${revVnd.toLocaleString()}₫ · KRW ${revKrw.toLocaleString()}원`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
