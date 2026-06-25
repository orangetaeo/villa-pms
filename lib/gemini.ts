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
export type TranslateTarget = "vi" | "ko" | "en" | "zh" | "ru";

const TARGET_LABEL: Record<TranslateTarget, string> = {
  vi: "Vietnamese (tiếng Việt)",
  ko: "Korean (한국어)",
  en: "English",
  zh: "Chinese (中文, Simplified)",
  ru: "Russian (Русский)",
};

/** 한글 음절 비율 — ko 번역 부분실패 감지용. 문자(letter)만 분모로 본다(숫자·기호 제외). */
export function hangulRatio(s: string): number {
  // 라틴(베트남어 성조 포함 á/à/ạ/ấ/đ … = Latin Extended)·한글 등 "글자"만 카운트.
  const letters = s.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return 1; // 글자 없음(숫자·이모지뿐) → 번역 판정 제외(정상 취급)
  const hangul = s.match(/[가-힣]/g);
  return (hangul?.length ?? 0) / letters.length;
}

/** 라틴 문자(베트남어 성조 포함) 글자 수 — 잔류 원문 추정용. */
function latinLetterCount(s: string): number {
  // ASCII a-z + Latin-1/Extended(À-ỹ 등): 베트남어 디아크리틱 포괄.
  return (s.match(/[A-Za-zÀ-ɏḀ-ỿ]/g) ?? []).length;
}

/** 두 문자열의 정규화 동일 여부(공백·대소문자 무시) — 원문 그대로 반환됐는지 판정. */
function isNearlyIdentical(a: string, b: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

/**
 * ko 번역 결과가 "거의 번역 안 된" 부분실패인지 판정.
 *  - 한글 비율이 매우 낮고(< 0.35) 라틴(베트남어 포함) 글자가 다수 잔류, 또는
 *  - 결과가 원문과 거의 동일.
 * ko가 아닌 타겟(vi/en)은 신뢰성 있는 잔류 판정 기준이 모호 → 재시도 대상에서 제외(정상 취급).
 * 입력에 애초에 한글이 많거나(번역 불필요한 ko 원문) 글자가 거의 없으면 정상으로 본다.
 */
export function isBrokenKoTranslation(source: string, output: string): boolean {
  const out = output.trim();
  if (out.length === 0) return false; // 빈 결과는 별도 처리(호출부가 swallow) — 부분실패 아님

  // 원문과 사실상 동일하게 되돌아온 경우(번역 안 함).
  if (isNearlyIdentical(source, out)) return true;

  const ratio = hangulRatio(out);
  const latin = latinLetterCount(out);
  // 한글 거의 없음 + 라틴(원문 잔류로 추정) 다수 → 부분실패.
  // 라틴 글자 수 임계(≥6)로 짧은 고유명사/브랜드 1~2단어만 라틴인 정상 번역은 통과.
  return ratio < 0.35 && latin >= 6;
}

/**
 * 문자열에서 "숫자 그룹"을 추출 — 천단위 구분자(,/. ·공백)는 한 숫자의 일부로 보고 제거 후 순수 digit만 반환.
 * 예: "1,700,000" → "1700000", "1.700.000" → "1700000". 매칭 비교 전용(소수점 구분 손실 무방 — 양쪽 동일 처리).
 */
function digitGroups(s: string): string[] {
  const matches = s.match(/\d[\d.,  ]*\d|\d/g) ?? [];
  return matches.map((m) => m.replace(/\D/g, "")).filter((d) => d.length > 0);
}

/**
 * 번역문이 원문의 금액·전화·연도 숫자를 "자릿수 보존 변형"(복사 오류) 없이 옮겼는지 판정.
 * 잡으려는 것: 원문 1,700,000 → 번역 1,770,000 처럼 **같은 자릿수에서 숫자만 바뀐** 환각·오타.
 * 통과시키는 것(오탐 방지): 베트남어 단위어/한국어 만·억 변환 같은 **정당한 표기 변경**
 *   (예: "119 nghìn"→"119,000", "100tr"→"1억", "50.000.000"→"5천만") — 자릿수가 달라지므로 제외.
 *
 * 판정: 원문의 큰 숫자 그룹(4자리↑)마다,
 *   - 그 숫자가 번역문에 그대로 있으면 보존(OK).
 *   - 없는데 번역문에 **같은 자릿수의 다른 숫자**가 있으면 = 자릿수 보존 변형 → false(오역 의심).
 *   - 같은 자릿수 그룹이 아예 없으면 = 단위 변환/포맷 변경으로 보고 통과(보수적).
 * 한 자리·세 자리 이하나 완전 누락(전화 통째 삭제 등)은 단위변환과 구분 불가라 가드 밖 — 프롬프트 지시로 1차 방어.
 */
export function numbersPreserved(source: string, output: string): boolean {
  const srcGroups = digitGroups(source).filter((d) => d.length >= 4);
  if (srcGroups.length === 0) return true; // 검사할 큰 숫자 없음 → 통과
  const outGroups = digitGroups(output);
  const outSet = new Set(outGroups);
  for (const s of srcGroups) {
    if (outSet.has(s)) continue; // 그대로 보존됨
    // 같은 자릿수의 다른 숫자가 출력에 있으면 = 복사 오류(오타·환각) 의심.
    if (outGroups.some((o) => o.length === s.length && o !== s)) return false;
    // 같은 자릿수 그룹이 없으면 = 정당한 단위 변환(nghìn/triệu/만·억)·포맷 변경으로 보고 통과.
  }
  return true;
}

const BASE_PROMPT_NOTE = `Translate the ENTIRE message completely; do NOT leave any part of the source untranslated.
Output ONLY the translation, with no quotes, no explanation, no preface.
Keep proper nouns (villa/complex names) unchanged.
Keep ALL numbers, money amounts, prices, dates, and phone numbers EXACTLY as written in the source — copy every digit verbatim. Do NOT round, alter, add, drop, or convert them (e.g. do not turn 1,700,000 into 170만; keep the digits).`;

const RETRY_PROMPT_NOTE = `Translate the ENTIRE message; do NOT leave ANY source text untranslated.
Output ONLY the full translation — no quotes, no explanation, no preface, no source text.
Keep proper nouns (villa/complex names) unchanged.
Keep ALL numbers, money amounts, prices, dates, and phone numbers EXACTLY as written in the source — copy every digit verbatim. Do NOT round, alter, add, drop, or convert them.`;

/** translateText 1회 호출(저수준) — 프롬프트·thinkingBudget를 파라미터로 받아 기본/재시도 공유. */
async function callTranslateOnce(
  apiKey: string,
  prompt: string,
  thinkingBudget: number,
  fetchFn: typeof fetch
): Promise<string> {
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
        // thinkingBudget:0(기본) — 짧은 채팅 번역은 추론 불필요. gemini-2.5-flash 기본(thinking)은
        // 번역당 ~600토큰·4초 소모 → thinking 끄면 품질 동일·~0.9초·토큰 1/8 (실측 2026-06-16).
        // 재시도에서만 소폭(>0) 부여해 부분실패(번역 중단·원문 잔류)를 완화한다.
        generationConfig: {
          temperature: 0.2,
          thinkingConfig: { thinkingBudget },
        },
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

/** 재시도 시 부여하는 thinkingBudget — 0이 부분실패 원인일 수 있어 소폭만(비용·지연 최소). */
const RETRY_THINKING_BUDGET = 256;

/**
 * 짧은 채팅 메시지 번역 — ko↔vi / ko↔en (GEMINI_API_KEY·모델 설정 재사용).
 * 결과는 번역문만 반환(설명·따옴표 없이). 빈 입력은 빈 문자열.
 * 번역 OFF 분기는 호출부 책임 — translateMode=OFF면 이 함수를 호출하지 않는다(D7.4).
 *
 * 견고화(부분실패 대응): gemini-2.5-flash(thinkingBudget:0)가 번역을 중간에 멈추고 원문(베트남어)을
 * 그대로 남기는 간헐 오류가 관측됨(예: "제가 양 nhà sản xuất tất…"). ko 타겟에 한해
 * 결과가 "거의 번역 안 됨"(한글 비율 낮음+라틴 잔류 / 원문과 동일)이면 강화 프롬프트로 1회 재시도하고,
 * 재시도에만 thinkingBudget를 소폭 부여한다. 둘 다 부분실패면 한글 비율이 더 높은 쪽을 반환(무한루프 없음).
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

  const basePrompt = `Translate the following message into ${TARGET_LABEL[target]}.
${BASE_PROMPT_NOTE}

Message:
${trimmed}`;

  // 1) 기본 호출(thinkingBudget:0 유지 — 비용).
  const first = await callTranslateOnce(apiKey, basePrompt, 0, fetchFn);

  // 재시도 트리거: ① ko 부분실패(원문 잔류) ② 숫자 누락(금액·전화 오역, 모든 타겟).
  const firstNumbersOk = numbersPreserved(trimmed, first);
  const firstBroken = (target === "ko" && isBrokenKoTranslation(trimmed, first)) || !firstNumbersOk;
  if (!firstBroken) {
    return first;
  }

  // 2) 강화 프롬프트 + thinkingBudget 소폭 부여로 1회 재시도(무한루프 금지).
  const retryPrompt = `Translate the following message into ${TARGET_LABEL[target]}.
${RETRY_PROMPT_NOTE}

Message:
${trimmed}`;
  let second: string;
  try {
    second = await callTranslateOnce(apiKey, retryPrompt, RETRY_THINKING_BUDGET, fetchFn);
  } catch {
    // 재시도 자체가 실패(HTTP 오류 등)하면 1차 결과라도 반환(흔적 보존).
    return first;
  }
  if (second.length === 0) return first; // 빈 결과는 채택 안 함.

  // 숫자 보존을 최우선으로 선택(금액 정확도 > 한글 비율). 한쪽만 보존하면 그쪽을 반환.
  const secondNumbersOk = numbersPreserved(trimmed, second);
  if (secondNumbersOk !== firstNumbersOk) {
    return secondNumbersOk ? second : first;
  }

  // 숫자 보존 동률이면: ko는 한글 비율↑ 우선, 그 외엔 재시도(강화 프롬프트) 결과 채택.
  if (target === "ko") {
    return hangulRatio(second) >= hangulRatio(first) ? second : first;
  }
  return second;
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

// ===================== 빌라명 음역 (ADR-0020 — 베트남어 병기 nameVi 제안) =====================

/**
 * 빌라명 음역 프롬프트 — 한국어 음역된 푸꾸옥 리조트/빌라명을 국제 통용 라틴 철자로 환원.
 * 예: "쏘나씨 V11" → "Sonasea V11", "썬셋 사나토 A3" → "Sunset Sanato A3", "그린베이 B2" → "Green Bay B2".
 * 호수·동·영숫자 코드(V11·A3·B2)는 그대로 보존. 설명·따옴표 없이 이름만.
 */
const VILLA_ROMANIZE_PROMPT = `You convert a Korean-transliterated villa or resort name in Phú Quốc, Vietnam into its official/internationally-used Latin (Vietnamese-friendly) spelling.

Rules:
- Output ONLY the converted name. No explanation, quotes, labels, or markdown.
- Convert the Korean transliteration of the resort/complex name to its real Latin spelling (e.g. 쏘나씨 → Sonasea, 썬셋 사나토 → Sunset Sanato, 그린베이 → Green Bay, 마리나 → Marina).
- Keep unit/block codes, numbers and Latin segments EXACTLY as given (V11, A3, B2, …).
- If the name is already in Latin (no Korean), return it unchanged.
- If unsure of the official spelling, give the most natural Latin transliteration.
- Preserve overall word order and spacing.

Name:`;

/**
 * 한국어 빌라명 → 라틴/베트남 통용 표기 음역 제안 (ADR-0020 nameVi 후보).
 * transcribeVoice/translateText REST 패턴 복제(키 게이트·타임아웃·x-goog-api-key·thinkingBudget:0).
 * ★ 제안값일 뿐 — ADMIN이 검수·확정 후 저장한다(무인 저장 금지). 빈 입력은 빈 문자열.
 *
 * @throws GeminiNotConfiguredError 키 미설정 / Error API 실패
 */
export async function romanizeVillaName(
  name: string,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiNotConfiguredError();

  const trimmed = name.trim();
  if (trimmed.length === 0) return "";

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
        contents: [{ parts: [{ text: `${VILLA_ROMANIZE_PROMPT} ${trimmed}` }] }],
        // thinkingBudget:0 — 짧은 음역은 추론 불필요(translateText와 동일 원칙).
        generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini API HTTP ${res.status}`);
  }

  const data = (await res.json()) as GeminiGenerateResponse;
  // 모델이 줄바꿈·따옴표를 붙이는 경우 정리 — 첫 줄·양끝 따옴표 제거
  const out = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
    .trim()
    .split("\n")[0]
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
  return out;
}

// ===================== 이미지 OCR 번역 (수신 photo 자막 — Nike ocrTranslateImage 차용) =====================

/**
 * 이미지 OCR 번역 프롬프트 (Nike ocrTranslateImage 차용 — 추출 후 번역, 번역문만 반환).
 * 소스 언어는 모델 자동감지. 텍스트가 없으면 빈 문자열(자막 미표시).
 * 제품/빌라명·숫자·가격·전화·날짜는 원형 유지, 줄바꿈 보존.
 */
const IMAGE_OCR_PROMPT_PREFIX = `You are an image OCR translator for a chat between a Korean operator and Vietnamese suppliers/guests.

Rules:
- Extract ALL visible text from this image.
- Translate the extracted text into`;
const IMAGE_OCR_PROMPT_SUFFIX = `.
- Output ONLY the translated text. No explanations, labels, quotes, or markdown.
- Keep proper nouns (villa/complex names), numbers, prices, sizes, phone numbers, and dates exactly as they are.
- Keep emoji and special characters as they are.
- If no text is found in the image, return an empty string.
- If the text is already in the target language, return it unchanged.
- Preserve line breaks where appropriate.`;

/**
 * 이미지 속 텍스트 OCR → 지정 언어 번역 — Gemini generateContent에 image inline_data로 전달.
 * ocrPassport(이미지 inline_data) + translateText(번역 프롬프트) REST 패턴 복제
 * (키 게이트·타임아웃·x-goog-api-key·thinkingBudget:0). 텍스트 없으면 모델이 빈 문자열 반환.
 *
 * 개인정보 주의: 이미지 base64·OCR 결과를 console/AuditLog에 절대 기록하지 않는다
 * (ocrPassport 원칙 계승 — 에러는 상태 코드·메시지만).
 *
 * @throws GeminiNotConfiguredError 키 미설정 / Error API 실패
 */
export async function translateImage(
  imageBase64: string,
  mimeType: string,
  target: TranslateTarget,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiNotConfiguredError();

  if (!imageBase64 || imageBase64.trim().length === 0) return "";

  const prompt = `${IMAGE_OCR_PROMPT_PREFIX} ${TARGET_LABEL[target]}${IMAGE_OCR_PROMPT_SUFFIX}`;

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
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: imageBase64 } },
            ],
          },
        ],
        // thinkingBudget:0 — OCR+짧은 번역은 추론 불필요(translateText와 동일 원칙).
        generationConfig: { temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  );

  if (!res.ok) {
    // 본문에 이미지가 에코될 수 있으므로 상태 코드만 로그
    throw new Error(`Gemini API HTTP ${res.status}`);
  }

  const data = (await res.json()) as GeminiGenerateResponse;
  const out = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return out.trim();
}
