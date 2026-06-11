import { z } from "zod";
import { extractJsonFromAIResponse } from "@/lib/ai-utils";

/**
 * Gemini API 클라이언트 (T3.1 — 여권 OCR. 번역은 T6.6에서 확장)
 * REST fetch 직접 호출 — 의존성 추가 없음 (package.json 동결, 계약 선언).
 *
 * 개인정보 주의: 이미지 base64·OCR 결과를 console/AuditLog에 절대 기록하지 않는다
 * (QA 권고 4 — 에러 로그에는 상태 코드·메시지만).
 */

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_TIMEOUT_MS = 30_000;

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super("GEMINI_API_KEY가 설정되지 않았습니다");
    this.name = "GeminiNotConfiguredError";
  }
}

/** 여권 OCR 결과 — 전 필드 string|null (모델 출력 신뢰 금지, ADMIN이 확인·수정) */
const passportDataSchema = z.object({
  surname: z.string().nullable().catch(null),
  givenNames: z.string().nullable().catch(null),
  passportNo: z.string().nullable().catch(null),
  nationality: z.string().nullable().catch(null),
  birthDate: z.string().nullable().catch(null),
  expiryDate: z.string().nullable().catch(null),
  sex: z.string().nullable().catch(null),
});
export type PassportOcrData = z.infer<typeof passportDataSchema>;

const OCR_PROMPT = `이미지는 여권의 신원정보 면이다. 다음 필드를 JSON으로만 응답하라(설명 금지).
읽을 수 없는 필드는 null. 날짜는 YYYY-MM-DD.
{"surname": string|null, "givenNames": string|null, "passportNo": string|null, "nationality": string|null (ISO 3자리 또는 2자리 코드), "birthDate": string|null, "expiryDate": string|null, "sex": string|null}`;

interface GeminiGenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/**
 * 여권 이미지 OCR — 부분 추출 허용(누락 필드 null).
 * @throws GeminiNotConfiguredError 키 미설정 / Error API·파싱 실패
 */
export async function ocrPassport(
  imageBase64: string,
  mimeType: string,
  fetchFn: typeof fetch = fetch
): Promise<PassportOcrData> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiNotConfiguredError();

  const res = await fetchFn(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: OCR_PROMPT },
              { inline_data: { mime_type: mimeType, data: imageBase64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    }
  );

  if (!res.ok) {
    // 본문에 이미지가 에코될 수 있으므로 상태 코드만 로그
    throw new Error(`Gemini API HTTP ${res.status}`);
  }

  const data = (await res.json()) as GeminiGenerateResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const raw = extractJsonFromAIResponse<Record<string, unknown>>(text);
  if (!raw) throw new Error("OCR 응답에서 JSON을 추출하지 못했습니다");

  return passportDataSchema.parse(raw);
}
