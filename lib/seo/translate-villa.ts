// lib/seo/translate-villa.ts — 빌라 공개 소개문(description) 캐논(ko) → 비-ko 번역 (ADR-0050 Phase 2)
//
// ★ translate-article.ts의 축소판이다. 글은 블록 구조라 재조립이 필요했지만, 빌라 소개문은
//   **단일 텍스트(description)** 하나뿐이라 골격 재조립·재파싱이 없다(가드 4겹 중 구조 가드 제외).
//
// ★ 공개경계 3중 방어(ADR §결과):
//   ① 입력은 {id, description}만 — name/nameVi/주소/가격/원가 필드는 프롬프트에 **구조적으로 도달 불가**.
//   ② 프롬프트에서 가격·전화·주소 생성 금지를 명시.
//   ③ 출력 누수 가드(실명·금액·길이 폭주·빈 출력) 통과분만 READY. 하나라도 실패 시 FAILED(서빙 절대 불가).
// ★ descriptionVi(공급자 원문·미검증)는 절대 입력에 넣지 않는다 — vi도 검증된 ko description의 번역을 쓴다.
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { extractJsonFromAIResponse } from "@/lib/ai-utils";
import { writeAuditLog } from "@/lib/audit-log";
import { TRANSLATION_READY, TRANSLATION_FAILED } from "@/lib/seo/article-i18n";
import {
  INJECTION_GUARD,
  scanRealNameLeak,
  loadRealNameNeedles,
  scanMoneyLeak,
} from "@/lib/seo/translate-article";
import type { NonKoBlogLocale } from "@/lib/seo/blog-locale";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
// 소개문은 글 본문보다 짧다 — 채팅과 동급 타임아웃으로 충분하나 안전하게 넉넉히.
const GEMINI_TIMEOUT_MS = 45_000;
/** 번역이 원문 대비 이 배수를 넘으면 환각 의심(길이 폭주). */
const LENGTH_BLOWUP_RATIO = 3;

/** 번역 대상 언어 라벨(프롬프트용) — translate-article.ts와 동일. */
const TARGET_LABEL: Record<NonKoBlogLocale, string> = {
  en: "English",
  vi: "Vietnamese (Tiếng Việt)",
  ru: "Russian (Русский)",
  zh: "Simplified Chinese (简体中文)",
};

/**
 * 캐논 소스 해시 — sha256(description) hex.
 * ★ 번역/조회/저장(cron)이 **이 함수 하나만** 쓴다(계산법이 갈리면 영원히 stale로 오판정한다).
 */
export function villaSourceHash(description: string): string {
  return createHash("sha256").update(description ?? "", "utf8").digest("hex");
}

function buildPrompt(target: NonKoBlogLocale, description: string): string {
  return `You translate a Korean villa introduction into ${TARGET_LABEL[target]}.
You are given a JSON object with a single field "text" (the Korean source).

Rules:
- Return ONLY a JSON object: {"text":"<translation>"}. No extra keys, no commentary.
- Translate "text" into ${TARGET_LABEL[target]}. Never leave Korean in the output.
- Keep the brand "Villa GO" unchanged. Keep code names like "Villa Go #1234" exactly as written.
- Use standard/native spelling for place names (e.g. Phú Quốc, Vietnam).
- Do NOT add, remove, or invent information. Never add prices, money amounts, phone numbers, or addresses.
- Keep a natural, friendly travel tone. Keep line breaks where they are.
${INJECTION_GUARD}

<<<BEGIN>>>
${JSON.stringify({ text: description })}
<<<END>>>`;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** Gemini에 소개문을 보내 번역 텍스트를 받는다. 실패(키·HTTP·파싱)면 null. */
async function callGemini(
  target: NonKoBlogLocale,
  description: string,
  fetchFn: typeof fetch,
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(target, description) }] }],
          // responseMimeType 강제(커밋 e2e9022f 패턴) — 모델이 지시문을 복창해 파싱 실패하는 것 차단.
          generationConfig: {
            temperature: 0.3,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: "application/json",
          },
        }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as GeminiResponse;
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = extractJsonFromAIResponse<{ text?: unknown }>(raw);
    const text = parsed?.text;
    return typeof text === "string" ? text.trim() : null;
  } catch {
    return null;
  }
}

export interface TranslateVillaResult {
  locale: NonKoBlogLocale;
  status: typeof TRANSLATION_READY | typeof TRANSLATION_FAILED;
  errorNote: string | null;
}

/**
 * 빌라 소개문 1건을 target 언어로 번역해 VillaTranslation에 upsert.
 * 가드(①빈 출력 ②실명 누수 ③금액 누수 ④길이 폭주) 중 하나라도 실패 → FAILED로 저장(공개 제외).
 * ★ 구조 재조립·재파싱 가드는 없다 — description은 단일 텍스트라 골격 유실 개념이 없다(ADR §2).
 * ★ upsert는 항상 sourceHash를 기록한다 — READY든 FAILED든 어느 소스에 대한 결과인지 남긴다(stale·재시도 판정).
 */
export async function translateVillaDescription(
  villa: { id: string; description: string },
  locale: NonKoBlogLocale,
  opts: { db?: DbClient; fetchFn?: typeof fetch; realNameNeedles?: string[] } = {},
): Promise<TranslateVillaResult> {
  const db = opts.db ?? prisma;
  const fetchFn = opts.fetchFn ?? fetch;
  const source = villa.description ?? "";
  const sourceHash = villaSourceHash(source);
  const needles = opts.realNameNeedles ?? (await loadRealNameNeedles(db));

  let status: TranslateVillaResult["status"] = TRANSLATION_READY;
  let errorNote: string | null = null;

  const translated = await callGemini(locale, source, fetchFn);
  // 번역이 없으면(API 실패) 원문 폴백으로 채우되 FAILED로 저장(절대 서빙 안 됨).
  const out = translated && translated.length > 0 ? translated : source;

  if (!translated || translated.length === 0) {
    status = TRANSLATION_FAILED;
    errorNote = "gemini_no_response";
  } else {
    const nameHit = scanRealNameLeak(out, needles);
    const moneyHit = scanMoneyLeak(out);
    const srcLen = source.length;
    const outLen = out.length;
    if (nameHit) {
      status = TRANSLATION_FAILED;
      errorNote = `real_name_leak:${nameHit}`;
    } else if (moneyHit) {
      status = TRANSLATION_FAILED;
      errorNote = `money_leak:${moneyHit}`;
    } else if (srcLen > 0 && outLen > srcLen * LENGTH_BLOWUP_RATIO) {
      status = TRANSLATION_FAILED;
      errorNote = `length_blowup:${outLen}/${srcLen}`;
    }
  }

  const existing = await db.villaTranslation.findUnique({
    where: { villaId_locale: { villaId: villa.id, locale } },
    select: { id: true },
  });
  const now = new Date();
  await db.villaTranslation.upsert({
    where: { villaId_locale: { villaId: villa.id, locale } },
    create: {
      villaId: villa.id,
      locale,
      description: out,
      sourceHash,
      status,
      errorNote,
      model: GEMINI_MODEL,
      translatedAt: now,
    },
    update: {
      description: out,
      sourceHash,
      status,
      errorNote,
      model: GEMINI_MODEL,
      translatedAt: now,
    },
  });

  await writeAuditLog({
    userId: null,
    action: existing ? "UPDATE" : "CREATE",
    entity: "VillaTranslation",
    entityId: `${villa.id}:${locale}`,
    changes: {
      villaId: { new: villa.id },
      locale: { new: locale },
      status: { new: status },
      ...(errorNote ? { errorNote: { new: errorNote } } : {}),
    },
    db,
  });

  return { locale, status, errorNote };
}
