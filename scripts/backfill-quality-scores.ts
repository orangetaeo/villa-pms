// 빌라 품질점수 백필 (Phase 2 — 청소 검수 통과율, v2 누적 반려 가중)
//
// 기존 빌라의 qualityScore를 AuditLog 누적 검수 이벤트(승인·반려)로 재계산한다(멱등).
// 재승인으로 status가 바뀌어 사라졌던 과거 반려까지 분모에 반영된다.
// 실행: npx tsx scripts/backfill-quality-scores.ts
//
// 산정 로직은 recomputeVillaQualityScore 재사용(v2 AuditLog 기반).
import { PrismaClient } from "@prisma/client";
import { recomputeVillaQualityScore } from "@/lib/cleaning";

const prisma = new PrismaClient();

async function main() {
  const villas = await prisma.villa.findMany({ select: { id: true, name: true } });
  let changed = 0;
  for (const v of villas) {
    const before = await prisma.villa.findUnique({
      where: { id: v.id },
      select: { qualityScore: true },
    });
    const score = await recomputeVillaQualityScore(prisma, v.id);
    if (before?.qualityScore !== score) {
      changed += 1;
      console.log(`  ${v.name}: ${before?.qualityScore} → ${score}`);
    }
  }
  console.log(`=== 품질점수 백필 완료 — 빌라 ${villas.length}건, 변경 ${changed}건 ===`);
}

main()
  .catch((e) => {
    console.error("백필 실패:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
