// GET/PUT /api/settings/zalo-notify-group — 운영자 Zalo 알림 그룹방 설정 (ADR-0040, ADMIN 전용)
//
//   GET  = 시스템봇 소유자(테오)의 GROUP 대화 목록 + 현재 설정값(ZALO_ADMIN_NOTIFY_GROUP_ID).
//   PUT  = 그룹 thread id 저장(=그룹 라우팅 활성) 또는 null 해제(=개별 DM 복귀).
//          저장값은 시스템봇 소유자의 GROUP 대화 중 하나여야 함(임의 thread id 주입 차단).
//   ★ 데이터 변경(PUT)에 writeAuditLog 필수(글로벌 절대 규칙).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isSystemAdmin } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { auth } from "@/auth";
import { getSystemBotOwnerId } from "@/lib/zalo-credentials";
import { ZALO_ADMIN_NOTIFY_GROUP_ID_KEY } from "@/lib/operator-notify";

interface GroupOption {
  id: string; // 그룹 thread id (ZaloConversation.zaloUserId 슬롯)
  name: string | null; // 그룹 표시명(nickname 우선, 없으면 displayName)
}

/** 시스템봇 소유자의 GROUP 대화 목록 — 미연결(소유자 미상)이면 빈 배열. */
async function listGroupConversations(): Promise<GroupOption[]> {
  const ownerId = await getSystemBotOwnerId();
  if (!ownerId) return [];
  const rows = await prisma.zaloConversation.findMany({
    where: { ownerAdminId: ownerId, threadType: "GROUP" },
    orderBy: { lastMessageAt: "desc" },
    select: { zaloUserId: true, displayName: true, nickname: true },
  });
  return rows.map((r) => ({ id: r.zaloUserId, name: r.nickname ?? r.displayName }));
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isSystemAdmin(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const [groups, setting, botConnected] = await Promise.all([
    listGroupConversations(),
    prisma.appSetting.findUnique({ where: { key: ZALO_ADMIN_NOTIFY_GROUP_ID_KEY } }),
    getSystemBotOwnerId().then((id) => id !== null),
  ]);

  return NextResponse.json({
    groups,
    // 현재 설정된 그룹 id(미설정=null). 설정됐지만 목록에 없으면 UI가 "삭제된 그룹" 안내.
    selectedGroupId: setting?.value ?? null,
    // 시스템봇 미연결이면 그룹 목록을 못 불러오므로 UI가 안내(빈 목록 ≠ 오류).
    botConnected,
  });
}

const putSchema = z.object({
  // null = 해제(개별 DM 복귀). 문자열 = 그룹 thread id(소유자 GROUP 대화 중 하나여야 함).
  groupThreadId: z.string().trim().min(1).max(200).nullable(),
});

export async function PUT(req: Request) {
  const g = await requireCapability(isSystemAdmin, "isSystemAdmin", req);
  if (!g.ok) return g.response;
  const userId = g.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const next = parsed.data.groupThreadId;

  // 설정(비-해제) 시 — 시스템봇 소유자의 GROUP 대화 중 하나인지 검증(임의 thread id 주입 차단).
  if (next !== null) {
    const groups = await listGroupConversations();
    if (!groups.some((grp) => grp.id === next)) {
      return NextResponse.json({ error: "INVALID_GROUP" }, { status: 400 });
    }
  }

  const before = await prisma.appSetting.findUnique({
    where: { key: ZALO_ADMIN_NOTIFY_GROUP_ID_KEY },
  });

  if (next === null) {
    await prisma.appSetting.deleteMany({ where: { key: ZALO_ADMIN_NOTIFY_GROUP_ID_KEY } });
  } else {
    await prisma.appSetting.upsert({
      where: { key: ZALO_ADMIN_NOTIFY_GROUP_ID_KEY },
      create: { key: ZALO_ADMIN_NOTIFY_GROUP_ID_KEY, value: next },
      update: { value: next },
    });
  }

  // 감사 로그 — 설정 변경 기록 (그룹 id는 민감정보 아님: 대화 식별자만, 판매가·마진 무관)
  if ((before?.value ?? null) !== (next ?? null)) {
    await writeAuditLog({
      userId,
      action: "UPDATE",
      entity: "AppSetting",
      entityId: ZALO_ADMIN_NOTIFY_GROUP_ID_KEY,
      changes: { value: { old: before?.value ?? null, new: next ?? null } },
    });
  }

  return NextResponse.json({ selectedGroupId: next });
}
