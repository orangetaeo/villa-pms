// /users — ADMIN 사용자 목록 (T1.8, Stitch b13-users 변환)
// RSC: prisma 직접 조회(사용자 목록 + 미연결 ZaloConversation). select 화이트리스트 — passwordHash 제외
// 토글·Zalo 수동 매칭은 클라이언트 컴포넌트 + PATCH /api/users/[id] → router.refresh()
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CoachMark } from "@/components/tour/coach-mark";
import { buildTourLabels, buildTourSteps } from "@/components/tour/tour-definitions";
import UsersManager, { type UserRow, type UnlinkedZaloRow } from "./users-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("users")} — Villa Go` };
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

// 딥링크 탭 — /partners 등에서 ?role=PARTNER로 진입 시 해당 탭으로 시작
const INITIAL_TABS = ["all", "SUPPLIER", "CLEANER", "VENDOR", "PARTNER"] as const;
type InitialTab = (typeof INITIAL_TABS)[number];

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  // ADMIN 보장은 (admin) layout — 여기서는 본인 행 비활성화 차단용 id만 사용
  const session = await auth();
  const selfId = session?.user?.id ?? "";

  const { role: roleParam } = await searchParams;
  const initialTab: InitialTab = INITIAL_TABS.includes(roleParam as InitialTab)
    ? (roleParam as InitialTab)
    : "all";

  const [users, unlinked, linkedConvos] = await Promise.all([
    prisma.user.findMany({
      // 소프트 삭제된 계정 제외 (deletedAt=null만 노출)
      where: { deletedAt: null },
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
        // 연결된 B2B 엔티티 id — 행에서 파트너/발주처 정보로 점프(엔티티≠계정 상호연결)
        partnerAccount: { select: { id: true } },
        vendorAccount: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // 미가입 Zalo 팔로워 (userId 미연결) — 수동 매칭 후보.
    // threadType USER만(그룹 제외), 최근 활동순(대화 없는 행은 뒤로) — 동명 계정 구분·상위 노출용.
    prisma.zaloConversation.findMany({
      where: { userId: null, threadType: "USER" },
      select: { id: true, zaloUserId: true, displayName: true, lastMessageAt: true },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    }),
    // 연결된 대화방 이름 매핑 — "연결됨" 아래에 어느 대화방인지 표시(수동 매칭 검증용)
    prisma.zaloConversation.findMany({
      where: { userId: { not: null } },
      select: { userId: true, displayName: true },
    }),
  ]);

  // userId → 연결 대화방 이름(첫 행 우선; 관리자별 중복 행이 있어도 표시용은 하나면 충분)
  const zaloNameByUserId = new Map<string, string | null>();
  for (const c of linkedConvos) {
    if (c.userId && !zaloNameByUserId.has(c.userId)) {
      zaloNameByUserId.set(c.userId, c.displayName);
    }
  }

  const userRows: UserRow[] = users.map((u) => ({
    id: u.id,
    // S-RBAC-4: UserRow.role을 Role(6값)로 확장 — transition 캐스트 제거(타입 일치)
    role: u.role,
    name: u.name,
    phone: u.phone,
    zaloUserId: u.zaloUserId,
    isActive: u.isActive,
    joinedAt: toDotDate(u.createdAt),
    villaCount: u._count.villas,
    partnerId: u.partnerAccount?.id ?? null,
    vendorId: u.vendorAccount?.id ?? null,
    // 연결된 대화방 표시명 (미연결이면 매핑에 없음 → null) — 매핑 키는 시스템 User.id
    zaloName: u.zaloUserId ? (zaloNameByUserId.get(u.id) ?? null) : null,
  }));

  const unlinkedZalo: UnlinkedZaloRow[] = unlinked.map((c) => ({
    id: c.id,
    zaloUserId: c.zaloUserId,
    displayName: c.displayName,
    // 최근 활동일 표시용 YYYY.MM.DD (없으면 null → 클라에서 "대화 없음")
    lastMessageAt: c.lastMessageAt ? toDotDate(c.lastMessageAt) : null,
  }));

  const tTour = await getTranslations("tour");

  return (
    <>
      <UsersManager
        users={userRows}
        unlinkedZalo={unlinkedZalo}
        selfId={selfId}
        initialTab={initialTab}
      />

      {/* 코치마크 투어 — 첫 진입 자동 1회, 이후 "?"로 재생 (T-tutorial-onboarding-6) */}
      <CoachMark
        tourId="adminUsers"
        steps={buildTourSteps(tTour, "adminUsers")}
        labels={buildTourLabels(tTour)}
      />
    </>
  );
}
