// POST /api/zalo/transcribe — ADMIN 음성 입력 받아쓰기(STT)
// 운영자가 마이크로 말한 오디오(base64)를 Gemini로 받아쓰기 → 원문 텍스트 반환.
// iOS Safari는 Web Speech 미지원 → MediaRecorder 녹음을 서버 STT로 처리(전 플랫폼 동작).
// 번역은 하지 않는다(받아쓴 원문만 반환) — 입력창의 기존 번역 미리보기·발송 번역이 담당.
// 읽기 전용(DB 미변경)이라 AuditLog 없음. 미설정(GEMINI_API_KEY 없음) 시 503.
//
// 개인정보: 오디오 base64·STT 결과를 console/AuditLog에 기록하지 않는다(gemini.ts 원칙 계승).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { GeminiNotConfiguredError, transcribeVoice } from "@/lib/gemini";
import { isOperator } from "@/lib/permissions";
import { costThrottle } from "@/lib/cost-throttle";

// base64 길이 상한(약 6MB 오디오) — 과대 업로드 방지. 클라가 60초 자동중단도 함.
const MAX_BASE64_LEN = 8_000_000;

const bodySchema = z.object({
  audioBase64: z.string().min(1).max(MAX_BASE64_LEN),
  mimeType: z.string().min(1).max(100),
});

export async function POST(req: Request) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isOperator(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  // 비용 폭주 방어(Gemini 전사) — 사용자별 스로틀 (보안 P1-S11)
  const throttled = await costThrottle("transcribe", session.user.id);
  if (throttled) return throttled;

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

  try {
    const text = await transcribeVoice(parsed.data.audioBase64, parsed.data.mimeType);
    return NextResponse.json({ text });
  } catch (e) {
    if (e instanceof GeminiNotConfiguredError) {
      return NextResponse.json({ error: "STT_NOT_CONFIGURED" }, { status: 503 });
    }
    // 본문에 오디오가 에코될 수 있으므로 상태만 로그
    console.error("[zalo/transcribe] STT 실패", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "STT_FAILED" }, { status: 502 });
  }
}
