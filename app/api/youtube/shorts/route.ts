// GET /api/youtube/shorts?status=&page= — 유튜브 쇼츠 큐/이력 목록 (admin, ko/다크)
// DELETE /api/youtube/shorts  { ids: string[] } — 선택 항목 **하드 삭제**(리스트 체크박스).
// 권한(첫 줄): 목록은 isOperator, 삭제는 canOverrideGate(위험작업 — STAFF 차단, 중앙 가드).
// 페이지네이션: 서버 skip/take 기본 10(클라 slice 금지 — list-pagination-default-10 교훈).
import { NextResponse } from "next/server";
import { z } from "zod";
import { YtShortStatus, type Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator, canOverrideGate } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { writeAuditLog } from "@/lib/audit-log";
import { BULK_DELETE_MAX, partitionDeletable } from "@/lib/marketing/deletable";
import { serializeYtShort } from "@/lib/youtube/serialize";

const PAGE_SIZE = 10;
const VALID_STATUSES = new Set<string>(Object.values(YtShortStatus));

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status")?.trim();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const where: Prisma.YoutubeShortWhereInput = {};
  if (statusParam && VALID_STATUSES.has(statusParam)) {
    where.status = statusParam as YtShortStatus;
  }

  const [total, shorts] = await Promise.all([
    prisma.youtubeShort.count({ where }),
    prisma.youtubeShort.findMany({
      where,
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { villa: { select: { name: true } } },
    }),
  ]);

  return NextResponse.json({
    shorts: shorts.map(serializeYtShort),
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}

const deleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(BULK_DELETE_MAX),
});

/**
 * 선택 쇼츠 하드 삭제 — 복구 불가. PUBLISHING·PUBLISHED는 서버에서 거부(클라 체크박스 비활성과 이중 방어).
 * 부분 성공: 삭제 가능분만 지우고 차단분은 blocked로 돌려준다(전량 실패로 만들지 않는다).
 * ★ R2에 올라간 MP4·포스터 파일은 지우지 않는다(비용 미미 · 삭제 실패가 DB 삭제를 막는 것을 피함).
 */
export async function DELETE(req: Request) {
  const g = await requireCapability(canOverrideGate, "canOverrideGate", req);
  if (!g.ok) return g.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsed.error.flatten() }, { status: 400 });
  }
  const ids = [...new Set(parsed.data.ids)];

  const rows = await prisma.youtubeShort.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, title: true, villaId: true, sourceType: true, ytVideoId: true },
  });
  const { deletable, blocked } = partitionDeletable(rows);

  if (deletable.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.youtubeShort.deleteMany({ where: { id: { in: deletable.map((r) => r.id) } } });
      for (const r of deletable) {
        // 하드 삭제라 행이 사라지므로 감사로그에 스냅샷을 남긴다(무엇을 지웠는지 추적 유일 수단).
        await writeAuditLog({
          userId: g.userId,
          action: "DELETE",
          entity: "YoutubeShort",
          entityId: r.id,
          changes: {
            status: { old: r.status },
            title: { old: r.title.slice(0, 60) },
            villaId: { old: r.villaId },
            sourceType: { old: r.sourceType },
            ytVideoId: { old: r.ytVideoId },
          },
          db: tx,
        });
      }
    });
  }

  return NextResponse.json({
    deleted: deletable.length,
    blocked: blocked.map((r) => ({ id: r.id, status: r.status })),
    notFound: ids.filter((id) => !rows.some((r) => r.id === id)),
  });
}
