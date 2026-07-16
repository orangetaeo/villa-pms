// GET /api/youtube/shorts?status=&page= — 유튜브 쇼츠 큐/이력 목록 (admin, ko/다크)
// 권한(첫 줄): isOperator(ADMIN 계열)만. SUPPLIER/VENDOR/PARTNER 403.
// 페이지네이션: 서버 skip/take 기본 10(클라 slice 금지 — list-pagination-default-10 교훈).
import { NextResponse } from "next/server";
import { YtShortStatus, type Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isOperator } from "@/lib/permissions";
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
