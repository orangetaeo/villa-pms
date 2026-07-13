// PATCH /api/villas/[id]/info — 공급자 이용규칙·위치/규모 자가 수정 (테오 요청: 규칙은 공급자 영역)
// 입력 주체: SUPPLIER 본인 빌라(supplierId 스코프) 또는 운영자(모든 빌라). 그 외 차단.
// ADMIN 전용 sales 라우트(/sales)와 분리 — 공급자가 만질 수 있는 "사실 속성"만 받는다:
//   이용규칙(체크인/아웃·금연/반려동물/파티·주차·보증금·엑스트라베드) + 셀링포인트(features)
//   + 와이파이(ssid/pw)·출입정보(accessType/accessInfo, ⚠비공개) + 위치/규모(지도·해변거리·면적·층수).
// ⛔ 미수신(공급자 권한 밖): source(SUPPLIER/DIRECT)·bedrooms(파생 스칼라)·요율/판매가/마진·승인상태·name/complex.
//   → salePrice/margin/KRW 일절 조회·수정 없음(누수 0). 승인 게이트 무관(표기·안내용) → status 불변.
//   ⚠ wifiPassword는 AuditLog에서 마스킹(평문 비번 잔존 차단, sales 라우트 §4.4 선례).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireAuth } from "@/lib/api-guard";
import { maybeNotifyVillaContentUpdated } from "@/lib/villa-notify";
import { featureRowSchema, refineFeatures, hasPoolFeatureTag } from "@/lib/features";
import { ACCESS_TYPES } from "@/lib/villa-schema";

// VND 동 단위 양수 문자열 (기준 보증금 — BigInt는 JSON 직렬화 불가하므로 문자열 수신)
const vndDigits = z.string().regex(/^[1-9]\d{0,14}$/);
const minuteOfDay = z.number().int().min(0).max(1439); // 체크인/아웃 분 단위
const nonNegInt = z.number().int().min(0);

const infoPatchSchema = z
  .object({
    // ④ 이용규칙
    checkInTime: minuteOfDay.optional(),
    checkOutTime: minuteOfDay.optional(),
    smokingAllowed: z.boolean().optional(),
    petsAllowed: z.boolean().optional(),
    partyAllowed: z.boolean().optional(),
    parkingSlots: nonNegInt.max(999).optional(),
    baseDepositVnd: vndDigits.nullable().optional(), // null = 미입력(클리어)
    extraBedAvailable: z.boolean().optional(),
    // 와이파이·출입정보 — ⚠ 비공개(고객 미노출). null = 클리어
    wifiSsid: z.string().trim().max(100).nullable().optional(),
    wifiPassword: z.string().trim().max(100).nullable().optional(),
    accessType: z.enum(ACCESS_TYPES).nullable().optional(), // 출입 방식 화이트리스트(sales/cleaning-info와 공유)
    accessInfo: z.string().trim().max(500).nullable().optional(),
    // ③ 위치·규모
    googleMapUrl: z.string().url().startsWith("https://").max(2000).nullable().optional(),
    beachDistanceM: nonNegInt.max(100000).nullable().optional(),
    areaSqm: nonNegInt.max(100000).nullable().optional(),
    floors: z.number().int().min(1).max(100).nullable().optional(),
    // ⑤ 셀링포인트 태그 — 전달 시에만 전체 교체(deleteMany→createMany). 미전달=기존 보존
    features: z.array(featureRowSchema).max(40).optional(),
  })
  .superRefine((data, ctx) => {
    // featureKey 사전 검증 — features가 undefined면 [] 순회로 스킵(3경로 공유 lib/features)
    refineFeatures(data.features ?? [], ctx, "features");
  });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const session = g.session;
  // SUPPLIER(자기 빌라만) 또는 운영자(모든 빌라) — 그 외 차단
  const isSupplier = session.user.role === "SUPPLIER";
  if (!isSupplier && !isOperator(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const actorId = session.user.id;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = infoPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // 전달된 키만 반영(부분 업데이트). undefined=미변경, null=클리어.
  const scalarData: Record<string, unknown> = {};
  const set = <K extends keyof typeof data>(key: K, value: unknown) => {
    if (value !== undefined) scalarData[key as string] = value;
  };
  set("checkInTime", data.checkInTime);
  set("checkOutTime", data.checkOutTime);
  set("smokingAllowed", data.smokingAllowed);
  set("petsAllowed", data.petsAllowed);
  set("partyAllowed", data.partyAllowed);
  set("parkingSlots", data.parkingSlots);
  set("extraBedAvailable", data.extraBedAvailable);
  set("wifiSsid", data.wifiSsid);
  set("wifiPassword", data.wifiPassword);
  set("accessType", data.accessType);
  set("accessInfo", data.accessInfo);
  set("googleMapUrl", data.googleMapUrl);
  set("beachDistanceM", data.beachDistanceM);
  set("areaSqm", data.areaSqm);
  set("floors", data.floors);
  if (data.baseDepositVnd !== undefined) {
    scalarData.baseDepositVnd = data.baseDepositVnd === null ? null : BigInt(data.baseDepositVnd);
  }
  // 수영장 자동 보정 — 셀링포인트에 풀 태그(프라이빗풀·키즈풀)가 있으면 hasPool=true 강제.
  // (해제는 자동으로 하지 않음 — sales 라우트 §108~110 동일 규칙)
  if (data.features && hasPoolFeatureTag(data.features)) scalarData.hasPool = true;

  // 스칼라도 features도 없으면 변경할 것이 없음. features만 전달되면 통과(태그 전체 교체).
  if (Object.keys(scalarData).length === 0 && data.features === undefined) {
    return NextResponse.json({ error: "NO_FIELDS" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id },
      select: { id: true, supplierId: true },
    });
    // 미존재 404. SUPPLIER는 타인 빌라도 404(존재 미누설). 운영자는 모든 빌라 허용.
    if (!villa) return { kind: "NOT_FOUND" as const };
    if (isSupplier && villa.supplierId !== actorId) return { kind: "NOT_FOUND" as const };

    // 스칼라가 있을 때만 update (features만 전달되면 스칼라 no-op 방지)
    if (Object.keys(scalarData).length > 0) {
      await tx.villa.update({ where: { id }, data: scalarData });
    }

    // 셀링포인트 전체 교체 — 전달된 경우에만(deleteMany→createMany, sales 라우트 ⓒ 패턴)
    if (data.features !== undefined) {
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
    }

    // ── AuditLog (글로벌 규칙) — wifiPassword 마스킹, baseDepositVnd BigInt 문자열화 ──
    const changes: Record<string, { new?: unknown }> = {};
    for (const [key, value] of Object.entries(scalarData)) {
      if (key === "wifiPassword") {
        // ⚠ 와이파이 비번은 평문 금지 — 마스킹 기록(sales 라우트 §4.4 선례)
        changes.wifiPassword = { new: "(hidden)" };
      } else if (key === "baseDepositVnd") {
        changes.baseDepositVnd = { new: value === null ? null : String(value) };
      } else {
        changes[key] = { new: value };
      }
    }
    if (Object.keys(changes).length > 0) {
      await writeAuditLog({
        db: tx,
        userId: actorId,
        action: "UPDATE",
        entity: "Villa",
        entityId: id,
        changes,
      });
    }
    // 셀링포인트는 전체 교체이므로 개수 스냅샷으로 별도 기록(sales 라우트와 동일)
    if (data.features !== undefined) {
      await writeAuditLog({
        db: tx,
        userId: actorId,
        action: "UPDATE",
        entity: "VillaFeature",
        entityId: id,
        changes: { count: { new: data.features.length } },
      });
    }

    return { kind: "OK" as const };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // 승인 후 공급자 이용규칙·위치 변경 → 운영자 통지 (ACTIVE만·PENDING dedup·best-effort)
  await maybeNotifyVillaContentUpdated(prisma, {
    villaId: id,
    kind: "INFO",
    actorRole: session.user.role,
  });
  // 응답에는 id·개수만 (마진/판매가/KRW·wifiPassword 미포함)
  return NextResponse.json({
    id,
    updated: Object.keys(scalarData).length,
    featureCount: data.features?.length ?? null,
  });
}
