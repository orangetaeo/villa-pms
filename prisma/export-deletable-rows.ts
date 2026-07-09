/**
 * purge 안전망 — 삭제 대상 행 전체를 JSON으로 백업 (2026-07-09).
 * pg_dump 버전 불일치(서버 PG18 vs 로컬 17)로 전체 덤프 불가 → 지워지는 데이터만 복구본 확보.
 *   실행: npx tsx --env-file=.env prisma/export-deletable-rows.ts <출력경로.json>
 * purge-test-data.ts 의 삭제 스텝과 동일 범위. Zalo/설정/운영자/데모계정은 대상 아님(보존).
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";

const prisma = new PrismaClient();
const OUT = process.argv[2] || "deletable-rows-backup.json";

// purge와 동일하게 보존되는 데모 계정
const PRESERVE_DEMO_USER_IDS = new Set<string>([
  "u-huong-cleaner", "u-asiasunny-land", "u-tyy-villa-manager",
  "u-acemassage-vendor", "seed-supplier-pilot", "demo-cleaner-hoa",
]);
const OPERATOR_ROLES = ["ADMIN", "OWNER", "MANAGER", "STAFF"];

// 삭제 대상 모델 전량(where {}) — purge 스텝과 동일 집합
const ALL_MODELS = [
  "checkoutMinibarLine", "checkOutRecord", "checkInRecord", "guestCheckinToken",
  "bookingChangeRequest", "serviceOrder", "settlementItem", "partnerReceivable",
  "proposalItem", "payment", "cleaningTask", "minibarStockMovement", "booking",
  "partnerInvoice", "settlement", "proposal", "partner", "villaMinibarStock",
  "villaRatePeriod", "villaPhoto", "villaBedroom", "villaFeature", "villaAmenity",
  "calendarBlock", "villa", "ledgerLine", "ledgerTransaction", "serviceVendor",
];

async function main() {
  const dump: Record<string, unknown[]> = {};
  let total = 0;
  for (const m of ALL_MODELS) {
    const rows = await (prisma as any)[m].findMany();
    dump[m] = rows;
    total += rows.length;
    console.log(`  ${m.padEnd(24)} ${String(rows.length).padStart(6)}`);
  }
  // 삭제 대상 유저(현재는 전원 데모 보존이라 0건 예상이나, 안전상 캡처)
  const users = await prisma.user.findMany();
  const targetUsers = users.filter(
    (u) => !OPERATOR_ROLES.includes(u.role) && !PRESERVE_DEMO_USER_IDS.has(u.id)
  );
  dump["user (삭제대상)"] = targetUsers;
  total += targetUsers.length;
  console.log(`  ${"user(삭제대상)".padEnd(24)} ${String(targetUsers.length).padStart(6)}`);

  const json = JSON.stringify(dump, (_k, v) => (typeof v === "bigint" ? `${v}n` : v), 2);
  writeFileSync(OUT, json);
  console.log(`\n✅ ${total}행 → ${OUT} (${(json.length / 1024 / 1024).toFixed(2)} MB)`);
}

main()
  .catch((e) => { console.error("❌ export 실패:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
