import { z } from "zod";
import { auth } from "@/auth";
import { GeminiNotConfiguredError, ocrPassport } from "@/lib/gemini";
import { isOperator } from "@/lib/permissions";

/**
 * POST /api/ocr/passport — 여권 OCR (T3.1, ADMIN 전용)
 * 결과는 저장하지 않는다 — 화면에서 ADMIN이 확인·수정 후 체크인 완료에 포함 (오인식 방어).
 * 개인정보: imageBase64·OCR 결과를 로그에 기록하지 않는다 (QA 권고 4).
 */

const MAX_BASE64_LENGTH = 8 * 1024 * 1024; // base64 8MB ≈ 원본 6MB (업로드 5MB와 정합)
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

const ocrSchema = z.object({
  imageBase64: z.string().min(1).max(MAX_BASE64_LENGTH, "이미지가 너무 큽니다"),
  mimeType: z.enum(ALLOWED_MIMES),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isOperator(session.user.role)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = ocrSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const data = await ocrPassport(parsed.data.imageBase64, parsed.data.mimeType);
    return Response.json({ data });
  } catch (e) {
    if (e instanceof GeminiNotConfiguredError) {
      // 수동 입력 폴백 신호 — UI가 안내 배너 표시
      return Response.json({ error: "ocr_not_configured" }, { status: 503 });
    }
    // 개인정보 비기록 — 에러 타입·메시지만 (이미지·OCR 결과 미포함)
    console.error("[ocr/passport] 실패:", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "ocr_failed" }, { status: 502 });
  }
}
