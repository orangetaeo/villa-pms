// [SHARED-MODULE] from Nike src/app/api/translate-image/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ocrTranslateImage, GeminiQuotaError } from "@/lib/gemini";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { createRateLimiter } from "@/lib/rate-limit";

import { withRequestLog } from "@/lib/request-log";
export const runtime = "nodejs";

const translateImageLimiter = createRateLimiter({ maxAttempts: 15, windowMs: 60 * 1000 });

/** 이미지 OCR + 번역 */
async function _POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
    }
    const rateCheck = translateImageLimiter.check(session.userId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.resetMs / 1000)) } }
      );
    }

    const { attachmentId, from, to, retry } = await request.json();

    if (!attachmentId || !from || !to) {
      return NextResponse.json(
        { success: false, error: "attachmentId, from, to are required" },
        { status: 400 }
      );
    }

    const attachment = await prisma.zaloAttachment.findUnique({
      where: { id: attachmentId },
      select: { thumbData: true, mimeType: true, ocrTranslatedText: true },
    });

    if (!attachment) {
      return NextResponse.json({ success: false, error: "Attachment not found" }, { status: 404 });
    }

    // 캐시된 결과 반환 (retry 시 무시)
    if (!retry && attachment.ocrTranslatedText) {
      return NextResponse.json({
        success: true,
        data: { ocrTranslatedText: attachment.ocrTranslatedText },
      });
    }

    // OCR용 고해상도 이미지 준비 (thumbData는 320px/60%라 OCR 품질 부족)
    // 우선순위: originalUrl 재다운로드(고해상도) > thumbData(최후 수단)
    const fullAtt = await prisma.zaloAttachment.findUnique({
      where: { id: attachmentId },
      select: { originalUrl: true },
    });

    let ocrBuffer: Buffer | null = null;
    let ocrMimeType = attachment.mimeType || "image/jpeg";

    // 1) originalUrl에서 OCR 전용 고해상도 이미지 생성
    if (fullAtt?.originalUrl) {
      try {
        const { compressImageForOcr } = await import("@/lib/image-compress");
        const result = await compressImageForOcr(fullAtt.originalUrl);
        ocrBuffer = result.data;
        ocrMimeType = result.mimeType;

        // thumbData가 없었으면 함께 저장
        if (!attachment.thumbData) {
          const { compressImageToThumb } = await import("@/lib/image-compress");
          const thumb = await compressImageToThumb(fullAtt.originalUrl);
          await prisma.zaloAttachment.update({
            where: { id: attachmentId },
            data: {
              thumbData: new Uint8Array(thumb.data),
              thumbWidth: thumb.width,
              thumbHeight: thumb.height,
              mimeType: thumb.mimeType,
            },
          });
        }
      } catch {
        // URL 만료 등으로 다운로드 실패
      }
    }

    // 2) 원본 다운로드 실패 시 thumbData를 최후 수단으로 사용
    if (!ocrBuffer && attachment.thumbData) {
      ocrBuffer = Buffer.from(attachment.thumbData);
    }

    if (!ocrBuffer) {
      return NextResponse.json(
        {
          success: false,
          error: "이미지 데이터를 불러올 수 없습니다. 원본 URL이 만료되었을 수 있습니다.",
        },
        { status: 400 }
      );
    }

    // OCR + 번역 (고해상도 이미지 사용)
    const imageBase64 = ocrBuffer.toString("base64");
    const ocrTranslatedText = await ocrTranslateImage(imageBase64, ocrMimeType, from, to);

    // DB 저장 (빈 문자열도 저장하여 재시도 방지)
    await prisma.zaloAttachment.update({
      where: { id: attachmentId },
      data: { ocrTranslatedText: ocrTranslatedText || "" },
    });

    return NextResponse.json({
      success: true,
      data: { ocrTranslatedText: ocrTranslatedText || "" },
    });
  } catch (error) {
    if (error instanceof GeminiQuotaError) {
      console.error("[/api/translate-image] Gemini quota exceeded:", error.message);
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
              : "Image OCR translation failed"
            : "서버 오류",
      },
      { status: 500 }
    );
  }
}

export const POST = withRequestLog(_POST);
