// PATCH /api/zalo/conversations/[id] — ADMIN 대화 액션 (T6.6 b14 + ADR-0009 S5/S7)
// 액션:
//  MARK_READ            — unreadCount=0 (읽음 메타, AuditLog 미기록)
//  SET_TRANSLATE_MODE   — 대화별 번역모드 OFF|VI|EN (D7.5, 운영 메타 — AuditLog 미기록)
//  SET_NICKNAME         — ADMIN 지정 별명(빈값=해제, D9.3, AuditLog 기록)
// 공통: ADMIN 전용 + 본인(ownerAdminId) 대화만 (ADR-0007 누수 차단). 타인/미존재 대화는 404.
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, ZaloCounterpartyType } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { addReactionAsAdmin, applyReaction, REACTION_KEYS } from "@/lib/zalo-runtime";

// 발송 가능한 리액션 아이콘 키(zca-js Reactions enum 이름, 예 "HEART"). DB·집계는 이 키 문자열로 저장.
// REACTION_KEYS는 zalo-runtime이 zca-js Reactions에서 도출 — 세트 확장 시 코드 변경만(스키마 무변경, R3-5).
const reactionIconKeySchema = z.enum(REACTION_KEYS);

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
  // SET_COUNTERPARTY_TYPE — 대화 상대 분류 5종(공급자/고객/여행사/랜드사/미분류, ADR-0009 D1·개정2).
  // ADMIN 수동 분류만(자동 매칭 금지). UNKNOWN으로 되돌리는 것도 허용.
  // nativeEnum으로 Prisma ZaloCounterpartyType와 단일 진실원 — enum 확장 시 자동 동기화(누락 방지).
  z.object({
    action: z.literal("SET_COUNTERPARTY_TYPE"),
    counterpartyType: z.nativeEnum(ZaloCounterpartyType),
  }),
  // REACT — 메시지에 리액션(하트 등) 추가 (ADR-0009 R3-3). messageId는 본인 대화의 ZaloMessage.
  // 발송 후 자기 reactions에도 낙관적 +1 반영. cliMsgId 없는 과거 메시지는 거부(zca-js 요구).
  z.object({
    action: z.literal("REACT"),
    messageId: z.string().min(1),
    icon: reactionIconKeySchema,
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

  // ── REACT (R3-3) — 메시지 리액션 발송 + 자기 집계 낙관적 갱신 ──
  if (action.action === "REACT") {
    // 본인(ownerAdminId) 대화의 메시지만 — 대화 스코프로 한정(타 관리자 메시지 거부, ADR-0007 격리).
    const msg = await prisma.zaloMessage.findFirst({
      where: {
        id: action.messageId,
        conversation: { id, ownerAdminId },
      },
      select: {
        id: true,
        zaloMsgId: true,
        cliMsgId: true,
        reactions: true,
        conversation: { select: { zaloUserId: true } },
      },
    });
    if (!msg) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    // zca-js addReaction은 msgId + cliMsgId 둘 다 필수 — 과거(미보유) 메시지는 거부(R3-4).
    if (!msg.zaloMsgId || !msg.cliMsgId) {
      return NextResponse.json({ error: "REACTION_NOT_SUPPORTED" }, { status: 400 });
    }

    const send = await addReactionAsAdmin(
      ownerAdminId,
      msg.conversation.zaloUserId,
      { zaloMsgId: msg.zaloMsgId, cliMsgId: msg.cliMsgId },
      action.icon
    );
    if (!send.ok) {
      // 봇 미연결·발송 실패 — 집계 갱신 안 함(낙관적 반영은 발송 성공 시만). 502로 구분.
      return NextResponse.json({ error: send.error }, { status: 502 });
    }

    // 발송 성공 — 자기 reactions에 낙관적 +1(수신 이벤트가 와도 멱등 갱신은 INTEG가 보장, R3-4).
    const updated = applyReaction(msg.reactions, action.icon, true);
    await prisma.zaloMessage.update({
      where: { id: msg.id },
      data: { reactions: updated ?? Prisma.JsonNull },
    });
    return NextResponse.json({ ok: true, reactions: updated ?? {} });
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
