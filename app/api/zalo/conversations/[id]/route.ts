// PATCH /api/zalo/conversations/[id] — ADMIN 대화 액션 (T6.6 b14 + ADR-0009 S5/S7)
// 액션:
//  MARK_READ            — unreadCount=0 (읽음 메타, AuditLog 미기록)
//  SET_TRANSLATE_MODE   — 대화별 번역모드 OFF|VI|EN (D7.5, 운영 메타 — AuditLog 미기록)
//  SET_NICKNAME         — ADMIN 지정 별명(빈값=해제, D9.3, AuditLog 기록)
// 공통: ADMIN 전용 + 본인(ownerAdminId) 대화만 (ADR-0007 누수 차단). 타인/미존재 대화는 404.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";

// nickname: 빈 문자열/공백은 해제(null)로 정규화. 1~40자 길이 제한(D9.3).
const NICKNAME_MAX = 40;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("MARK_READ") }),
  z.object({ action: z.literal("SET_TRANSLATE_MODE"), mode: z.enum(["OFF", "VI", "EN"]) }),
  z.object({
    action: z.literal("SET_NICKNAME"),
    // 클라가 null 또는 문자열 전달. 문자열은 trim 후 최대 길이 검증.
    nickname: z.string().max(NICKNAME_MAX).nullable(),
  }),
  // SET_COUNTERPARTY_TYPE — 대화 상대 분류(공급자/고객). 공유 누수 분기의 전제(ADR-0009 D1).
  // ADMIN 수동 분류만(자동 매칭 금지). UNKNOWN으로 되돌리는 것도 허용.
  z.object({
    action: z.literal("SET_COUNTERPARTY_TYPE"),
    counterpartyType: z.enum(["SUPPLIER", "CUSTOMER", "UNKNOWN"]),
  }),
]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const ownerAdminId = session.user.id;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
  }

  const action = parsed.data;

  // ── MARK_READ ────────────────────────────────────────────────
  if (action.action === "MARK_READ") {
    // updateMany — 멱등 + 본인 대화만. 미존재/타인 대화는 count 0 → 404
    const result = await prisma.zaloConversation.updateMany({
      where: { id, ownerAdminId },
      data: { unreadCount: 0 },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, unreadCount: 0 });
  }

  // ── SET_TRANSLATE_MODE (D7.5) ────────────────────────────────
  if (action.action === "SET_TRANSLATE_MODE") {
    const result = await prisma.zaloConversation.updateMany({
      where: { id, ownerAdminId },
      data: { translateMode: action.mode },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, translateMode: action.mode });
  }

  // ── SET_COUNTERPARTY_TYPE (D1) — 상대 분류, 공유 누수 분기 전제 ──
  if (action.action === "SET_COUNTERPARTY_TYPE") {
    const existing = await prisma.zaloConversation.findFirst({
      where: { id, ownerAdminId },
      select: { id: true, counterpartyType: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    await prisma.zaloConversation.update({
      where: { id: existing.id },
      data: { counterpartyType: action.counterpartyType },
    });
    // AuditLog — 분류 변경은 공유 권한에 영향(증빙). credential·금액 무관
    await writeAuditLog({
      action: "UPDATE",
      entity: "ZaloConversation",
      entityId: existing.id,
      userId: ownerAdminId,
      changes: {
        counterpartyType: { old: existing.counterpartyType, new: action.counterpartyType },
      },
    }).catch(() => {});
    return NextResponse.json({ ok: true, counterpartyType: action.counterpartyType });
  }

  // ── SET_NICKNAME (D9.3) ──────────────────────────────────────
  // 빈 문자열/공백 → null(별명 해제, 원래 우선순위 복귀).
  const normalized = action.nickname?.trim() ? action.nickname.trim() : null;

  // 본인 대화 확인 + 기존값(AuditLog old) 조회를 한 번에. 타인/미존재는 null → 404.
  const existing = await prisma.zaloConversation.findFirst({
    where: { id, ownerAdminId },
    select: { id: true, nickname: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  await prisma.zaloConversation.update({
    where: { id: existing.id },
    data: { nickname: normalized },
  });

  // AuditLog — 별명은 민감정보 아님(기록 가능). credential·금액 무관 (D9.3)
  await writeAuditLog({
    action: "UPDATE",
    entity: "ZaloConversation",
    entityId: existing.id,
    userId: ownerAdminId,
    changes: { nickname: { old: existing.nickname, new: normalized } },
  }).catch(() => {});

  return NextResponse.json({ ok: true, nickname: normalized });
}
