// [SHARED-MODULE] from Nike src/app/api/ocr/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ocrPaymentImage } from "@/lib/gemini";
import { getSession } from "@/lib/auth";
import { createRateLimiter } from "@/lib/rate-limit";

import { withRequestLog } from "@/lib/request-log";
const ocrLimiter = createRateLimiter({ maxAttempts: 10, windowMs: 60 * 1000 });

async function _POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
    }
    const rateCheck = ocrLimiter.check(session.userId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.resetMs / 1000)) } }
      );
    }

    const { image, mimeType } = await request.json();
    if (!image) {
      return NextResponse.json({ success: false, error: "image required" }, { status: 400 });
    }

    const resultText = await ocrPaymentImage(image, mimeType);

    // Try to parse as JSON
    let parsed;
    try {
      // Extract JSON from the response (Gemini might wrap it in markdown code blocks)
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: resultText };
    } catch {
      parsed = { raw: resultText };
    }

    return NextResponse.json({ success: true, data: parsed });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          process.env.NODE_ENV === "development"
            ? error instanceof Error
              ? error.message
              : "OCR failed"
            : "서버 오류",
      },
      { status: 500 }
    );
  }
}

export const POST = withRequestLog(_POST);
