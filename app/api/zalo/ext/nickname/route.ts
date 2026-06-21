// POST /api/zalo/ext/nickname — Nike→villa 별칭(nickname) 쓰기 위임 (S5 A6-2 / ADR-0010 setAlias)
//
// 목적: 별칭 편집을 villa·Nike 양쪽에서 가능하게 한다. 정본 = villa ZaloConversation.nickname.
//       Nike UI에서 별칭 수정 → 이 서버-서버 엔드포인트로 위임 → villa 저장 → S2 읽기로 양쪽 동일 표시.
//       conversations/[id] route의 SET_NICKNAME 동작은 불변 — 여기서 동일 로직(검증·trim·길이·AuditLog)을 구현.
//
// 보안(A5 — ext send/threads와 동일 패턴):
//   - 시크릿 게이트: isExtSecretValid(x-zalo-ext-secret vs ZALO_EXT_SHARED_SECRET, timingSafeEqual). 401.
//   - ownerAdminId(테오)는 요청에서 절대 받지 않는다 — resolveSystemOwnerId()로 서버 결정(503).
//   - 테오 스코프 대화만 UPDATE(where ownerAdminId=테오). 타 관리자 대화 0건.
//   - 응답 최소(ok/nickname) — credential·금액·마진 절대 미참조·미반환.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isExtSecretValid, resolveSystemOwnerId } from "@/lib/zalo-ext-auth";

// SET_NICKNAME과 동일 규칙(conversations/[id] route): 빈 문자열/공백=해제(null), 1~40자.
const NICKNAME_MAX = 40;

// 대상 지정: conversationId 또는 zaloUserId 중 하나(둘 다 허용, 적어도 하나 필수).
const bodySchema = z
  .object({
    conversationId: z.string().min(1).optional(),
    zaloUserId: z.string().min(1).optional(),
    // 클라가 null 또는 문자열 전달. 문자열은 trim 후 최대 길이 검증(SET_NICKNAME 동일).
    nickname: z.string().max(NICKNAME_MAX).nullable(),
  })
  .refine((b) => b.conversationId || b.zaloUserId, {
    message: "conversationId 또는 zaloUserId 필요",
  });

export async function POST(req: Request) {
  // ── A5 시크릿 게이트 (첫 줄 인증) ──
  if (!isExtSecretValid(req)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // ── A5 ownerAdminId 서버 결정 (요청 파라미터 미수용) ──
  const ownerAdminId = await resolveSystemOwnerId();
  if (!ownerAdminId) {
    return NextResponse.json({ error: "SYSTEM_BOT_UNAVAILABLE" }, { status: 503 });
  }

  // ── 본문 파싱·검증 ──
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
  const body = parsed.data;

  // 빈 문자열/공백 → null(별명 해제, 원래 우선순위 복귀) — SET_NICKNAME 동일 정규화.
  const normalized = body.nickname?.trim() ? body.nickname.trim() : null;

  // 테오 스코프 대화 확인 + 기존값(AuditLog old) 조회 — 타 관리자/미존재는 null → 404.
  // conversationId 우선, 없으면 zaloUserId 복합키. 어느 경우든 ownerAdminId=테오 강제.
  const existing = await prisma.zaloConversation.findFirst({
    where: {
      ownerAdminId,
      ...(body.conversationId
        ? { id: body.conversationId }
        : { zaloUserId: body.zaloUserId }),
    },
    select: { id: true, nickname: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  await prisma.zaloConversation.update({
    where: { id: existing.id },
    data: { nickname: normalized },
  });

  // AuditLog — 별명은 민감정보 아님(기록 가능). credential·금액 무관 (SET_NICKNAME 동일, D9.3)
  await writeAuditLog({
    action: "UPDATE",
    entity: "ZaloConversation",
    entityId: existing.id,
    userId: ownerAdminId,
    changes: { nickname: { old: existing.nickname, new: normalized } },
  }).catch(() => {});

  return NextResponse.json({ ok: true, nickname: normalized });
}
