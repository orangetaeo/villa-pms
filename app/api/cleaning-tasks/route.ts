import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CleaningStatus, type Prisma } from "@prisma/client";
import { isOperator } from "@/lib/permissions";

/**
 * GET /api/cleaning-tasks — 청소 태스크 목록 (/inspections b6·a8용)
 * ADMIN: 전체(+status 필터) / SUPPLIER: 자기 빌라만 / CLEANER: 배정분만 — 스코프 강제
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { role, id: userId } = session.user;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  // Object.hasOwn — `in`은 프로토타입 체인('toString' 등)을 통과해 Prisma 500 유발 (QA)
  const statusFilter =
    statusParam && Object.hasOwn(CleaningStatus, statusParam)
      ? { status: statusParam as CleaningStatus }
      : {};

  let scope: Prisma.CleaningTaskWhereInput;
  if (isOperator(role)) {
    scope = {};
  } else if (role === "SUPPLIER") {
    scope = { villa: { supplierId: userId } }; // 자기 빌라만 — 타인 데이터 차단
  } else if (role === "CLEANER") {
    scope = { assigneeId: userId }; // 배정된 태스크만
  } else {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const tasks = await prisma.cleaningTask.findMany({
    where: { ...scope, ...statusFilter },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      villaId: true,
      bookingId: true,
      type: true,
      status: true,
      assigneeId: true,
      photoUrls: true,
      rejectNote: true,
      approvedAt: true,
      dueDate: true,
      createdAt: true,
      villa: { select: { name: true, complex: true } },
    },
  });

  return Response.json({ tasks });
}
