// /api/vendor/notifications/read — 원천 공급자 인앱 알림 읽음 처리 (ADR-0023 후속)
//   POST: Role=VENDOR + 본인 userId 스코프 강제. body.ids 있으면 해당 id만, 없으면 전체 읽음.
//   updateMany where {userId, readAt:null} — 타 사용자 알림은 where로 원천 차단(스코프 강제).
//   시스템 발생 이벤트의 읽음 상태 변경이라 AuditLog는 과함(생략).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-guard";
import { isVendor } from "@/lib/permissions";

const bodySchema = z.object({
  // 특정 알림만 읽음(미지정·빈 배열이면 전체 미읽음 읽음 처리)
  ids: z.array(z.string()).max(100).optional(),
});

export async function POST(req: Request) {
  // 중앙 가드(P1-S8) — VENDOR 전용. 권한 부족 시 403 + AUTHZ_DENY 기록.
  const g = await requireCapability(isVendor, "isVendor", req);
  if (!g.ok) return g.response;

  const userId = g.session.user.id; // ★ 본인 스코프

  // body는 선택 — 없거나 깨져도 "전체 읽음"으로 동작(벨 열 때 호출)
  let ids: string[] | undefined;
  try {
    const raw = await req.json();
    const parsed = bodySchema.safeParse(raw);
    if (parsed.success) ids = parsed.data.ids;
  } catch {
    // body 없음 → 전체 읽음
  }

  const now = new Date();
  const result = await prisma.inAppNotification.updateMany({
    where: {
      userId, // ★ 타 사용자 알림 차단 — 절대 userId 누락 금지
      readAt: null,
      ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
    },
    data: { readAt: now },
  });

  return NextResponse.json({ updated: result.count });
}
