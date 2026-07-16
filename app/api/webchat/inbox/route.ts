// GET /api/webchat/inbox — 운영자 웹 채팅 세션 목록 (T-webchat-mvp)
//
// ADMIN 전용(첫 줄 role 검사). ownerAdminId 스코프 강제. 비정규화 lastMessage* 필드 사용(N+1 금지).
// filter=open|blocked|all, take 30+1 자체 커서(Zalo 목록과 병합 금지 — 웹챗 탭 단독).
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

const PAGE_SIZE = 30;

export async function GET(req: Request) {
  // 첫 줄 role 검사 — 운영자 전체(OWNER/MANAGER/STAFF/ADMIN). 웹챗은 구조적 무금액이라 STAFF 개방 안전.
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;

  const sp = new URL(req.url).searchParams;
  const filter = sp.get("filter") ?? "open";
  const cursor = sp.get("cursor");

  // 웹챗 세션은 조직 공유 자산 — Zalo 대화(개인 스코프)와 다름 (T-webchat-expand)
  const where: Prisma.WebChatSessionWhereInput = {};
  if (filter === "open") where.status = "OPEN";
  else if (filter === "blocked") where.status = "BLOCKED";
  // filter=all → status 무필터

  const rows = await prisma.webChatSession.findMany({
    where,
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      visitorLocale: true,
      status: true,
      sourcePage: true,
      contactEmail: true,
      contactZalo: true,
      contactKakao: true,
      unreadForAdmin: true,
      lastMessageText: true,
      lastMessageDirection: true,
      lastMessageAt: true,
      createdAt: true,
    },
  });

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  const sessions = page.map((s) => ({
    id: s.id,
    visitorLocale: s.visitorLocale,
    status: s.status,
    sourcePage: s.sourcePage,
    contactEmail: s.contactEmail,
    contactZalo: s.contactZalo,
    contactKakao: s.contactKakao,
    unreadForAdmin: s.unreadForAdmin,
    lastMessageText: s.lastMessageText,
    lastMessageDirection: s.lastMessageDirection,
    lastMessageAt: s.lastMessageAt ? s.lastMessageAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
  }));

  return NextResponse.json({ sessions, nextCursor });
}
