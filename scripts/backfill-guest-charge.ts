// 게스트 청구 캐시 재계산 백필 (T-guest-bill-double-count-fix, P1 과청구 수정)
//
// 배경: computeGuestBill이 과거 ServiceOrder의 priceVnd(원천)와 priceKrw(표시 스냅샷)를
//       각각 합산해 같은 금액을 ₫+₩로 이중 청구했다. CheckOutRecord.guestChargeVnd/Krw 캐시가
//       과대 저장된 CHECKED_OUT 레코드가 있으므로 새 규칙(원천 통화 1회 계상)으로 재계산한다.
//
// 규칙(computeGuestBill 재사용 — 단일 원천):
//   guestChargeVnd = Σ미니바 라인(lineVnd) + Σ서비스(priceVnd != null인 것의 priceVnd)
//   guestChargeKrw = Σ서비스(priceVnd == null && priceKrw > 0인 것의 priceKrw)
//   서비스 주문 조회 = 체크아웃 당시와 동일 조건(status CONFIRMED|DELIVERED).
//
// ★수납·보증금 기록(settledVnd/Krw/Usd·deductionVnd·settlementLines)은 절대 건드리지 않는다.
//   guestChargeVnd/Krw(청구 캐시)만 UPDATE. 감사 로그 없이 캐시 컬럼만 정정(계약 §4).
//
// 실행:
//   npx tsx scripts/backfill-guest-charge.ts            # dry-run (기본, before/after 리포트만)
//   npx tsx scripts/backfill-guest-charge.ts --apply    # 실제 UPDATE (승인 후, 메인 세션이 실행)
import { PrismaClient, ServiceOrderStatus } from "@prisma/client";
import { computeGuestBill } from "@/lib/checkout-settlement";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

function eqVnd(a: bigint | null, b: bigint | null): boolean {
  return (a ?? 0n) === (b ?? 0n);
}
function eqKrw(a: number | null, b: number | null): boolean {
  return (a ?? 0) === (b ?? 0);
}

async function main() {
  console.log(`=== 게스트 청구 캐시 백필 ${APPLY ? "(APPLY)" : "(DRY-RUN)"} ===`);

  // CHECKED_OUT 예약의 체크아웃 레코드 — 미니바 라인(lineVnd)만 판매액. 수납·보증금은 조회만(불변).
  //   ★스코프: 캐시가 실제 기록된(non-null) 레코드만 — 이중 계상 버그로 "잘못 저장된" 값의 정정이 목적.
  //   캐시 null(청구 기능 도입 전·청구 0 레코드)에 새 값을 채우는 건 역사 기록 생성이라 범위 밖(정정 아님).
  const records = await prisma.checkOutRecord.findMany({
    where: {
      booking: { status: "CHECKED_OUT" },
      OR: [{ guestChargeVnd: { not: null } }, { guestChargeKrw: { not: null } }],
    },
    select: {
      id: true,
      bookingId: true,
      guestChargeVnd: true,
      guestChargeKrw: true,
      minibarLines: { select: { lineVnd: true } },
      booking: { select: { guestName: true } },
    },
  });

  let scanned = 0;
  let changed = 0;

  for (const r of records) {
    scanned += 1;
    const svcOrders = await prisma.serviceOrder.findMany({
      where: {
        bookingId: r.bookingId,
        status: { in: [ServiceOrderStatus.CONFIRMED, ServiceOrderStatus.DELIVERED] },
      },
      select: { priceVnd: true, priceKrw: true },
    });

    const minibarChargeVnd = r.minibarLines.reduce((acc, m) => acc + m.lineVnd, 0n);
    const bill = computeGuestBill(minibarChargeVnd, svcOrders);
    const newVnd = bill.totalVnd > 0n ? bill.totalVnd : null;
    const newKrw = bill.totalKrw > 0 ? bill.totalKrw : null;

    if (eqVnd(r.guestChargeVnd, newVnd) && eqKrw(r.guestChargeKrw, newKrw)) continue;

    changed += 1;
    console.log(
      `  [${r.booking.guestName}] record=${r.id}\n` +
        `    guestChargeVnd: ${r.guestChargeVnd ?? "null"} → ${newVnd ?? "null"}\n` +
        `    guestChargeKrw: ${r.guestChargeKrw ?? "null"} → ${newKrw ?? "null"}`
    );

    if (APPLY) {
      await prisma.checkOutRecord.update({
        where: { id: r.id },
        data: { guestChargeVnd: newVnd, guestChargeKrw: newKrw },
      });
    }
  }

  console.log(
    `=== 완료 — CHECKED_OUT ${scanned}건 스캔 / 정정 대상 ${changed}건 ${APPLY ? "(적용됨)" : ""} ===`
  );
  if (!APPLY && changed > 0) console.log("DRY-RUN — 실제 반영하려면 --apply (승인 후)");
}

main()
  .catch((e) => {
    console.error("백필 실패:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
