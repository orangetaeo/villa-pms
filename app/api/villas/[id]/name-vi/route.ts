// POST /api/villas/[id]/name-vi — 빌라 베트남어 병기명(nameVi) 제안·저장 (ADR-0020)
//
// action=suggest : Gemini로 한국어명 → 라틴 음역 제안 반환(저장 안 함). 키 미설정 503.
// action=save    : ADMIN이 확정한 nameVi 저장(공백→null). AuditLog 기록.
// 권한: isOperator(운영자) 전용 — 빌라명은 마진·재고 아님(누수 무관), 관리 데이터.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { romanizeVillaName, GeminiNotConfiguredError } from "@/lib/gemini";

export const runtime = "nodejs"; // Gemini fetch — edge 불필요

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suggest") }),
  z.object({ action: z.literal("save"), nameVi: z.string().max(100) }),
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const villa = await prisma.villa.findUnique({
    where: { id },
    select: { id: true, name: true, nameVi: true },
  });
  if (!villa) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // ── 제안: Gemini 음역(저장 안 함, ADMIN 확정 전) ──
  if (parsed.data.action === "suggest") {
    try {
      const suggestion = await romanizeVillaName(villa.name);
      return NextResponse.json({ suggestion });
    } catch (e) {
      if (e instanceof GeminiNotConfiguredError) {
        return NextResponse.json({ error: "GEMINI_NOT_CONFIGURED" }, { status: 503 });
      }
      // 본문에 입력이 에코될 수 있으므로 메시지 일반화
      return NextResponse.json({ error: "SUGGEST_FAILED" }, { status: 502 });
    }
  }

  // ── 저장: ADMIN 확정값(공백 → null, 미병기 폴백) ──
  const trimmed = parsed.data.nameVi.trim();
  const nextNameVi = trimmed.length === 0 ? null : trimmed;
  if (nextNameVi === villa.nameVi) {
    return NextResponse.json({ nameVi: nextNameVi }); // 변화 없음 — 멱등
  }

  await prisma.$transaction(async (tx) => {
    await tx.villa.update({ where: { id: villa.id }, data: { nameVi: nextNameVi } });
    await writeAuditLog({
      db: tx,
      userId: session.user.id,
      action: "UPDATE",
      entity: "Villa",
      entityId: villa.id,
      changes: { nameVi: { old: villa.nameVi, new: nextNameVi } },
    });
  });

  return NextResponse.json({ nameVi: nextNameVi });
}
