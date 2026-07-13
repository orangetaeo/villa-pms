// 티켓 주문 원가(costVnd) 소급 반영 (테오 지시 2026-07-13: "원가 입력을 방금 했어 — 수정해줘")
//
// 배경: 주문 생성 시 costVnd=0(운영자 확정 시 입력 설계). 카탈로그에 원가를 나중에 입력해도
//   기존 주문 스냅샷엔 반영되지 않아 벤더 정산(지급 대기)이 0₫로 잡힌다.
//   → 미정산·미취소·costVnd=0인 TICKET 주문에 카탈로그 현재 원가를 소급 스냅샷한다.
//
// 원가 산정(판매가 resolveOrderPricing과 동일 의미론):
//   단가 원가 = (선택 variant.costVnd ?? item.costVnd) + Σ(addon/modifier.costVnd)
//   라인 원가 = 단가 원가 × quantity  (PATCH 확정가와 동일하게 "라인 총액"으로 저장 — quantity 재곱 금지)
//   산정 결과 0/불명(카탈로그 원가 미입력·무료 variant)은 건너뜀(로그).
//
// ★수납·판매가·정산 완료(vendorSettledAt != null) 기록은 불변. AuditLog(UPDATE, ServiceOrder) 기록.
// 실행: npx tsx scripts/backfill-ticket-cost.ts            # dry-run
//       npx tsx scripts/backfill-ticket-cost.ts --apply    # 적용
import { PrismaClient } from "@prisma/client";
import { parseCatalogOptions, parseSelectedOptions } from "@/lib/service-catalog";
import { writeAuditLog } from "@/lib/audit-log";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

function toCost(v: string | null | undefined): bigint | null {
  if (v == null || v === "") return null;
  if (!/^\d+$/.test(v)) return null;
  return BigInt(v);
}

async function main() {
  console.log(`=== 티켓 주문 원가 소급 반영 ${APPLY ? "(APPLY)" : "(DRY-RUN)"} ===`);
  const owner = await prisma.user.findFirst({ where: { role: "OWNER" }, select: { id: true } });
  if (!owner) throw new Error("OWNER 없음");

  const orders = await prisma.serviceOrder.findMany({
    where: {
      type: "TICKET",
      costVnd: 0n,
      status: { not: "CANCELLED" },
      vendorSettledAt: null,
      catalogItemId: { not: null },
    },
    select: {
      id: true,
      quantity: true,
      priceVnd: true,
      selectedOptions: true,
      catalogItemId: true,
      booking: { select: { guestName: true, villa: { select: { name: true } } } },
    },
  });

  const itemIds = [...new Set(orders.map((o) => o.catalogItemId!).filter(Boolean))];
  const items = await prisma.serviceCatalogItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, nameKo: true, costVnd: true, options: true },
  });
  const itemMap = new Map(items.map((i) => [i.id, i]));

  let fixed = 0;
  for (const o of orders) {
    const item = itemMap.get(o.catalogItemId!);
    if (!item) {
      console.log(`  SKIP order=${o.id} — 카탈로그 품목 없음`);
      continue;
    }
    // ★무료(판매가 0) 주문 제외 — 무료 입장은 발권·벤더 지급 없음(freeEntry 의미론).
    //   여기 원가를 넣으면 costVnd>0이 되어 벤더 보드·정산의 무료 제외 필터에서 벗어나 지급 대상으로 둔갑한다.
    if (o.priceVnd === 0n) {
      console.log(
        `  SKIP [${o.booking.villa.name}/${o.booking.guestName}] ${item.nameKo} ×${o.quantity} — 무료 주문(판매가 0), 원가 0 유지`
      );
      continue;
    }
    const opts = parseCatalogOptions(item.options);
    const selected = parseSelectedOptions(o.selectedOptions);
    const variantKey = selected.find((s) => s.group === "variant")?.key ?? null;
    const variantDef = variantKey ? (opts.variants ?? []).find((v) => v.key === variantKey) : null;

    // 단가 원가: variant 대체 원가 ?? 품목 기본 원가, + addon/modifier 가산 원가
    let unitCost = variantDef ? toCost(variantDef.costVnd) : null;
    if (unitCost == null) unitCost = item.costVnd ?? null; // item.costVnd는 BigInt? 컬럼
    if (unitCost == null) unitCost = 0n;
    for (const s of selected) {
      if (s.group === "variant") continue;
      const def = [...(opts.addons ?? []), ...(opts.modifiers ?? [])].find((d) => d.key === s.key);
      const add = def ? toCost(def.costVnd) : null;
      if (add) unitCost += add;
    }
    const lineCost = unitCost * BigInt(o.quantity);
    if (lineCost <= 0n) {
      console.log(
        `  SKIP [${o.booking.villa.name}/${o.booking.guestName}] ${item.nameKo} ×${o.quantity} — 산정 원가 0(무료 variant 또는 카탈로그 원가 미입력)`
      );
      continue;
    }

    fixed += 1;
    console.log(
      `  [${o.booking.villa.name}/${o.booking.guestName}] ${item.nameKo} ×${o.quantity} (variant=${variantKey ?? "-"})` +
        `\n    costVnd: 0 → ${lineCost} (단가 ${unitCost} × ${o.quantity}) / 판매가 ${o.priceVnd}`
    );

    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        // 미정산·미취소 가드 재확인(레이스 방지) — 조건 이탈 시 미적용
        const r = await tx.serviceOrder.updateMany({
          where: { id: o.id, costVnd: 0n, vendorSettledAt: null, status: { not: "CANCELLED" } },
          data: { costVnd: lineCost },
        });
        if (r.count !== 1) {
          console.log(`    !! 경합으로 미적용 order=${o.id}`);
          return;
        }
        await writeAuditLog({
          db: tx,
          userId: owner.id,
          action: "UPDATE",
          entity: "ServiceOrder",
          entityId: o.id,
          changes: {
            reason: { new: "카탈로그 원가 입력 소급 반영 (테오 지시 2026-07-13)" },
            costVnd: { old: "0", new: lineCost.toString() },
          },
        });
      });
    }
  }
  console.log(`=== 완료 — 대상 ${orders.length}건 스캔 / 반영 ${fixed}건 ${APPLY ? "(적용됨)" : ""} ===`);
  if (!APPLY && fixed > 0) console.log("DRY-RUN — 반영하려면 --apply");
}

main()
  .catch((e) => {
    console.error("실패:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
