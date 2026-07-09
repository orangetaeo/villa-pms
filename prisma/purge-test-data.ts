/**
 * 테스트 시드 통합 purge — 프로덕션 DB를 "실데이터 입력 준비" 상태로 전환 (T-db-reset-prep, 2026-07-09).
 *
 *   기본값 = DRY-RUN(삭제 안 함, 예상 건수만 출력). 실삭제는 --execute 플래그가 있을 때만.
 *   실행(정찰/미리보기): npx tsx --env-file=.env prisma/purge-test-data.ts
 *   실행(실삭제):        npx tsx --env-file=.env prisma/purge-test-data.ts --execute
 *   Zalo demo 잔여(demo-conv-tuan 등)까지 지우려면: PURGE_ZALO_DEMO=1 를 함께.
 *
 * ★★ 파괴적. --execute 전 반드시 DB 백업(pg_dump). 트랜잭션 래핑 — 중간 실패 시 전체 롤백.
 *
 * 보존(절대 삭제 금지):
 *   - Zalo 전부: ZaloAccount·ZaloConversation·ZaloMessage (실데이터 — 봇 세션·대화·32k 메시지)
 *   - AppSetting (24종 설정), SeasonPeriod (시즌 달력), MinibarItem (회사표준 미니바 카탈로그)
 *   - 운영자 User (role ADMIN/OWNER/MANAGER/STAFF) + 그들의 Authenticator(패스키)·PasswordResetToken
 *   - AuditLog·SecurityEvent (운영/보안 감사 로그 — 파괴적 삭제 범위 밖, 보존)
 *   - ServiceCatalogItem (부가서비스 메뉴 — config성, 기본 보존. 필요 시 아래 상수로 포함)
 *
 * 삭제 대상(전량 = 100% 시드로 실측 확인, 2026-07-09):
 *   - Villa 65 (전부 시드 공급자 소유) + 자식 전부(사진·요율·비품·침실·기능·차단·미니바재고/이동)
 *   - Booking 358 (전부 demo-*) + 자식(체크인/아웃·미니바라인·결제·채권·정산항목·제안항목·청소·변경요청·서비스주문)
 *   - Partner 1·PartnerInvoice·PartnerReceivable, Settlement/Item, Ledger, ServiceVendor 11, ServiceOrder 948
 *   - 비운영자 User 6 (SUPPLIER/CLEANER/VENDOR/PARTNER — 079123456x·seed·demo 데모계정) + 그들의 Notification/InAppNotification
 *
 * 식별 검증: 전 Villa는 u-tyy-villa-manager/seed-supplier-pilot(둘 다 시드) 소유, 전 Booking은 demo-* 접두,
 *   전 Partner/Vendor는 demo-/p-/sv- 데모. 접두 없는 실데이터 비즈니스 행 = 0건 → 전량 삭제가 정확한 타겟팅.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EXECUTE = process.argv.includes("--execute");
const PURGE_ZALO_DEMO = process.env.PURGE_ZALO_DEMO === "1";
/** true로 바꾸면 부가서비스 카탈로그(ServiceCatalogItem)도 삭제 — 완전 빈 카탈로그 원할 때만. */
const PURGE_SERVICE_CATALOG = false;

const OPERATOR_ROLES = ["ADMIN", "OWNER", "MANAGER", "STAFF"] as const;

/**
 * 시연용으로 보존하는 데모 계정(테오 결정 2026-07-09 — "데모 계정은 남기기").
 * 이 유저들은 삭제하지 않는다. 단, 그들이 소유한 빌라·예약 등 거래 데이터는 삭제되어
 * 계정은 "빈 상태"로 남는다(필요 시 seed 스크립트로 시연 데이터 재생성 가능).
 */
const PRESERVE_DEMO_USER_IDS = new Set<string>([
  "u-huong-cleaner",
  "u-asiasunny-land",
  "u-tyy-villa-manager",
  "u-acemassage-vendor",
  "seed-supplier-pilot",
  "demo-cleaner-hoa",
]);

type Step = { label: string; run: (tx: any, dry: boolean) => Promise<number> };

async function main() {
  const mode = EXECUTE ? "EXECUTE (실삭제)" : "DRY-RUN (미리보기 — 삭제 없음)";
  console.log(`\n=== purge-test-data · ${mode} ===\n`);

  // ── 삭제 대상 유저(비운영자) 산출 + 패스키 보유자 가드 ──
  const users = await prisma.user.findMany({ select: { id: true, role: true, name: true } });
  const passkeyOwners = new Set(
    (await prisma.authenticator.findMany({ select: { userId: true } })).map((a) => a.userId)
  );
  const targetUsers = users.filter(
    (u) =>
      !OPERATOR_ROLES.includes(u.role as any) &&
      !passkeyOwners.has(u.id) &&
      !PRESERVE_DEMO_USER_IDS.has(u.id)
  );
  const skippedByPasskey = users.filter(
    (u) => !OPERATOR_ROLES.includes(u.role as any) && passkeyOwners.has(u.id)
  );
  const skippedByDemo = users.filter(
    (u) => !OPERATOR_ROLES.includes(u.role as any) && PRESERVE_DEMO_USER_IDS.has(u.id)
  );
  const targetUserIds = targetUsers.map((u) => u.id);

  // deleteMany where {} = 전량. 자식 → 부모 순서(FK 위반 방지).
  const all = {};
  const forTargets = { userId: { in: targetUserIds } };

  const steps: Step[] = [
    // ── Booking 자식 ──
    step("checkoutMinibarLine", "checkoutMinibarLine", all),
    step("checkOutRecord", "checkOutRecord", all),
    step("checkInRecord", "checkInRecord", all),
    step("guestCheckinToken", "guestCheckinToken", all),
    step("bookingChangeRequest", "bookingChangeRequest", all),
    step("serviceOrder", "serviceOrder", all),
    step("settlementItem", "settlementItem", all),
    step("partnerReceivable", "partnerReceivable", all),
    step("proposalItem", "proposalItem", all),
    step("payment", "payment", all),
    step("cleaningTask", "cleaningTask", all),
    step("minibarStockMovement", "minibarStockMovement", all),
    // ── Booking ──
    step("booking", "booking", all),
    // ── Partner / 정산 / 제안 ──
    step("partnerInvoice", "partnerInvoice", all),
    step("settlement", "settlement", all),
    step("proposal", "proposal", all),
    step("partner", "partner", all),
    // ── Villa 자식 → Villa ──
    step("villaMinibarStock", "villaMinibarStock", all),
    step("villaRatePeriod", "villaRatePeriod", all),
    step("villaPhoto", "villaPhoto", all),
    step("villaBedroom", "villaBedroom", all),
    step("villaFeature", "villaFeature", all),
    step("villaAmenity", "villaAmenity", all),
    step("calendarBlock", "calendarBlock", all),
    step("villa", "villa", all),
    // ── Ledger ──
    step("ledgerLine", "ledgerLine", all),
    step("ledgerTransaction", "ledgerTransaction", all),
    // ── Vendor ──
    step("serviceVendor", "serviceVendor", all),
    // ── 비운영자 유저 알림(유저 삭제 선행: Notification은 user에 RESTRICT) ──
    step("notification (대상 유저)", "notification", forTargets),
    step("inAppNotification (대상 유저)", "inAppNotification", forTargets),
    // ── 비운영자 User ──
    step("user (비운영자)", "user", { id: { in: targetUserIds } }),
  ];

  if (PURGE_SERVICE_CATALOG) {
    steps.splice(
      steps.findIndex((s) => s.label === "serviceVendor"),
      0,
      step("serviceCatalogItem", "serviceCatalogItem", all)
    );
  }

  if (PURGE_ZALO_DEMO) {
    steps.unshift(
      step("zaloMessage (demo- 잔여)", "zaloMessage", { id: { startsWith: "demo-" } }),
      step("zaloConversation (demo- 잔여)", "zaloConversation", { id: { startsWith: "demo-" } })
    );
  }

  // ── 실행 ──
  const results: Record<string, number> = {};
  const runAll = async (tx: any, dry: boolean) => {
    for (const s of steps) results[s.label] = await s.run(tx, dry);
  };

  if (EXECUTE) {
    await prisma.$transaction(async (tx) => runAll(tx, false), { timeout: 120_000 });
  } else {
    await runAll(prisma, true);
  }

  // ── 출력 ──
  let total = 0;
  const w = Math.max(...steps.map((s) => s.label.length));
  console.log("삭제 " + (EXECUTE ? "완료" : "예정") + " 건수 (자식→부모 순):");
  for (const s of steps) {
    const n = results[s.label];
    total += n;
    console.log(`  ${s.label.padEnd(w)}  ${String(n).padStart(6)}`);
  }
  console.log(`  ${"─".repeat(w + 8)}`);
  console.log(`  ${"합계".padEnd(w)}  ${String(total).padStart(6)}\n`);

  if (skippedByPasskey.length) {
    console.log("⚠ 패스키 보유로 삭제 제외된 비운영자 유저(수동 확인 필요):");
    for (const u of skippedByPasskey) console.log(`   - ${u.id} (${u.role}, ${u.name})`);
    console.log("");
  }
  if (skippedByDemo.length) {
    console.log("🎭 시연용 보존 데모 계정(삭제 제외 — 데이터만 비워짐):");
    for (const u of skippedByDemo) console.log(`   - ${u.id} (${u.role}, ${u.name})`);
    console.log("");
  }
  console.log("삭제 대상 유저(비운영자):", targetUserIds.join(", ") || "(없음)");

  // ── 보존 확인(읽기) ──
  const preserved = {
    zaloConversation: await prisma.zaloConversation.count(),
    zaloMessage: await prisma.zaloMessage.count(),
    zaloAccount: await prisma.zaloAccount.count(),
    appSetting: await prisma.appSetting.count(),
    seasonPeriod: await prisma.seasonPeriod.count(),
    minibarItem: await prisma.minibarItem.count(),
    serviceCatalogItem: await prisma.serviceCatalogItem.count(),
    auditLog: await prisma.auditLog.count(),
    securityEvent: await prisma.securityEvent.count(),
    authenticator: await prisma.authenticator.count(),
    "user(운영자)": await prisma.user.count({ where: { role: { in: OPERATOR_ROLES as any } } }),
  };
  console.log("\n보존 확인(현재 잔존 — DRY-RUN이면 삭제 전 값):");
  for (const [k, v] of Object.entries(preserved)) console.log(`  ${k.padEnd(20)}  ${v}`);

  if (PURGE_ZALO_DEMO) console.log("\n(PURGE_ZALO_DEMO=1 — demo- 접두 Zalo 잔여도 삭제 대상에 포함됨)");
  else console.log("\nⓘ Zalo demo- 잔여(demo-conv/msg)는 기본 보존. 지우려면 PURGE_ZALO_DEMO=1.");
  console.log(EXECUTE ? "\n✅ 실삭제 완료." : "\nⓘ DRY-RUN 종료 — 실삭제하려면 --execute (백업 후!).");
}

function step(label: string, model: string, where: any): Step {
  return {
    label,
    run: async (client: any, dry: boolean) => {
      if (dry) return client[model].count({ where });
      return (await client[model].deleteMany({ where })).count;
    },
  };
}

main()
  .catch((e) => {
    console.error("❌ purge 실패(롤백됨):", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
