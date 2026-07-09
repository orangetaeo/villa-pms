import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const accts = await prisma.zaloAccount.findMany({
    include: { user: { select: { name: true } } },
  });
  console.log("=== ZaloAccount (발신/개인 봇 세션) ===");
  for (const a of accts) {
    console.log(
      `  kind=${(a as any).kind.padEnd(14)} owner=${((a as any).user?.name ?? "?").padEnd(10)} ` +
      `display=${((a as any).displayName ?? "?").padEnd(14)} ` +
      `active=${(a as any).isActive} cred=${(a as any).credentials ? "있음" : "❌없음"} ` +
      `lastConnected=${(a as any).lastConnected?.toISOString() ?? "-"}`
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
