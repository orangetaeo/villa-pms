// POST /api/zalo/translate — ADMIN 채팅 번역 미리보기 (T6.6 b14 + ADR-0009 S5)
// 발신 미리보기: ko 입력 → 대화 translateMode 기반 타깃(VI→vi, EN→en, OFF→미리보기 없음).
// 단일 진실원 = 라우트가 conversationId로 모드 조회(D7 미결 권고). 본인(ownerAdminId) 대화만.
// 하위호환: conversationId 없이 target만 와도 동작(기존 호출부). 읽기 전용(DB 미변경)이라 AuditLog 없음.
// 미설정(GEMINI_API_KEY 없음) 시 503 — 입력창은 원문 전송으로 폴백.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  GeminiNotConfiguredError,
  previewTargetForMode,
  translateText,
  type TranslateTarget,
} from "@/lib/gemini";
import { isOperator } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import { costThrottle } from "@/lib/cost-throttle";

const bodySchema = z.object({
  text: z.string().min(1).max(4000),
  // conversationId 우선(모드 조회). 없으면 target 직접 사용(하위호환).
  conversationId: z.string().min(1).optional(),
  target: z.enum(["vi", "ko", "en"]).optional(),
});

export async function POST(req: Request) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const g = await requireCapability(isOperator, "isOperator", req);
  if (!g.ok) return g.response;
  const session = g.session;
  // 비용 폭주 방어(Gemini 호출) — 사용자별 스로틀 (보안 P1-S11)
  const throttled = await costThrottle("translate", session.user.id);
  if (throttled) return throttled;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // ── 타깃 언어 결정 ────────────────────────────────────────────
  let target: TranslateTarget | null;
  if (parsed.data.conversationId) {
    // 본인 대화의 translateMode를 단일 진실원으로 사용(누수 차단: ownerAdminId 게이트).
    const conv = await prisma.zaloConversation.findFirst({
      where: { id: parsed.data.conversationId, ownerAdminId: session.user.id },
      select: { translateMode: true },
    });
    if (!conv) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    target = previewTargetForMode(conv.translateMode);
    // OFF → 미리보기 없음(Gemini 호출 0). 빈 응답으로 클라가 미리보기 숨김.
    if (target === null) {
      return NextResponse.json({ translated: "", mode: conv.translateMode });
    }
  } else if (parsed.data.target) {
    target = parsed.data.target; // 하위호환
  } else {
    return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
  }

  try {
    const translated = await translateText(parsed.data.text, target);
    return NextResponse.json({ translated });
  } catch (e) {
    if (e instanceof GeminiNotConfiguredError) {
      return NextResponse.json({ error: "TRANSLATE_NOT_CONFIGURED" }, { status: 503 });
    }
    // 본문에 메시지 텍스트가 에코될 수 있으므로 상태만 로그
    console.error("[zalo/translate] 번역 실패", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "TRANSLATE_FAILED" }, { status: 502 });
  }
}
