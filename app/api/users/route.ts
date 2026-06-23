// GET /api/users — ADMIN 사용자 목록 + 미연결 Zalo 팔로워 (T1.8, SPEC F0)
// passwordHash 등 민감 필드는 select 화이트리스트로 차단 (include 통째 반환 금지)
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";
import { isSystemAdmin } from "@/lib/permissions";

const ROLES = ["ADMIN", "SUPPLIER", "CLEANER"] as const;

export async function GET(req: Request) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isSystemAdmin(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // ?role= 필터 — 화이트리스트 외 값은 400
  const roleParam = new URL(req.url).searchParams.get("role");
  if (roleParam !== null && !(ROLES as readonly string[]).includes(roleParam)) {
    return NextResponse.json(
      { error: "INVALID_ROLE", role: roleParam },
      { status: 400 }
    );
  }
  const role = roleParam as Role | null;

  const [users, unlinkedZalo] = await Promise.all([
    prisma.user.findMany({
      where: role ? { role } : undefined,
      // select 화이트리스트 — passwordHash 절대 제외 (계약 T1.8)
      select: {
        id: true,
        role: true,
        name: true,
        phone: true,
        email: true,
        zaloUserId: true,
        locale: true,
        isActive: true,
        createdAt: true,
        _count: { select: { villas: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // 미가입 Zalo 팔로워 — FE 수동 매칭 드롭다운용 (userId 미연결만)
    prisma.zaloConversation.findMany({
      where: { userId: null },
      select: {
        id: true,
        zaloUserId: true,
        displayName: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({ users, unlinkedZalo });
}
