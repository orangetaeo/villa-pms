// PATCH /api/villas/[id]/sales — ADMIN 빌라 판매정보 저장 (ADR-0011, b10-sales 폼 "판매정보 저장")
// 입력 주체: 테오 팀(ADMIN 전용). 단일 폼 = 단일 $transaction:
//   ⓐ Villa 스칼라 14개 update + ⓑ VillaBedroom 전체 교체 + ⓒ VillaFeature 전체 교체.
// 누수 0: VillaRate(판매가·마진)를 일절 조회·수정하지 않는다. 판매정보는 마진 무관 필드.
//   단 wifiPassword는 AuditLog changes에서 마스킹(평문 비번 잔존 차단, ZaloAccount.credentials 선례 §4.4).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isValidFeature, type FeatureCategoryKey } from "@/lib/features";
import { BED_TYPES } from "@/lib/bedding";
import { canSetPrice } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

// VND 동 단위 양수 문자열 (기준 보증금 — BigInt는 JSON 직렬화 불가하므로 문자열 수신)
const vndDigits = z.string().regex(/^[1-9]\d{0,14}$/);
// 분 단위 시각 0~1439 (체크인/아웃)
const minuteOfDay = z.number().int().min(0).max(1439);
// 0 이상 정수 (거리·면적·층수·주차)
const nonNegInt = z.number().int().min(0);

const bedroomSchema = z.object({
  roomIndex: z.number().int().min(1).max(50),
  roomLabel: z.string().trim().min(1).max(60).nullable().optional(), // 라벨 미입력 시 클라이언트가 null 전송
  bedType: z.enum(BED_TYPES), // enum 화이트리스트 — 임의 bedType 차단
  bedCount: z.number().int().min(1).max(20),
  capacity: z.number().int().min(1).max(50).nullable().optional(), // 수용인원 0(미입력) 시 null 전송
  bathroomCount: z.number().int().min(0).max(20).optional(), // 이 침실 전용욕실 개수 (0=없음)
});

const featureSchema = z.object({
  category: z.enum(["VIEW", "FACILITY", "LOCATION"]),
  featureKey: z.string().min(1).max(50),
});

const salesPatchSchema = z
  .object({
    // 공급 출처 — DIRECT면 공실 보드에 우리 판매예약이 표시됨 (T-availability-direct-booking-popover)
    source: z.enum(["SUPPLIER", "DIRECT"]).optional(),
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
    // 수영장 유무 — 셀링포인트 풀 태그가 켜지면 서버가 true로 강제 보정(아래)
    hasPool: z.boolean().optional(),
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
    // null(미입력)·undefined는 동일 취급 → ?? null로 정규화 후 비교
    const capByRoom = new Map<number, number | null>();
    data.bedrooms.forEach((b, index) => {
      const cap = b.capacity ?? null;
      if (capByRoom.has(b.roomIndex)) {
        const prev = capByRoom.get(b.roomIndex);
        if (prev !== cap) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["bedrooms", index, "capacity"],
            message: `roomIndex ${b.roomIndex} capacity mismatch`,
          });
        }
      } else {
        capByRoom.set(b.roomIndex, cap);
      }
    });
    // 같은 roomIndex 행들의 bathroomCount도 동일값이어야 함 (침실 단위 1값 — 자동 합산 정합)
    const bathByRoom = new Map<number, number>();
    data.bedrooms.forEach((b, index) => {
      const bath = b.bathroomCount ?? 0;
      if (bathByRoom.has(b.roomIndex)) {
        if (bathByRoom.get(b.roomIndex) !== bath) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["bedrooms", index, "bathroomCount"],
            message: `roomIndex ${b.roomIndex} bathroomCount mismatch`,
          });
        }
      } else {
        bathByRoom.set(b.roomIndex, bath);
      }
    });
  });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙). SUPPLIER/CLEANER/비로그인 차단
  const g = await requireCapability(canSetPrice, "canSetPrice", req);
  if (!g.ok) return g.response;
  const session = g.session;
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
  set("source", data.source);
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
  set("hasPool", data.hasPool);
  if (data.baseDepositVnd !== undefined) {
    scalarData.baseDepositVnd = data.baseDepositVnd === null ? null : BigInt(data.baseDepositVnd);
  }
  // 수영장 자동 보정 — 셀링포인트에 풀 태그(프라이빗풀·키즈풀)가 있으면 hasPool=true 강제.
  // (해제는 자동으로 하지 않음 — 태그를 끄면 위 set()의 클라이언트 값이 그대로 반영된다)
  const hasPoolFeature = data.features.some(
    (f) => f.featureKey === "privatePool" || f.featureKey === "kidsPool"
  );
  if (hasPoolFeature) scalarData.hasPool = true;

  // 침실별 전용욕실 합계 → Villa.bathrooms 자동 갱신 (같은 roomIndex 행은 동일값이므로 roomIndex별 1회만 합산).
  // 침실 데이터가 있을 때만 반영 — 빈 배열(침실 전체 해제)일 땐 기존 bathrooms 보존(0으로 덮지 않음).
  if (data.bedrooms.length > 0) {
    const bathByRoom = new Map<number, number>();
    for (const b of data.bedrooms) {
      if (!bathByRoom.has(b.roomIndex)) bathByRoom.set(b.roomIndex, b.bathroomCount ?? 0);
    }
    let bathroomSum = 0;
    for (const v of bathByRoom.values()) bathroomSum += v;
    scalarData.bathrooms = bathroomSum;
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
          bathroomCount: b.bathroomCount ?? 0,
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
