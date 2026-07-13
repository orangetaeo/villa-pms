// PATCH /api/villas/[id]/info — 공급자 이용규칙·위치/규모 자가 수정 (테오 요청: 규칙은 공급자 영역)
// 입력 주체: SUPPLIER 본인 빌라(supplierId 스코프) 또는 운영자(모든 빌라). 그 외 차단.
// ADMIN 전용 sales 라우트(/sales)와 분리 — 공급자가 만질 수 있는 "사실 속성"만 받는다:
//   이용규칙(체크인/아웃·금연/반려동물/파티·주차·보증금·엑스트라베드) + 위치/규모(지도·해변거리·면적·층수).
// ⛔ 미수신(공급자 권한 밖): source(SUPPLIER/DIRECT)·features(마케팅)·bedrooms·wifi·요율/판매가/마진·승인상태·name/complex.
//   → salePrice/margin/KRW 일절 조회·수정 없음(누수 0). 승인 게이트 무관(표기·안내용) → status 불변.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireAuth } from "@/lib/api-guard";
import { maybeNotifyVillaContentUpdated } from "@/lib/villa-notify";

// VND 동 단위 양수 문자열 (기준 보증금 — BigInt는 JSON 직렬화 불가하므로 문자열 수신)
const vndDigits = z.string().regex(/^[1-9]\d{0,14}$/);
const minuteOfDay = z.number().int().min(0).max(1439); // 체크인/아웃 분 단위
const nonNegInt = z.number().int().min(0);

const infoPatchSchema = z.object({
  // ④ 이용규칙
  checkInTime: minuteOfDay.optional(),
  checkOutTime: minuteOfDay.optional(),
  smokingAllowed: z.boolean().optional(),
  petsAllowed: z.boolean().optional(),
  partyAllowed: z.boolean().optional(),
  parkingSlots: nonNegInt.max(999).optional(),
  baseDepositVnd: vndDigits.nullable().optional(), // null = 미입력(클리어)
  extraBedAvailable: z.boolean().optional(),
  // ③ 위치·규모
  googleMapUrl: z.string().url().startsWith("https://").max(2000).nullable().optional(),
  beachDistanceM: nonNegInt.max(100000).nullable().optional(),
  areaSqm: nonNegInt.max(100000).nullable().optional(),
  floors: z.number().int().min(1).max(100).nullable().optional(),
  // ADR-0042 프리미엄 요일 — getUTCDay 값(0=일…6=토). 가격 아님(비밀 아님) — 공급자·운영자 모두 설정 가능.
  //   중복 제거·정렬은 서버. 빈 배열 허용(공휴일만 프리미엄). 프리미엄 가격은 요율 라우트에서 별도 입력.
  premiumDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
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
  set("googleMapUrl", data.googleMapUrl);
  set("beachDistanceM", data.beachDistanceM);
  set("areaSqm", data.areaSqm);
  set("floors", data.floors);
  if (data.baseDepositVnd !== undefined) {
    scalarData.baseDepositVnd = data.baseDepositVnd === null ? null : BigInt(data.baseDepositVnd);
  }
  // ADR-0042 프리미엄 요일 — 중복 제거 후 오름차순 정렬(결정적 저장). 빈 배열 허용.
  if (data.premiumDays !== undefined) {
    scalarData.premiumDays = [...new Set(data.premiumDays)].sort((a, b) => a - b);
  }

  if (Object.keys(scalarData).length === 0) {
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

    await tx.villa.update({ where: { id }, data: scalarData });

    // AuditLog (글로벌 규칙) — baseDepositVnd BigInt는 문자열화
    const changes: Record<string, { new?: unknown }> = {};
    for (const [key, value] of Object.entries(scalarData)) {
      changes[key] =
        key === "baseDepositVnd"
          ? { new: value === null ? null : String(value) }
          : { new: value };
    }
    await writeAuditLog({
      db: tx,
      userId: actorId,
      action: "UPDATE",
      entity: "Villa",
      entityId: id,
      changes,
    });

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
  return NextResponse.json({ id, updated: Object.keys(scalarData).length });
}
