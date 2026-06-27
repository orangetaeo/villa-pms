// PATCH /api/bookings/[id]/checkin/paper-docs — 체크인 종이서류 사진 저장 (#1)
// 체크인 후 담당자가 받은 종이서류(현장 서명 동의서 등)를 촬영·업로드한 비공개 증빙 URL을 기록.
// 보안: 운영자(ADMIN/OWNER/MANAGER/STAFF) 전용. URL은 doc- 접두 비공개 경로만 허용(공개·여권/서명 혼입 차단).
//       종이서류는 ADMIN 증빙 — 공급자·공개 미노출. 마진·판매가 무관.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { assertPaperDocUrls } from "@/lib/checkin";
import { requireCapability } from "@/lib/api-guard";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;
  const actorId = session.user.id;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  // 종이서류 URL 검증 — doc- 비공개 경로만, 최대 30장(QA 가드레일 a)
  const urls = (body as { paperDocUrls?: unknown } | null)?.paperDocUrls;
  try {
    assertPaperDocUrls(urls);
  } catch (e) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", reason: e instanceof Error ? e.message : "invalid" },
      { status: 400 }
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // 체크인 기록(bookingId @unique)이 있어야 함 — 미체크인 예약은 종이서류 첨부 불가
    const record = await tx.checkInRecord.findUnique({
      where: { bookingId: id },
      select: { id: true, paperDocUrls: true },
    });
    if (!record) return { kind: "NO_RECORD" as const };

    await tx.checkInRecord.update({
      where: { bookingId: id },
      data: { paperDocUrls: urls },
    });
    // 글로벌 규칙 — 변경 추적(장수만, URL 본문 미기록). 증빙은 비공개.
    await writeAuditLog({
      db: tx,
      userId: actorId,
      action: "UPDATE",
      entity: "CheckInRecord",
      entityId: record.id,
      changes: { paperDocUrls: { old: record.paperDocUrls.length, new: urls.length } },
    });
    return { kind: "OK" as const, count: urls.length };
  });

  if (result.kind === "NO_RECORD") {
    // 체크인 기록 없음 = 아직 체크인 안 됨(상태 충돌)
    return NextResponse.json({ error: "NO_CHECKIN_RECORD" }, { status: 409 });
  }
  return NextResponse.json({ bookingId: id, paperDocCount: result.count });
}
