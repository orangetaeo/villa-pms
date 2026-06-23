// PATCH/DELETE /api/villas/[id]/cost — SUPPLIER 시즌별 원가 수정·삭제 (Phase 1 빌라 관리자 업그레이드)
//
// 사업 핵심 원칙:
//  - 재고 스코프(1): 자기 빌라(supplierId)만. 타인·미존재는 404 동일(존재 누설 금지).
//  - 마진 비공개(2): 원가 변경 시 salePriceVnd·salePriceKrw·marginValue/Type을 서버측 재계산하되
//    응답·감사 로그에 판매가·마진을 절대 포함하지 않는다(leak-checklist). 공급자는 자기 원가만 응답받음.
//  - 견적중 변경 알림: 이 빌라를 포함한 ACTIVE 제안이 있으면, 트랜잭션 안에서 ADMIN에게
//    RATE_CHANGED_DURING_PROPOSAL Notification 적재 → 운영자 판매가 재검토 신호(ADR-0008).
//
// salePriceVnd = computeSalePriceVnd(신원가, marginType, marginValue) — 기존 마진 정책 유지.
// salePriceKrw = suggestSalePriceKrw(salePriceVnd, FX_VND_PER_KRW) — FX 미설정이면 0(ADMIN이 요율 화면에서 재산정).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { SEASONS } from "@/lib/villa-schema";
import {
  computeSalePriceVnd,
  suggestSalePriceKrw,
  getFxVndPerKrw,
} from "@/lib/pricing";
import { NotificationType, ProposalStatus } from "@prisma/client";

/** VND 동 단위 양수 문자열 (원가 — 0 불가, BigInt JSON 직렬화 불가하므로 문자열 수신) */
const vndPositiveDigits = z.string().regex(/^[1-9]\d{0,14}$/);

const patchSchema = z.object({
  season: z.enum(SEASONS),
  supplierCostVnd: vndPositiveDigits,
});

const deleteSchema = z.object({
  season: z.enum(SEASONS),
});

/** 이 빌라를 ProposalItem으로 포함하는 ACTIVE 제안 목록 (운영자 통지 대상) */
async function findActiveProposalsForVilla(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  villaId: string
) {
  return tx.proposal.findMany({
    where: {
      status: ProposalStatus.ACTIVE,
      items: { some: { villaId } },
    },
    select: { id: true },
  });
}

/** 원가 변경/삭제 시 ADMIN 전원에게 RATE_CHANGED_DURING_PROPOSAL 적재 (제안별 × 운영자별) */
async function notifyAdminsRateChanged(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  args: {
    proposalIds: string[];
    villaId: string;
    villaName: string;
    season: string;
    oldCostVnd: bigint;
    newCostVnd: bigint | null; // DELETE면 null
  }
) {
  if (args.proposalIds.length === 0) return;
  // [S-RBAC-final] 요율변경 알림 수신자 = 운영 최상위(OWNER). ADMIN은 transition 잔존값
  // 이라 둘 다 포함해 마이그레이션 전/후 무중단(테오 ADMIN→OWNER 데이터 플립과 순서 무관).
  const admins = await tx.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN"] } },
    select: { id: true },
  });
  if (admins.length === 0) return;

  const rows = args.proposalIds.flatMap((proposalId) =>
    admins.map((admin) => ({
      userId: admin.id,
      type: NotificationType.RATE_CHANGED_DURING_PROPOSAL,
      payload: {
        villaId: args.villaId,
        villaName: args.villaName,
        season: args.season,
        // 원가만 알림 payload에 — 운영자 대상이므로 마진 비공개 규칙 무관(ADMIN 통지)
        oldCostVnd: args.oldCostVnd.toString(),
        newCostVnd: args.newCostVnd === null ? null : args.newCostVnd.toString(),
        proposalId,
      },
    }))
  );
  await tx.notification.createMany({ data: rows });
}

// ===================== PATCH — 시즌 원가 수정 =====================
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — SUPPLIER 전용, 자기 빌라 스코프(route handler 첫 줄 role 검사)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "SUPPLIER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const supplierId = session.user.id;
  const { id: villaId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { season } = parsed.data;
  const newCostVnd = BigInt(parsed.data.supplierCostVnd);

  // FX는 트랜잭션 밖에서 1회 조회 (AppSetting, 변경 안 함) — 미설정이면 KRW=0
  const fx = await getFxVndPerKrw(prisma);

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id: villaId },
      select: { id: true, supplierId: true, name: true },
    });
    // 타인 빌라·미존재는 동일하게 404 (존재 자체를 누설하지 않음)
    if (!villa || villa.supplierId !== supplierId) return { kind: "NOT_FOUND" as const };

    const existing = await tx.villaRate.findUnique({
      where: { villaId_season: { villaId, season } },
      select: {
        id: true,
        supplierCostVnd: true,
        marginType: true,
        marginValue: true,
      },
    });
    if (!existing) return { kind: "RATE_NOT_FOUND" as const };

    // 원가 + 기존 마진 정책 → 판매가 서버측 재계산 (마진 비공개 — 응답엔 안 나감)
    const newSalePriceVnd = computeSalePriceVnd(
      newCostVnd,
      existing.marginType,
      existing.marginValue
    );
    const newSalePriceKrw = fx ? suggestSalePriceKrw(newSalePriceVnd, fx) : 0;

    await tx.villaRate.update({
      where: { id: existing.id },
      data: {
        supplierCostVnd: newCostVnd,
        // 마진 정책(marginType/marginValue)은 공급자가 못 바꾼다 — 운영자 영역. 판매가만 재계산.
        salePriceVnd: newSalePriceVnd,
        salePriceKrw: newSalePriceKrw,
      },
    });

    // 견적중 변경 알림 — 같은 트랜잭션 안에서 ACTIVE 제안 판정 + ADMIN 적재
    const activeProposals = await findActiveProposalsForVilla(tx, villaId);
    await notifyAdminsRateChanged(tx, {
      proposalIds: activeProposals.map((p) => p.id),
      villaId,
      villaName: villa.name,
      season,
      oldCostVnd: existing.supplierCostVnd,
      newCostVnd,
    });

    // 감사 로그 — 원가 old/new만(판매가·마진 미기록: 누수·노이즈 방지). tx 주입 원자성.
    await writeAuditLog({
      db: tx,
      userId: supplierId,
      action: "UPDATE",
      entity: "VillaRate",
      entityId: existing.id,
      changes: {
        season: { old: season, new: season },
        supplierCostVnd: {
          old: existing.supplierCostVnd.toString(),
          new: newCostVnd.toString(),
        },
      },
    });

    return {
      kind: "OK" as const,
      activeProposalCount: activeProposals.length,
    };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "RATE_NOT_FOUND") {
    return NextResponse.json({ error: "RATE_NOT_FOUND" }, { status: 404 });
  }

  // 응답 — 공급자는 자기 원가만. salePrice*/margin* 절대 미포함(leak-checklist).
  return NextResponse.json({
    villaId,
    season,
    supplierCostVnd: newCostVnd.toString(),
    proposalNotified: result.activeProposalCount > 0,
  });
}

// ===================== DELETE — 시즌 원가 행 삭제 =====================
// 진행 중 예약·제안은 생성 시점에 가격 스냅샷을 보유하므로 이 삭제에 영향받지 않는다
// (ProposalItem.total*·Booking 스냅샷은 VillaRate를 참조하지 않음 — SPEC F3 스냅샷 원칙).
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "SUPPLIER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const supplierId = session.user.id;
  const { id: villaId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { season } = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id: villaId },
      select: { id: true, supplierId: true, name: true },
    });
    if (!villa || villa.supplierId !== supplierId) return { kind: "NOT_FOUND" as const };

    const existing = await tx.villaRate.findUnique({
      where: { villaId_season: { villaId, season } },
      select: { id: true, supplierCostVnd: true },
    });
    if (!existing) return { kind: "RATE_NOT_FOUND" as const };

    await tx.villaRate.delete({ where: { id: existing.id } });

    // 견적중 변경 알림 — 삭제도 운영자 판매가 재검토 대상(newCost=null)
    const activeProposals = await findActiveProposalsForVilla(tx, villaId);
    await notifyAdminsRateChanged(tx, {
      proposalIds: activeProposals.map((p) => p.id),
      villaId,
      villaName: villa.name,
      season,
      oldCostVnd: existing.supplierCostVnd,
      newCostVnd: null,
    });

    await writeAuditLog({
      db: tx,
      userId: supplierId,
      action: "DELETE",
      entity: "VillaRate",
      entityId: existing.id,
      changes: {
        season: { old: season, new: null },
        supplierCostVnd: { old: existing.supplierCostVnd.toString(), new: null },
      },
    });

    return { kind: "OK" as const, activeProposalCount: activeProposals.length };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (result.kind === "RATE_NOT_FOUND") {
    return NextResponse.json({ error: "RATE_NOT_FOUND" }, { status: 404 });
  }

  // 응답 — 삭제된 시즌만. salePrice*/margin* 미포함.
  return NextResponse.json({
    villaId,
    season,
    deleted: true,
    proposalNotified: result.activeProposalCount > 0,
  });
}
