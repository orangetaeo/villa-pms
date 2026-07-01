// DELETE /api/auth/passkey/[id] — 본인 패스키 삭제 (ADR-0030).
//   본인 소유만 삭제(deleteMany로 userId 스코프 강제 — 타인 자격증명 IDOR 차단).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  // 본인 소유 자격증명만 삭제(존재하지 않거나 타인 것이면 count=0 → 404).
  const res = await prisma.authenticator.deleteMany({
    where: { id, userId: session.user.id },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await writeAuditLog({
    userId: session.user.id,
    action: "DELETE",
    entity: "Authenticator",
    entityId: id,
  });
  return NextResponse.json({ ok: true });
}
