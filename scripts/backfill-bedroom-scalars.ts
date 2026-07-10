// 빌라 파생 스칼라 백필 (T-bedroom-composition-sync)
//
// 배경: v1.4 이전 빌라는 잠자리 구성(VillaBedroom)과 Villa.bedrooms/bathrooms/maxGuests가 별도 입력이라
//       어긋난 채 저장됐다(쏘나씨 V21: bedrooms=2 vs 실제 방 4개). bedroomDetails가 있는 빌라를 전수 재계산한다.
//
// 보정 정책(계약 §B6 — 안전 우선):
//   - bedrooms: 항상 보정 (distinct roomIndex 개수). V21 재발 방지 핵심.
//   - bathrooms: bathroomCount>0 행이 실제 있는 빌라 한정 보정(전용욕실 데이터가 없는데 0으로 덮지 않음).
//                보정값 = 전용합 + 기존 commonBathrooms.
//   - maxGuests: 리포트-only (자동 덮어쓰기 금지 — 운영자 수동 오버라이드 존중).
//
// 실행:
//   npx tsx scripts/backfill-bedroom-scalars.ts             # dry-run (기본, 리포트만)
//   npx tsx scripts/backfill-bedroom-scalars.ts --execute   # 실제 UPDATE + AuditLog
import { PrismaClient } from "@prisma/client";
import { deriveBedroomScalars, type BedroomRowInput } from "@/lib/bedding";
import { writeAuditLog } from "@/lib/audit-log";

const prisma = new PrismaClient();

const EXECUTE = process.argv.includes("--execute");
// 시스템 백필 액터 — AuditLog userId(감사 추적). 없으면 null(FK 미참조)로 기록.
const SYSTEM_ACTOR = process.env.BACKFILL_ACTOR_USER_ID ?? null;

async function main() {
  const villas = await prisma.villa.findMany({
    select: {
      id: true,
      name: true,
      bedrooms: true,
      bathrooms: true,
      maxGuests: true,
      commonBathrooms: true,
      bedroomDetails: {
        select: {
          roomIndex: true,
          roomLabel: true,
          bedType: true,
          bedCount: true,
          capacity: true,
          bathroomCount: true,
        },
      },
    },
  });

  let bedroomsFixed = 0;
  let bathroomsFixed = 0;
  let maxGuestsReport = 0;
  let scanned = 0;

  console.log(`=== 잠자리 파생 스칼라 백필 ${EXECUTE ? "(EXECUTE)" : "(DRY-RUN)"} ===`);

  for (const v of villas) {
    if (v.bedroomDetails.length === 0) continue; // bedroomDetails 없는 빌라는 대상 아님(폴백 스칼라 유지)
    scanned += 1;

    const rows: BedroomRowInput[] = v.bedroomDetails.map((b) => ({
      roomIndex: b.roomIndex,
      roomLabel: b.roomLabel,
      bedType: b.bedType,
      bedCount: b.bedCount,
      capacity: b.capacity,
      bathroomCount: b.bathroomCount,
    }));
    const derived = deriveBedroomScalars(rows, v.commonBathrooms);
    const hasBathroomData = v.bedroomDetails.some((b) => b.bathroomCount > 0);

    const update: { bedrooms?: number; bathrooms?: number } = {};
    const changes: Record<string, { old?: unknown; new?: unknown }> = {};

    // bedrooms — 항상 보정
    if (derived.bedrooms !== v.bedrooms && derived.bedrooms > 0) {
      update.bedrooms = derived.bedrooms;
      changes.bedrooms = { old: v.bedrooms, new: derived.bedrooms };
      bedroomsFixed += 1;
      console.log(`  [bedrooms] ${v.name}: ${v.bedrooms} → ${derived.bedrooms}`);
    }
    // bathrooms — 전용욕실 데이터가 실제 있는 빌라 한정
    if (hasBathroomData && derived.bathrooms > 0 && derived.bathrooms !== v.bathrooms) {
      update.bathrooms = derived.bathrooms;
      changes.bathrooms = { old: v.bathrooms, new: derived.bathrooms };
      bathroomsFixed += 1;
      console.log(
        `  [bathrooms] ${v.name}: ${v.bathrooms} → ${derived.bathrooms} (전용합+공용 ${v.commonBathrooms})`
      );
    }
    // maxGuests — 리포트-only (덮어쓰기 금지)
    if (derived.maxGuests !== undefined && derived.maxGuests !== v.maxGuests) {
      maxGuestsReport += 1;
      console.log(
        `  [maxGuests·리포트만] ${v.name}: 현재 ${v.maxGuests} vs 파생 ${derived.maxGuests} (수동 검토)`
      );
    }

    if (EXECUTE && Object.keys(update).length > 0) {
      await prisma.villa.update({ where: { id: v.id }, data: update });
      await writeAuditLog({
        userId: SYSTEM_ACTOR,
        action: "UPDATE",
        entity: "Villa",
        entityId: v.id,
        changes: { ...changes, _source: { new: "backfill-bedroom-scalars" } },
      });
    }
  }

  console.log(
    `=== 완료 — bedroomDetails 보유 ${scanned}건 / bedrooms 보정 ${bedroomsFixed} · bathrooms 보정 ${bathroomsFixed} · maxGuests 리포트 ${maxGuestsReport} ===`
  );
  if (!EXECUTE) console.log("DRY-RUN — 실제 반영하려면 --execute (승인 후)");
}

main()
  .catch((e) => {
    console.error("백필 실패:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
