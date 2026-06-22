// /users — ADMIN 사용자 목록 (T1.8, Stitch b13-users 변환)
// RSC: prisma 직접 조회(사용자 목록 + 미연결 ZaloConversation). select 화이트리스트 — passwordHash 제외
// 토글·Zalo 수동 매칭은 클라이언트 컴포넌트 + PATCH /api/users/[id] → router.refresh()
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import UsersManager, { type UserRow, type UnlinkedZaloRow } from "./users-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("users")} — Villa PMS` };
}

/** 가입일 → YYYY.MM.DD (DESIGN.md 점 표기, Asia/Ho_Chi_Minh 표시 규칙) */
function toDotDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")}`;
}

export default async function UsersPage() {
  // ADMIN 보장은 (admin) layout — 여기서는 본인 행 비활성화 차단용 id만 사용
  const session = await auth();
  const selfId = session?.user?.id ?? "";

  const [users, unlinked] = await Promise.all([
    prisma.user.findMany({
      // select 화이트리스트 — passwordHash 절대 제외 (계약 T1.8)
      select: {
        id: true,
        role: true,
        name: true,
        phone: true,
        zaloUserId: true,
        isActive: true,
        createdAt: true,
        _count: { select: { villas: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // 미가입 Zalo 팔로워 (userId 미연결) — 수동 매칭 후보
    prisma.zaloConversation.findMany({
      where: { userId: null },
      select: { id: true, zaloUserId: true, displayName: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const userRows: UserRow[] = users.map((u) => ({
    id: u.id,
    role: u.role,
    name: u.name,
    phone: u.phone,
    zaloUserId: u.zaloUserId,
    isActive: u.isActive,
    joinedAt: toDotDate(u.createdAt),
    villaCount: u._count.villas,
  }));

  const unlinkedZalo: UnlinkedZaloRow[] = unlinked.map((c) => ({
    id: c.id,
    zaloUserId: c.zaloUserId,
    displayName: c.displayName,
  }));

  return <UsersManager users={userRows} unlinkedZalo={unlinkedZalo} selfId={selfId} />;
}
