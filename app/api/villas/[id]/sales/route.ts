// PATCH /api/villas/[id]/sales — ADMIN 빌라 판매정보 저장 (ADR-0011, b10-sales 폼 "판매정보 저장")
// 입력 주체: 테오 팀(ADMIN 전용). 단일 폼 = 단일 $transaction:
//   ⓐ Villa 스칼라 14개 update + ⓑ VillaBedroom 전체 교체 + ⓒ VillaFeature 전체 교체.
// 누수 0: VillaRate(판매가·마진)를 일절 조회·수정하지 않는다. 판매정보는 마진 무관 필드.
//   단 wifiPassword는 AuditLog changes에서 마스킹(평문 비번 잔존 차단, ZaloAccount.credentials 선례 §4.4).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isValidFeature, type FeatureCategoryKey } from "@/lib/features";
import { BED_TYPES } from "@/lib/bedding";
import { canSetPrice } from "@/lib/permissions";

// VND 동 단위 양수 문자열 (기준 보증금 — BigInt는 JSON 직렬화 불가하므로 문자열 수신)
const vndDigits = z.string().regex(/^[1-9]\d{0,14}$/);
// 분 단위 시각 0~1439 (체크인/아웃)
const minuteOfDay = z.number().int().min(0).max(1439);
// 0 이상 정수 (거리·면적·층수·주차)
const nonNegInt = z.number().int().min(0);

const bedroomSchema = z.object({
  roomIndex: z.number().int().min(1).max(50),
  roomLabel: z.string().trim().min(1).max(60).optional(),
  bedType: z.enum(BED_TYPES), // enum 화이트리스트 — 임의 bedType 차단
  bedCount: z.number().int().min(1).max(20),
  capacity: z.number().int().min(1).max(50).optional(),
});

const featureSchema = z.object({
  category: z.enum(["VIEW", "FACILITY", "LOCATION"]),
  featureKey: z.string().min(1).max(50),
});

const salesPatchSchema = z
  .object({
    // ③ 위치·접근성 — 모두 정수, nullable. null = 미입력으로 클리어
    googleMapUrl: z.string().url().startsWith("https://").max(2000).nullable().optional(),
    beachDistanceM: nonNegInt.max(100000).nullable().optional(),
    areaSqm: nonNegInt.max(100000).nullable().optional(),
    floors: z.number().int().min(1).max(100).nullable().optional(),
    // ④ 이용규칙
    checkInTime: minuteOfDay.optional(),
    checkOutTime: minuteOfDay.optional(),
    smokingAllowed: z.boolean().optional(),
    petsAllowed: z.boolean().optional(),
    partyAllowed: z.boolean().optional(),
    parkingSlots: nonNegInt.max(999).optional(),
    baseDepositVnd: vndDigits.nullable().optional(),
    wifiSsid: z.string().trim().max(100).nullable().optional(),
    wifiPassword: z.string().trim().max(100).nullable().optional(),
    // ⑤ 엑스트라베드 — 빌라 단위 토글
    extraBedAvailable: z.boolean().optional(),
    // ② 침실 구성 (전체 교체) / ⑤ 셀링포인트 태그 (전체 교체)
    bedrooms: z.array(bedroomSchema).max(50),
    features: z.array(featureSchema).max(40),
  })
  .superRefine((data, ctx) => {
    // featureKey 사전 검증 — category 정합 + 임의값 주입 차단 (custom 미허용)
    const seenFeatures = new Set<string>();
    data.features.forEach((f, index) => {
      if (!isValidFeature(f.category as FeatureCategoryKey, f.featureKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["features", index, "featureKey"],
          message: `Unknown feature: ${f.category}/${f.featureKey}`,
        });
      }
      // @@unique([villaId, featureKey]) — 중복 키 사전 차단 (createMany 충돌 방지)
      if (seenFeatures.has(f.featureKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["features", index, "featureKey"],
          message: `Duplicate feature: ${f.featureKey}`,
        });
      }
      seenFeatures.add(f.featureKey);
    });
    // 같은 roomIndex 행들의 capacity는 동일값이어야 함 (침실 단위 1값 — 설계 §1.2)
    const capByRoom = new Map<number, number | undefined>();
    data.bedrooms.forEach((b, index) => {
      if (capByRoom.has(b.roomIndex)) {
        const prev = capByRoom.get(b.roomIndex);
        if (prev !== b.capacity) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["bedrooms", index, "capacity"],
            message: `roomIndex ${b.roomIndex} capacity mismatch`,
          });
        }
      } else {
        capByRoom.set(b.roomIndex, b.capacity);
      }
    });
  });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙). SUPPLIER/CLEANER/비로그인 차단
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canSetPrice(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const actorUserId = session.user.id;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = salesPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // 스칼라 update 페이로드 — 전달된 키만 반영(부분 업데이트). undefined는 미변경, null은 클리어
  const scalarData: Record<string, unknown> = {};
  const set = <K extends keyof typeof data>(key: K, value: unknown) => {
    if (value !== undefined) scalarData[key as string] = value;
  };
  set("googleMapUrl", data.googleMapUrl);
  set("beachDistanceM", data.beachDistanceM);
  set("areaSqm", data.areaSqm);
  set("floors", data.floors);
  set("checkInTime", data.checkInTime);
  set("checkOutTime", data.checkOutTime);
  set("smokingAllowed", data.smokingAllowed);
  set("petsAllowed", data.petsAllowed);
  set("partyAllowed", data.partyAllowed);
  set("parkingSlots", data.parkingSlots);
  set("wifiSsid", data.wifiSsid);
  set("wifiPassword", data.wifiPassword);
  set("extraBedAvailable", data.extraBedAvailable);
  if (data.baseDepositVnd !== undefined) {
    scalarData.baseDepositVnd = data.baseDepositVnd === null ? null : BigInt(data.baseDepositVnd);
  }

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!villa) return { kind: "NOT_FOUND" as const };

    // ⓐ Villa 스칼라 update
    await tx.villa.update({ where: { id }, data: scalarData });

    // ⓑ VillaBedroom 전체 교체 (deleteMany → createMany)
    await tx.villaBedroom.deleteMany({ where: { villaId: id } });
    if (data.bedrooms.length > 0) {
      await tx.villaBedroom.createMany({
        data: data.bedrooms.map((b) => ({
          villaId: id,
          roomIndex: b.roomIndex,
          roomLabel: b.roomLabel ?? null,
          bedType: b.bedType,
          bedCount: b.bedCount,
          capacity: b.capacity ?? null,
        })),
      });
    }

    // ⓒ VillaFeature 전체 교체 (deleteMany → createMany)
    await tx.villaFeature.deleteMany({ where: { villaId: id } });
    if (data.features.length > 0) {
      await tx.villaFeature.createMany({
        data: data.features.map((f) => ({
          villaId: id,
          category: f.category,
          featureKey: f.featureKey,
        })),
      });
    }

    // ── AuditLog (글로벌 규칙) — entity Villa/VillaBedroom/VillaFeature ──
    // ⚠ wifiPassword는 changes에서 마스킹 — 평문 비번이 AuditLog에 남으면 안 됨 (§4.4)
    const scalarChanges: Record<string, { old?: unknown; new?: unknown }> = {};
    for (const [key, value] of Object.entries(scalarData)) {
      if (key === "wifiPassword") {
        scalarChanges.wifiPassword = { old: "***", new: "***" };
      } else if (key === "baseDepositVnd") {
        // BigInt는 Json 컬럼에 못 넣으므로 문자열화 (null이면 그대로)
        scalarChanges.baseDepositVnd = { new: value === null ? null : String(value) };
      } else {
        scalarChanges[key] = { new: value };
      }
    }
    if (Object.keys(scalarChanges).length > 0) {
      await writeAuditLog({
        db: tx,
        userId: actorUserId,
        action: "UPDATE",
        entity: "Villa",
        entityId: id,
        changes: scalarChanges,
      });
    }
    // 자식 테이블은 전체 교체(삭제 후 재생성)이므로 개수 스냅샷으로 기록
    await writeAuditLog({
      db: tx,
      userId: actorUserId,
      action: "UPDATE",
      entity: "VillaBedroom",
      entityId: id,
      changes: { count: { new: data.bedrooms.length } },
    });
    await writeAuditLog({
      db: tx,
      userId: actorUserId,
      action: "UPDATE",
      entity: "VillaFeature",
      entityId: id,
      changes: { count: { new: data.features.length } },
    });

    return { kind: "OK" as const };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // 응답에는 id·개수만 (마진/판매가/KRW·wifiPassword 미포함)
  return NextResponse.json({
    id,
    bedroomCount: data.bedrooms.length,
    featureCount: data.features.length,
  });
}
