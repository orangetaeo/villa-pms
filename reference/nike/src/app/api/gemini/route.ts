// [SHARED-MODULE] from Nike src/app/api/gemini/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  translateText,
  analyzeOrderPrediction,
  ocrPaymentImage,
  GeminiQuotaError,
} from "@/lib/gemini";
import { getSession } from "@/lib/auth";
import { createRateLimiter } from "@/lib/rate-limit";

import { withRequestLog } from "@/lib/request-log";
const geminiLimiter = createRateLimiter({ maxAttempts: 10, windowMs: 60 * 1000 });

async function _POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
    }
    const rateCheck = geminiLimiter.check(session.userId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.resetMs / 1000)) } }
      );
    }

    const body = await request.json();
    const { action, ...params } = body;

    let result: string;

    switch (action) {
      case "translate":
        if (!params.text || typeof params.text !== "string") {
          return NextResponse.json({ success: false, error: "text가 필요합니다" }, { status: 400 });
        }
        if (!params.from || !params.to) {
          return NextResponse.json(
            { success: false, error: "from/to 언어가 필요합니다" },
            { status: 400 }
          );
        }
        result = await translateText(params.text, params.from, params.to);
        break;
      case "predict":
        if (!params.salesData) {
          return NextResponse.json(
            { success: false, error: "salesData가 필요합니다" },
            { status: 400 }
          );
        }
        result = await analyzeOrderPrediction(params.salesData);
        break;
      case "ocr":
        if (!params.imageBase64 || typeof params.imageBase64 !== "string") {
          return NextResponse.json(
            { success: false, error: "imageBase64가 필요합니다" },
            { status: 400 }
          );
        }
        if (params.imageBase64.length > 5_600_000) {
          return NextResponse.json(
            { success: false, error: "이미지가 너무 큽니다 (최대 4MB)" },
            { status: 400 }
          );
        }
        result = await ocrPaymentImage(params.imageBase64);
        break;
      default:
        return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof GeminiQuotaError) {
      console.error("[/api/gemini] Gemini quota exceeded:", error.message);
      return NextResponse.json(
        {
          success: false,
          code: "QUOTA_EXCEEDED",
          error: "AI 한도 초과 — 관리자에게 문의하세요",
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
              : "Unknown error"
            : "서버 오류",
      },
      { status: 500 }
    );
  }
}

export const POST = withRequestLog(_POST);
