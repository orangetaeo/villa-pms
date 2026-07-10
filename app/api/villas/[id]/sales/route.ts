// PATCH /api/villas/[id]/sales — ADMIN 빌라 판매정보 저장 (ADR-0011, b10-sales 폼 "판매정보 저장")
// 입력 주체: 테오 팀(ADMIN 전용). 단일 폼 = 단일 $transaction:
//   ⓐ Villa 스칼라 14개 update + ⓑ VillaBedroom 전체 교체 + ⓒ VillaFeature 전체 교체.
// 누수 0: VillaRate(판매가·마진)를 일절 조회·수정하지 않는다. 판매정보는 마진 무관 필드.
//   단 wifiPassword는 AuditLog changes에서 마스킹(평문 비번 잔존 차단, ZaloAccount.credentials 선례 §4.4).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { featureRowSchema, refineFeatures, hasPoolFeatureTag } from "@/lib/features";
import { bedroomRowSchema, refineBedroomRooms, deriveBedroomScalars } from "@/lib/bedding";
import { canSetPrice } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

// VND 동 단위 양수 문자열 (기준 보증금 — BigInt는 JSON 직렬화 불가하므로 문자열 수신)
const vndDigits = z.string().regex(/^[1-9]\d{0,14}$/);
// 분 단위 시각 0~1439 (체크인/아웃)
const minuteOfDay = z.number().int().min(0).max(1439);
// 0 이상 정수 (거리·면적·층수·주차)
const nonNegInt = z.number().int().min(0);

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
    // 출입정보(accessType·accessInfo)는 별도 라우트 cleaning-info에서 관리 — 여기서 다루지 않음(진실 이중화 방지)
    // ⑤ 엑스트라베드 — 빌라 단위 토글
    extraBedAvailable: z.boolean().optional(),
    // 수영장 유무 — 셀링포인트 풀 태그가 켜지면 서버가 true로 강제 보정(아래)
    hasPool: z.boolean().optional(),
    // 공용 욕실(방 밖) — bathrooms 파생 합산에 포함 (0~10)
    commonBathrooms: nonNegInt.max(10).optional(),
    // ② 침실 구성 (전체 교체) / ⑤ 셀링포인트 태그 (전체 교체)
    bedrooms: z.array(bedroomRowSchema).max(50),
    features: z.array(featureRowSchema).max(40),
  })
  .superRefine((data, ctx) => {
    // featureKey 사전 검증 + 방 단위 동일값 검증 — 3경로 공유 (lib/features·lib/bedding)
    refineFeatures(data.features, ctx, "features");
    refineBedroomRooms(data.bedrooms, ctx, "bedrooms");
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
  set("commonBathrooms", data.commonBathrooms);
  if (data.baseDepositVnd !== undefined) {
    scalarData.baseDepositVnd = data.baseDepositVnd === null ? null : BigInt(data.baseDepositVnd);
  }
  // 수영장 자동 보정 — 셀링포인트에 풀 태그(프라이빗풀·키즈풀)가 있으면 hasPool=true 강제.
  // (해제는 자동으로 하지 않음 — 태그를 끄면 위 set()의 클라이언트 값이 그대로 반영된다)
  if (hasPoolFeatureTag(data.features)) scalarData.hasPool = true;

  // 방별 구성 → 파생 스칼라(bedrooms/bathrooms/maxGuests) 자동 갱신 — 3경로 공유 deriveBedroomScalars.
  // 침실 데이터가 있을 때만 반영 — 빈 배열(침실 전체 해제)일 땐 기존 스칼라 보존(0으로 덮지 않음, min 1 불변식).
  let normalizedBedroomRows: ReturnType<typeof deriveBedroomScalars>["rows"] = [];
  if (data.bedrooms.length > 0) {
    const derived = deriveBedroomScalars(data.bedrooms, data.commonBathrooms ?? 0);
    normalizedBedroomRows = derived.rows;
    scalarData.bedrooms = derived.bedrooms; // distinct roomIndex 개수 (V21 재발 불가)
    if (derived.bathrooms > 0) scalarData.bathrooms = derived.bathrooms; // 전용합+공용 (0이면 기존 보존)
    if (derived.maxGuests !== undefined) scalarData.maxGuests = derived.maxGuests; // 전원 capacity 존재 시만
  }

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!villa) return { kind: "NOT_FOUND" as const };

    // ⓐ Villa 스칼라 update
    await tx.villa.update({ where: { id }, data: scalarData });

    // ⓑ VillaBedroom 전체 교체 (deleteMany → createMany). roomIndex는 1..N 재정규화된 행 저장.
    await tx.villaBedroom.deleteMany({ where: { villaId: id } });
    if (normalizedBedroomRows.length > 0) {
      await tx.villaBedroom.createMany({
        data: normalizedBedroomRows.map((b) => ({
          villaId: id,
          roomIndex: b.roomIndex,
          roomLabel: b.roomLabel,
          bedType: b.bedType,
          bedCount: b.bedCount,
          capacity: b.capacity,
          bathroomCount: b.bathroomCount,
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
        // ⚠ 와이파이 비번은 평문 금지 — 마스킹 기록(ZaloAccount.credentials 선례 §4.4)
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
