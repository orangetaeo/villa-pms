// POST /api/villas/[id]/name-vi — 빌라 한국어명(name)·베트남어 병기명(nameVi) 제안·저장 (ADR-0020)
//
// action=suggest : Gemini로 한국어명 → 라틴 음역 제안 반환(저장 안 함). 키 미설정 503.
//                  body.name(초안) 전달 시 저장 전 새 이름 기준으로 음역.
// action=save    : ADMIN이 확정한 name(선택)·nameVi 저장(nameVi 공백→null). AuditLog 기록.
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
  // suggest: name 초안 전달 시 그 이름 기준으로 음역(저장 전). 미전달 시 저장된 villa.name 사용.
  z.object({ action: z.literal("suggest"), name: z.string().max(100).optional() }),
  // save: name(선택)·nameVi. name 전달 시 trim 후 비어 있으면 400.
  z.object({
    action: z.literal("save"),
    name: z.string().max(100).optional(),
    nameVi: z.string().max(100),
  }),
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
    // 초안 name이 오면 그 이름 기준으로 음역(저장 전 새 이름 미리보기). 공백이면 저장된 이름으로 폴백.
    const draftName = parsed.data.name?.trim();
    const source = draftName && draftName.length > 0 ? draftName : villa.name;
    try {
      const suggestion = await romanizeVillaName(source);
      return NextResponse.json({ suggestion });
    } catch (e) {
      if (e instanceof GeminiNotConfiguredError) {
        return NextResponse.json({ error: "GEMINI_NOT_CONFIGURED" }, { status: 503 });
      }
      // 본문에 입력이 에코될 수 있으므로 메시지 일반화
      return NextResponse.json({ error: "SUGGEST_FAILED" }, { status: 502 });
    }
  }

  // ── 저장: ADMIN 확정값(nameVi 공백 → null, 미병기 폴백) ──
  const trimmedNameVi = parsed.data.nameVi.trim();
  const nextNameVi = trimmedNameVi.length === 0 ? null : trimmedNameVi;

  // 한국어명(name)은 선택 전송. 전달 시 trim 후 비어 있으면 400(운영자 판매 식별자 — null 불가).
  let nextName = villa.name;
  if (parsed.data.name !== undefined) {
    const trimmedName = parsed.data.name.trim();
    if (trimmedName.length === 0) {
      return NextResponse.json({ error: "VALIDATION_NAME_REQUIRED" }, { status: 400 });
    }
    nextName = trimmedName;
  }

  const nameChanged = nextName !== villa.name;
  const nameViChanged = nextNameVi !== villa.nameVi;
  if (!nameChanged && !nameViChanged) {
    return NextResponse.json({ name: villa.name, nameVi: nextNameVi }); // 변화 없음 — 멱등
  }

  await prisma.$transaction(async (tx) => {
    await tx.villa.update({
      where: { id: villa.id },
      data: {
        ...(nameChanged ? { name: nextName } : {}),
        ...(nameViChanged ? { nameVi: nextNameVi } : {}),
      },
    });
    await writeAuditLog({
      db: tx,
      userId: session.user.id,
      action: "UPDATE",
      entity: "Villa",
      entityId: villa.id,
      changes: {
        ...(nameChanged ? { name: { old: villa.name, new: nextName } } : {}),
        ...(nameViChanged ? { nameVi: { old: villa.nameVi, new: nextNameVi } } : {}),
      },
    });
  });

  return NextResponse.json({ name: nextName, nameVi: nextNameVi });
}
