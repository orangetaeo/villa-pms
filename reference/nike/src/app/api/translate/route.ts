// [SHARED-MODULE] from Nike src/app/api/translate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { translateText, GeminiQuotaError } from "@/lib/gemini";
import { getSession } from "@/lib/auth";
import { createRateLimiter } from "@/lib/rate-limit";

import { withRequestLog } from "@/lib/request-log";
// AI 번역 Rate Limiting (사용자 기반, 1분당 30회)
const translateLimiter = createRateLimiter({
  maxAttempts: 30,
  windowMs: 60 * 1000,
});

async function _POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
    }

    const rateCheck = translateLimiter.check(session.userId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.resetMs / 1000)) } }
      );
    }

    const { text, from, to } = await request.json();

    if (!text || !from || !to) {
      return NextResponse.json(
        { success: false, error: "text, from, to are required" },
        { status: 400 }
      );
    }

    const translatedText = await translateText(text, from, to);
    return NextResponse.json({ success: true, data: { translatedText } });
  } catch (error) {
    // Gemini 한도/결제 소진은 별도 코드로 분리하여 프론트에서 사용자 안내 가능
    if (error instanceof GeminiQuotaError) {
      console.error("[/api/translate] Gemini quota exceeded:", error.message);
      return NextResponse.json(
        {
          success: false,
          code: "QUOTA_EXCEEDED",
          error: "AI 번역 한도 초과 — 관리자에게 문의하세요",
        },
        { status: 503, headers: { "Retry-After": "300" } }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error:
          process.env.NODE_ENV === "development"
            ? error instanceof Error
              ? error.message
              : "Translation failed"
            : "서버 오류",
      },
      { status: 500 }
    );
  }
}

export const POST = withRequestLog(_POST);
