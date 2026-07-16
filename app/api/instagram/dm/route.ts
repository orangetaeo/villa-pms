// GET /api/instagram/dm?page=&pageSize= — DM 스레드 목록 (admin, ko/다크)
// 권한(첫 줄): isOperator만. SUPPLIER/VENDOR/PARTNER 403.
// 반환(FE 소비 명세):
//   { threads: [{ threadId, senderName, lastMessage:{text,direction,at}, unreadCount,
//                 lastInboundAt, windowExpiresAt, windowExpired }],
//     page, pageSize, total, totalPages }
//   - 정렬: 스레드 최신 메시지 desc.
//   - unreadCount = direction=IN && !readByAdmin.
//   - windowExpiresAt/windowExpired: 마지막 IN + 24h(답장 가능 창). IN 없으면 null/true.
// 서버 페이지네이션(클라 slice 금지 — list-pagination-default-10 교훈).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { parsePageParams } from "@/lib/pagination";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const PREVIEW_LEN = 60;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isOperator(session.user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const { page, pageSize, skip, take } = parsePageParams({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });

  // 스레드 = igThreadId 그룹. 최신 메시지 시각 desc로 정렬·페이지.
  const groups = await prisma.instagramMessage.groupBy({
    by: ["igThreadId"],
    _max: { receivedAt: true },
    orderBy: { _max: { receivedAt: "desc" } },
    skip,
    take,
  });
  // 전체 스레드 수(페이지네이션 total).
  const allThreadIds = await prisma.instagramMessage.findMany({
    distinct: ["igThreadId"],
    select: { igThreadId: true },
  });
  const total = allThreadIds.length;

  const threads = await Promise.all(
    groups.map(async (g) => {
      const threadId = g.igThreadId;
      const [last, unreadCount, lastIn, nameRow] = await Promise.all([
        prisma.instagramMessage.findFirst({
          where: { igThreadId: threadId },
          orderBy: { receivedAt: "desc" },
          select: { text: true, direction: true, receivedAt: true, attachments: true },
        }),
        prisma.instagramMessage.count({
          where: { igThreadId: threadId, direction: "IN", readByAdmin: false },
        }),
        prisma.instagramMessage.findFirst({
          where: { igThreadId: threadId, direction: "IN" },
          orderBy: { receivedAt: "desc" },
          select: { receivedAt: true },
        }),
        prisma.instagramMessage.findFirst({
          where: { igThreadId: threadId, senderName: { not: null } },
          orderBy: { receivedAt: "desc" },
          select: { senderName: true },
        }),
      ]);

      const lastInAt = lastIn?.receivedAt ?? null;
      const windowExpiresAt = lastInAt ? new Date(lastInAt.getTime() + WINDOW_MS) : null;
      const windowExpired = !lastInAt || Date.now() - lastInAt.getTime() > WINDOW_MS;
      const previewText = last?.text?.trim()
        ? last.text.trim().slice(0, PREVIEW_LEN)
        : last?.attachments
          ? "(미디어)"
          : "";

      return {
        threadId,
        senderName: nameRow?.senderName ?? null,
        lastMessage: last
          ? { text: previewText, direction: last.direction, at: last.receivedAt.toISOString() }
          : null,
        unreadCount,
        lastInboundAt: lastInAt ? lastInAt.toISOString() : null,
        windowExpiresAt: windowExpiresAt ? windowExpiresAt.toISOString() : null,
        windowExpired,
      };
    })
  );

  return NextResponse.json({
    threads,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}
