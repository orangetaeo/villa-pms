// [SHARED-MODULE] from Nike src/lib/gemini.ts
import { GoogleGenAI } from "@google/genai";
import type { GenderSizeType } from "@/generated/prisma";
import { extractJsonFromAIResponse } from "./ai-utils";
import { getVNNow } from "@/lib/utils";
import { COMMISSION_OCR_PROMPT } from "./commission-ocr-shared";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY && process.env.NODE_ENV === "production") {
  console.error("[Gemini] GEMINI_API_KEY 환경변수가 설정되지 않았습니다");
}
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

/**
 * 기본 모델 — Gemini 3.5 Flash (2026-05 출시, GA).
 * 채팅 번역/STT는 thinking을 끄면 1초 내외로 빠르고, AI 발주·OCR은 thinking을
 * 유지해 추론/정확도를 보존한다. (2026-06-10 벤치마크: thinking ON 시 3.8s → OFF 1.0s)
 */
const MODEL = "gemini-3.5-flash";
/** 정확도 검증 경로(커미션 OCR useProModel)용 — preview 회피 + OCR 미벤치마크라 보수적으로 2.5-pro 유지 */
const PRO_MODEL = "gemini-2.5-pro";

/** 신규 SDK 호출 부분에 허용되는 contents 형태 (텍스트 단독 또는 텍스트+인라인 데이터) */
type GenContents =
  | string
  | Array<string | { inlineData: { mimeType: string; data: string } }>;

/**
 * @google/genai 공용 호출 헬퍼.
 * - thinking=false → thinkingConfig.thinkingBudget=0 (지연 최소화)
 * - thinking=true  → 모델 기본 동적 thinking 유지 (추론/정확도)
 * - json=true      → responseMimeType application/json
 * - Promise.race 타임아웃은 기존 동작 보존 (CDN/모델 무응답 시 호출부 매달림 방지)
 */
async function runGemini(opts: {
  contents: GenContents;
  thinking: boolean;
  model?: string;
  json?: boolean;
  timeoutMs?: number;
  timeoutLabel?: string;
}): Promise<string> {
  if (!ai) {
    throw new Error("Gemini API key not configured");
  }
  const config: { thinkingConfig?: { thinkingBudget: number }; responseMimeType?: string } = {};
  if (!opts.thinking) config.thinkingConfig = { thinkingBudget: 0 };
  if (opts.json) config.responseMimeType = "application/json";

  const call = ai.models.generateContent({
    model: opts.model ?? MODEL,
    contents: opts.contents,
    config,
  });

  const result = opts.timeoutMs
    ? await Promise.race([
        call,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(opts.timeoutLabel ?? "Gemini timeout")),
            opts.timeoutMs
          )
        ),
      ])
    : await call;

  return result.text ?? "";
}

/**
 * Sanitize user input to prevent prompt injection.
 * Wraps the text in delimiters so Gemini treats it as data, not instructions.
 */
function sanitizeForTranslation(text: string): string {
  return text.replace(/```/g, "").replace(/---/g, "").trim();
}

/**
 * Gemini API 한도/결제 관련 에러 (HTTP 429 quota / credits depleted).
 * 호출자는 instanceof로 감지하여 사용자에게 "한도 초과" 안내를 띄울 수 있다.
 */
export class GeminiQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiQuotaError";
  }
}

/**
 * Gemini SDK가 throw한 에러에서 한도/결제/일시적 장애 신호를 식별.
 * 일치하면 GeminiQuotaError로 재throw, 그 외는 원본 에러 그대로.
 */
function rethrowAsQuotaIfMatch(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  // Google Generative AI SDK 메시지 패턴:
  //  - "[429 Too Many Requests]" — 호출량 초과
  //  - "prepayment credits are depleted" — 선불 크레딧 소진
  //  - "quota" / "Quota exceeded"
  //  - "RESOURCE_EXHAUSTED"
  if (
    /\b429\b/.test(msg) ||
    /credits? (are )?depleted/i.test(msg) ||
    /quota/i.test(msg) ||
    /RESOURCE_EXHAUSTED/i.test(msg)
  ) {
    throw new GeminiQuotaError(msg);
  }
  throw err instanceof Error ? err : new Error(msg);
}

export async function translateText(text: string, from: string, to: string): Promise<string> {
  if (!ai) {
    throw new Error("Gemini API key not configured");
  }

  const sanitized = sanitizeForTranslation(text);
  if (!sanitized) return "";

  const prompt = `You are a translator for a Nike shoe store chat between a Korean shop owner and Vietnamese customers.

Rules:
- Translate ONLY the text inside the triple backticks from ${from} to ${to}.
- Return ONLY the translated text. No explanations, labels, or markdown.
- Keep product names (Nike, Air Max, Jordan, Dunk, etc.) in their original form.
- Keep numbers, prices, sizes, phone numbers, and dates exactly as they are.
- Keep emoji and special characters as they are.
- For very short expressions like greetings or "OK", translate naturally.
- If the text is already in the target language, return it unchanged.

\`\`\`
${sanitized}
\`\`\``;

  let raw: string;
  try {
    // 채팅 번역 — thinking OFF로 지연 최소화 (벤치마크 기준 ~1s)
    raw = await runGemini({
      contents: prompt,
      thinking: false,
      timeoutMs: 30_000,
      timeoutLabel: "Gemini translate timeout",
    });
  } catch (err) {
    rethrowAsQuotaIfMatch(err);
  }

  // Post-process: remove accidental markdown wrapping or labels
  let cleaned = raw!.trim();
  // Remove wrapping backticks if Gemini echoes them back
  if (cleaned.startsWith("```") && cleaned.endsWith("```")) {
    cleaned = cleaned.slice(3, -3).trim();
  }
  // Remove common prefixes Gemini sometimes adds
  cleaned = cleaned.replace(/^(Translation|번역|Dịch)[:\s]*/i, "").trim();

  return cleaned || raw.trim();
}

/**
 * OCR + 번역을 한번에 처리 (이미지 내 텍스트 추출 → 번역)
 */
export async function ocrTranslateImage(
  imageBase64: string,
  mimeType: string,
  from: string,
  to: string
): Promise<string> {
  if (!ai) {
    throw new Error("Gemini API key not configured");
  }

  const prompt = `You are an image OCR translator for a Nike shoe store chat between a Korean shop owner and Vietnamese customers.

Rules:
- Extract ALL visible text from this image.
- Translate the extracted text from ${from} to ${to}.
- Return ONLY the translated text. No explanations, labels, or markdown.
- Keep product names (Nike, Air Max, Jordan, Dunk, etc.) in their original form.
- Keep numbers, prices, sizes, phone numbers, and dates exactly as they are.
- Keep emoji and special characters as they are.
- If no text is found in the image, return an empty string.
- If the text is already in the target language, return it unchanged.
- Preserve the general layout/structure of the text (use line breaks where appropriate).`;

  let raw: string;
  try {
    // 채팅 이미지 OCR+번역 — thinking OFF (속도)
    raw = await runGemini({
      contents: [
        prompt,
        { inlineData: { mimeType: mimeType || "image/jpeg", data: imageBase64 } },
      ],
      thinking: false,
      timeoutMs: 30_000,
      timeoutLabel: "Gemini OCR translate timeout",
    });
  } catch (err) {
    rethrowAsQuotaIfMatch(err);
  }

  let cleaned = raw!.trim();
  if (cleaned.startsWith("```") && cleaned.endsWith("```")) {
    cleaned = cleaned.slice(3, -3).trim();
  }
  cleaned = cleaned.replace(/^(Translation|번역|Dịch|OCR)[:\s]*/i, "").trim();

  return cleaned;
}

export interface ProductSalesData {
  productId: string;
  productCode: string;
  productName: string;
  category: string;
  totalQuantitySold: number;
  totalSalesAmount: number; // 판매 금액 합계 (VND)
  avgDailySales: number;
  currentStock: number;
  pendingOrderQty: number; // 진행 중 발주 수량 (PENDING/CONFIRMED/SHIPPING/PARTIAL_ARRIVED)
  daysRemaining: number | null; // null if no sales
  price: number;
  sizeEU: string | null;
  sizeUS: string | null;
  sizeKR: string | null;
  parentProductId: string | null;
  parentProductName: string | null;
  trendDirection: "increasing" | "stable" | "decreasing" | null;

  // Phase 1 확장 필드
  /** 고객 유형별 판매 분포 */
  customerMix?: {
    walking: { qty: number; pct: number };
    expat: { qty: number; pct: number };
    guide: { qty: number; pct: number };
  };
  /** 모델 내 사이즈별 판매 비율 */
  sizeDistribution?: Array<{
    sizeKey: string; // "EU 43" 등
    qty: number;
    pct: number; // 0~1
  }>;
  /** 단기 트렌드 (최근 7일 vs 전체 기간) */
  weeklyTrend?: {
    last7dAvg: number;
    overallAvg: number;
    acceleration: "accelerating" | "stable" | "decelerating";
    strength: number; // 0~1
  };
  /** 안전재고/ROP 계산 결과 */
  safetyMetrics?: {
    safetyStock: number;
    reorderPoint: number;
    demandStdDev: number;
    leadTimeDays: number;
    belowROP: boolean; // 현재 재고 < ROP
  };
  /** 마지막 판매일로부터 경과일 */
  daysSinceLastSale?: number | null;
  /** 상품 이동 상태 */
  movementStatus?: "ACTIVE" | "SLOW" | "STALE" | "STOCKOUT" | "COLD_START";
  /** 품절 복구 쿼리로 추가된 상품 여부 (90일 lookback) */
  isStockoutRecovery?: boolean;

  // Phase 2 확장 필드
  /** 품절 보정된 일평균 판매량 (재고 0인 날 제외 후 보정) */
  adjustedAvgDailySales?: number;
  /** 성별 사이즈 유형 (AI 예측 필터링) */
  genderSizeType?: GenderSizeType | null;
  /** 요일별 판매 가중치 (mon=1.0 기준 상대값) */
  weekdayPattern?: {
    mon: number;
    tue: number;
    wed: number;
    thu: number;
    fri: number;
    sat: number;
    sun: number;
  };
}

export interface PredictionItem {
  productId: string;
  productCode: string;
  productName: string;
  currentStock: number;
  avgDailySales: number;
  daysRemaining: number | null;
  suggestedOrderQty: number;
  priority: "urgent" | "normal" | "low";
  reasoning: string;
  sizeEU: string | null;
  sizeUS: string | null;
  sizeKR: string | null;
  parentProductId: string | null;
  parentProductName: string | null;
  trendDirection?: "increasing" | "stable" | "decreasing" | null;
}

export interface PredictionResult {
  predictions: PredictionItem[];
  summary: string;
}

export async function analyzeOrderPrediction(salesData: string): Promise<string> {
  if (!ai) {
    throw new Error("Gemini API key not configured");
  }
  const prompt = `Based on the following sales data, predict the optimal reorder quantities and timing. Respond in Korean.\n\nSales Data:\n${salesData}`;
  // AI 발주 — thinking 유지 (추론 정확도)
  return runGemini({ contents: prompt, thinking: true });
}

export async function analyzeOrderPredictionStructured(
  products: ProductSalesData[],
  analysisDays: number
): Promise<PredictionResult> {
  if (!ai) {
    throw new Error("Gemini API key not configured");
  }

  const productDataStr = products
    .map((p) => {
      const sizeStr =
        p.sizeEU || p.sizeUS || p.sizeKR
          ? ` (사이즈: ${[p.sizeEU && `EU ${p.sizeEU}`, p.sizeUS && `US ${p.sizeUS}`, p.sizeKR && `KR ${p.sizeKR}`].filter(Boolean).join("/")})`
          : "";
      const parentStr = p.parentProductName ? ` [모델: ${p.parentProductName}]` : "";
      const trendStr = p.trendDirection
        ? ` 추세: ${p.trendDirection === "increasing" ? "증가" : p.trendDirection === "decreasing" ? "감소" : "안정"}`
        : "";
      return (
        `- ${p.productCode} "${p.productName}"${sizeStr}${parentStr} (카테고리: ${p.category}): ` +
        `최근 ${analysisDays}일간 총 ${p.totalQuantitySold}개 판매, ` +
        `일평균 ${p.avgDailySales.toFixed(2)}개, ` +
        `현재 재고 ${p.currentStock}개, ` +
        `잔여일수 ${p.daysRemaining !== null ? p.daysRemaining.toFixed(1) + "일" : "판매 없음"}, ` +
        `단가 ${p.price.toLocaleString()}VND` +
        (trendStr ? `, ${trendStr}` : "")
      );
    })
    .join("\n");

  const currentMonth = getVNNow().getUTCMonth() + 1;
  const season =
    currentMonth >= 3 && currentMonth <= 5
      ? "봄"
      : currentMonth >= 6 && currentMonth <= 8
        ? "여름"
        : currentMonth >= 9 && currentMonth <= 11
          ? "가을"
          : "겨울";

  const prompt = `당신은 Nike 매장의 재고 관리 AI 전문가입니다.

아래는 최근 ${analysisDays}일간의 상품별 판매 데이터입니다. 이 데이터를 분석하여 발주 추천을 생성해주세요.

## 상품 데이터
${productDataStr}

## 분석 기준
- **긴급 (urgent)**: 잔여일수 7일 미만 또는 재고 0인 상품
- **보통 (normal)**: 잔여일수 7~14일인 상품
- **낮음 (low)**: 잔여일수 14일 이상이지만 발주 고려가 필요한 상품
- 리드타임(발주~입고): 약 7~14일 고려
- 안전재고 = 리드타임(10일) x 일평균판매 x 1.5 (안전계수)
- 발주 수량: 일평균 판매량 x 30일분 (1개월치) 권장, 최소 발주 단위 고려
- 판매가 없는 상품은 제외하되, 재고 0인데 과거 판매가 있었다면 포함
- 증가 추세 상품 → 발주량 x1.5 상향 조정
- 감소 추세 상품 → 발주량 x0.7 하향 조정
- 같은 모델의 사이즈별 판매 비율 고려하여 인기 사이즈 추가 발주 추천
- 현재 계절(${season}) 고려

## 최소 발주 수량 (MOQ) 규칙
모델 그룹(같은 parentProductId) 단위로 최소 발주 수량이 존재합니다:
- 신발 (NSI* 코드): 모델당 최소 18개 (전 사이즈 합산)
- 명품 (LXS* 코드): 모델당 최소 12개
- 의류 (기타 코드): 모델당 최소 80개
- 모자 (300* 코드): 모델당 최소 100개
발주 추천 시 같은 모델의 사이즈별 합계가 반드시 MOQ 이상이 되도록 수량을 조정해주세요.
MOQ 미달이면 판매 비율에 맞춰 상향 조정하세요.

## 응답 형식
반드시 아래 JSON 형식으로만 응답하세요.

{
  "predictions": [
    {
      "productId": "상품ID",
      "productCode": "상품코드",
      "productName": "상품명",
      "currentStock": 0,
      "avgDailySales": 0,
      "daysRemaining": null,
      "suggestedOrderQty": 0,
      "priority": "urgent",
      "reasoning": "한국어로 된 추천 사유",
      "sizeEU": null,
      "sizeUS": null,
      "sizeKR": null,
      "parentProductId": null,
      "parentProductName": null
    }
  ],
  "summary": "전체 분석 요약 (한국어)"
}

중요: 발주가 필요한 상품만 포함하세요. priority가 높은 순서(urgent > normal > low)로 정렬하세요.`;

  // AI 발주(구조화) — thinking 유지(추론) + JSON 응답
  const rawText = await runGemini({ contents: prompt, thinking: true, json: true });

  const parsed = extractJsonFromAIResponse<PredictionResult>(rawText);

  if (!parsed || !Array.isArray(parsed.predictions)) {
    console.error("[Gemini] JSON 파싱 실패. rawText 앞 1000자:", rawText.slice(0, 1000));
    return {
      predictions: [],
      summary: "Gemini AI 분석 결과를 파싱하지 못했습니다. 다시 시도해주세요.",
    };
  }

  // Validate and ensure correct data from our DB
  parsed.predictions = parsed.predictions.map((pred) => {
    const original = products.find(
      (p) => p.productCode === pred.productCode || p.productId === pred.productId
    );
    if (original) {
      pred.productId = original.productId;
      pred.productCode = original.productCode;
      pred.productName = original.productName;
      pred.currentStock = original.currentStock;
      pred.avgDailySales = original.avgDailySales;
      pred.daysRemaining = original.daysRemaining;
      pred.sizeEU = original.sizeEU;
      pred.sizeUS = original.sizeUS;
      pred.sizeKR = original.sizeKR;
      pred.parentProductId = original.parentProductId;
      pred.parentProductName = original.parentProductName;
    }
    return pred;
  });

  return parsed;
}

/**
 * 음성 오디오를 텍스트로 변환 (Speech-to-Text)
 */
export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
  language: "ko" | "vi"
): Promise<string> {
  if (!ai) {
    throw new Error("Gemini API key not configured");
  }

  const langName = language === "ko" ? "한국어 (Korean)" : "tiếng Việt (Vietnamese)";

  const prompt = `You are a speech-to-text transcription system for a Nike shoe store chat.

Rules:
- Transcribe the audio EXACTLY as spoken in ${langName}.
- Return ONLY the transcribed text. No explanations, labels, timestamps, or markdown.
- Keep product names (Nike, Air Max, Jordan, Dunk, etc.) in their original English form.
- Keep numbers, prices, sizes as spoken.
- If the audio is unclear or silent, return an empty string.
- Do NOT translate — transcribe in the original spoken language only.`;

  // 음성 STT — thinking OFF(속도). 타임아웃 + 한도초과 분류는 기존 패턴 유지:
  // 음성은 처리 시간이 길어 무제한 await 시 호출부 Promise가 매달려 GC되지 않으므로 race로 제한
  let raw: string;
  try {
    raw = await runGemini({
      contents: [prompt, { inlineData: { mimeType, data: audioBase64 } }],
      thinking: false,
      timeoutMs: 30_000,
      timeoutLabel: "Gemini transcribe timeout",
    });
  } catch (err) {
    rethrowAsQuotaIfMatch(err);
  }

  let cleaned = raw!.trim();
  if (cleaned.startsWith("```") && cleaned.endsWith("```")) {
    cleaned = cleaned.slice(3, -3).trim();
  }
  cleaned = cleaned.replace(/^(Transcription|Transcript|받아쓰기)[:\s]*/i, "").trim();

  return cleaned;
}

/**
 * 커미션 메시지 이미지에서 구조화 JSON 추출 (OCR)
 * 카카오톡 커미션 메시지 사진 → 가이드명, 날짜, 카테고리별 수량/매출/커미션, 총합
 * @param useProModel true이면 gemini-2.5-pro 사용 (사진 먼저 검증 플로우용)
 */
export async function ocrCommissionMessage(
  imageBase64: string,
  mimeType: string,
  useProModel: boolean = false
): Promise<string> {
  if (!ai) {
    throw new Error("Gemini API key not configured");
  }
  // 커미션 OCR — 정확도 중요(한글 이름 1글자도 틀리면 매칭 실패) → thinking 유지.
  // useProModel(검증 경로)은 2.5-pro 유지(OCR 미벤치마크라 보수적), 일반은 3.5-flash
  const ocrModel = useProModel ? PRO_MODEL : MODEL;

  const prompt = COMMISSION_OCR_PROMPT;

  const callGemini = () =>
    runGemini({
      model: ocrModel,
      contents: [
        prompt,
        { inlineData: { mimeType: mimeType || "image/jpeg", data: imageBase64 } },
      ],
      thinking: true,
      json: true,
      timeoutMs: 25_000, // 1회 시도당 25초 (재시도 포함 총 ~50초)
      timeoutLabel: "Gemini OCR commission timeout",
    });

  // 1회 재시도 (Gemini 일시 에러 대응)
  try {
    return await callGemini();
  } catch (firstError) {
    console.warn(
      "[ocrCommissionMessage] 1차 실패, 재시도:",
      firstError instanceof Error ? firstError.message : firstError
    );
    return await callGemini();
  }
}

export async function ocrPaymentImage(
  imageBase64: string,
  mimeType: string = "image/jpeg"
): Promise<string> {
  if (!ai) {
    throw new Error("Gemini API key not configured");
  }
  // 결제 OCR — 정확도 중요 → thinking 유지
  return runGemini({
    contents: [
      "Extract all text, amounts, and payment details from this payment receipt image. Respond in JSON format with fields: amount, date, sender, receiver, reference.",
      { inlineData: { mimeType: mimeType || "image/jpeg", data: imageBase64 } },
    ],
    thinking: true,
  });
}
