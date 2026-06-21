import { z } from "zod";
import { extractJsonFromAIResponse } from "@/lib/ai-utils";

/**
 * Gemini API 클라이언트 (T3.1 — 여권 OCR. 번역은 T6.6에서 확장)
 * REST fetch 직접 호출 — 의존성 추가 없음 (package.json 동결, 계약 선언).
 *
 * 개인정보 주의: 이미지 base64·OCR 결과를 console/AuditLog에 절대 기록하지 않는다
 * (QA 권고 4 — 에러 로그에는 상태 코드·메시지만).
 */

// gemini-2.0-flash는 2026-06 기준 퇴역("no longer available" 404) — 모델 수명 주기 대비
// GEMINI_MODEL 환경변수로 핀 교체 가능 (코드 무변경 운영 — 프로덕션 404 실측 후 교체)
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
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

// ===================== 번역 (T6.6 — b14 Zalo 채팅) =====================

/**
 * 번역 대상 언어 (ADR-0009 D7.4) — 소스 언어는 모델 자동감지(프롬프트에서 미명시).
 *  vi: 공급자(베트남어) 발신 미리보기. en: 영어권 발신 미리보기.
 *  ko: 수신 메시지(vi/en) → 운영자용 한국어. ADMIN 기준 언어는 항상 ko.
 */
export type TranslateTarget = "vi" | "ko" | "en";

const TARGET_LABEL: Record<TranslateTarget, string> = {
  vi: "Vietnamese (tiếng Việt)",
  ko: "Korean (한국어)",
  en: "English",
};

/**
 * 짧은 채팅 메시지 번역 — ko↔vi / ko↔en (GEMINI_API_KEY·모델 설정 재사용).
 * 결과는 번역문만 반환(설명·따옴표 없이). 빈 입력은 빈 문자열.
 * 번역 OFF 분기는 호출부 책임 — translateMode=OFF면 이 함수를 호출하지 않는다(D7.4).
 * @throws GeminiNotConfiguredError 키 미설정 / Error API 실패
 */
export async function translateText(
  text: string,
  target: TranslateTarget,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiNotConfiguredError();

  const trimmed = text.trim();
  if (trimmed.length === 0) return "";

  const prompt = `Translate the following message into ${TARGET_LABEL[target]}.
Output ONLY the translation, with no quotes, no explanation, no preface.
Keep proper nouns (villa/complex names) unchanged.

Message:
${trimmed}`;

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
        contents: [{ parts: [{ text: prompt }] }],
        // thinkingBudget:0 — 짧은 채팅 번역은 추론 불필요. gemini-2.5-flash 기본(thinking)은
        // 번역당 ~600토큰·4초 소모 → thinking 끄면 품질 동일·~0.9초·토큰 1/8 (실측 2026-06-16).
        generationConfig: { temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini API HTTP ${res.status}`);
  }

  const data = (await res.json()) as GeminiGenerateResponse;
  const out = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return out.trim();
}

/**
 * 대화 translateMode → 발신 미리보기 타깃 언어 (ADR-0009 D7.4).
 *  VI → "vi", EN → "en", OFF → null(미리보기 없음 — 호출부가 스킵).
 * 수신 자동번역의 타깃은 항상 "ko"(운영자가 읽음)이므로 별도 매핑 불필요 —
 * 모드가 OFF가 아니면 ko로 번역한다.
 */
export function previewTargetForMode(mode: "OFF" | "VI" | "EN"): TranslateTarget | null {
  if (mode === "VI") return "vi";
  if (mode === "EN") return "en";
  return null; // OFF
}

// ===================== 음성 STT (S5 A6-3 — 수신 voice 받아쓰기) =====================

/**
 * 음성 받아쓰기 프롬프트 (Nike transcribeAudio 차용 — 번역 금지·받아쓰기만).
 * 소스 언어는 모델 자동감지(베트남 상대 위주). 불명확/무음이면 빈 문자열.
 */
const STT_PROMPT = `Transcribe the audio EXACTLY as spoken, in its original language.
Return ONLY the transcribed text. No translation, no explanation, no labels, no timestamps, no markdown.
If the audio is unclear or silent, return an empty string.`;

/**
 * 음성 STT(받아쓰기) — Gemini generateContent에 audio inline_data로 전달 → 텍스트 반환.
 * ocrPassport/translateText REST 패턴 복제(키 게이트·타임아웃·x-goog-api-key·thinkingBudget:0).
 * 결과는 받아쓴 원문(번역 X). 호출부가 필요 시 translateText로 ko 번역한다.
 *
 * 개인정보 주의: 오디오 base64·STT 결과를 console/AuditLog에 절대 기록하지 않는다
 * (ocrPassport 원칙 계승 — 에러는 상태 코드·메시지만).
 *
 * @throws GeminiNotConfiguredError 키 미설정 / Error API 실패
 */
export async function transcribeVoice(
  audioBase64: string,
  mimeType: string,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiNotConfiguredError();

  if (!audioBase64 || audioBase64.trim().length === 0) return "";

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
              { text: STT_PROMPT },
              { inline_data: { mime_type: mimeType, data: audioBase64 } },
            ],
          },
        ],
        // thinkingBudget:0 — 받아쓰기는 추론 불필요(번역과 동일 원칙).
        generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  );

  if (!res.ok) {
    // 본문에 오디오가 에코될 수 있으므로 상태 코드만 로그
    throw new Error(`Gemini API HTTP ${res.status}`);
  }

  const data = (await res.json()) as GeminiGenerateResponse;
  const out = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return out.trim();
}
