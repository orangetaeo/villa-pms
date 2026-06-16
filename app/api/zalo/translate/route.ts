// POST /api/zalo/translate — ADMIN 채팅 번역 미리보기 (T6.6, b14)
// ko 입력 → vi 미리보기(발신 전), 또는 수신 vi → ko. 읽기 전용(DB 미변경)이므로 AuditLog 없음.
// 미설정(GEMINI_API_KEY 없음) 시 503 — 입력창은 원문 전송으로 폴백.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { GeminiNotConfiguredError, translateText } from "@/lib/gemini";

const bodySchema = z.object({
  text: z.string().min(1).max(4000),
  target: z.enum(["vi", "ko"]),
});

export async function POST(req: Request) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

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

  try {
    const translated = await translateText(parsed.data.text, parsed.data.target);
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
