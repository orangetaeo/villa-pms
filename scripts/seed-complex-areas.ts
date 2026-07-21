// 지역(단지) 마스터 초기 시드 — T-complex-area-master (ADR-0046)
// 멱등(code 기준 upsert). 실행: npx tsx scripts/seed-complex-areas.ts
// ★실DB 실데이터 환경(2026-07-15 와이프 이후) — upsert·connect만, 삭제/초기화 없음.
//   초기 데이터 시드이므로 AuditLog 불요. 이후 ComplexArea CRUD API는 writeAuditLog 필수(FE 담당).
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// name = 라틴 정본(매칭·Villa.complex 캐시), nameKo = 운영자 병기 전용(매칭 금지)
const MASTERS = [
  { code: "sonasea", name: "Sonasea", nameKo: "쏘나씨", sortOrder: 10 },
  { code: "sunset-sanato", name: "Sunset Sanato", nameKo: "썬셋 사나토", sortOrder: 20 },
  { code: "vinpearl", name: "Vinpearl", nameKo: "빈펄", sortOrder: 30 },
  { code: "greenbay", name: "Greenbay", nameKo: "그린베이", sortOrder: 40 },
];

async function main() {
  for (const m of MASTERS) {
    const row = await prisma.complexArea.upsert({
      where: { code: m.code },
      create: m,
      update: { name: m.name, nameKo: m.nameKo, sortOrder: m.sortOrder },
    });
    console.log(`upsert ${row.code} → ${row.name} (${row.nameKo}) id=${row.id}`);
  }

  // 기존 complex="Sonasea" 빌라를 Sonasea 마스터에 연결 (멱등 — 이미 연결된 행은 조건에서 제외)
  const sonasea = await prisma.complexArea.findUniqueOrThrow({ where: { code: "sonasea" } });
  const linked = await prisma.villa.updateMany({
    where: { complex: "Sonasea", complexAreaId: null },
    data: { complexAreaId: sonasea.id },
  });
  console.log(`\nVilla(complex="Sonasea") → complexAreaId 연결: ${linked.count}건 (이미 연결분 제외)`);

  // 확인 출력
  const areas = await prisma.complexArea.findMany({ orderBy: { sortOrder: "asc" } });
  console.log(`\n=== ComplexArea ${areas.length}행 ===`);
  for (const a of areas) console.log(`  ${a.code.padEnd(14)} ${a.name.padEnd(14)} ${a.nameKo ?? ""} active=${a.active}`);
  const villas = await prisma.villa.findMany({ select: { id: true, name: true, complex: true, complexAreaId: true } });
  console.log(`\n=== Villa 연결 상태 (${villas.length}개) ===`);
  for (const v of villas) console.log(`  ${v.name} complex=${JSON.stringify(v.complex)} complexAreaId=${v.complexAreaId ?? "null"}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
