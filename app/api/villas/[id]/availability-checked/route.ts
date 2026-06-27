// POST /api/villas/[id]/availability-checked — ADMIN "공실 확인했음" 갱신 (T-admin-availability-board)
// 운영자가 공급자에게 이 빌라 공실을 확인한 시점을 기록. b11 공실 보드의 "마지막 확인일" 뱃지 소스.
// 재고·마진 무관 필드(타임스탬프 1개)만 갱신 — Booking/VillaRate 일절 조회·수정하지 않는다.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙). SUPPLIER/CLEANER/비로그인 차단
  const g = await requireCapability(isOperator, "isOperator", _req);
  if (!g.ok) return g.response;
  const session = g.session;
  const actorUserId = session.user.id;
  const { id } = await params;

  const now = new Date();

  // before/after 를 AuditLog 에 남기기 위해 이전 값 조회 후 갱신 — 한 트랜잭션으로 원자화
  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({
      where: { id },
      select: { availabilityCheckedAt: true },
    });
    if (!villa) return { kind: "NOT_FOUND" as const };

    const before = villa.availabilityCheckedAt;
    await tx.villa.update({
      where: { id },
      data: { availabilityCheckedAt: now },
    });

    // AuditLog (글로벌 규칙) — DateTime 은 Json 컬럼에 ISO 문자열로 기록
    await writeAuditLog({
      db: tx,
      userId: actorUserId,
      action: "UPDATE",
      entity: "Villa",
      entityId: id,
      changes: {
        availabilityCheckedAt: {
          old: before ? before.toISOString() : null,
          new: now.toISOString(),
        },
      },
    });

    return { kind: "OK" as const };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // 갱신된 확인 시각(ISO) 반환 — FE 가 뱃지 즉시 갱신
  return NextResponse.json({ id, availabilityCheckedAt: now.toISOString() });
}
