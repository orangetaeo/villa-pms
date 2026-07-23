// lib/youtube/meta.ts — 유튜브 쇼츠 제목·설명·태그 생성 (youtube-shorts-s1 콘텐츠 1)
//
// Gemini(카피 가이드 주입) + 결정형 조합으로 videos.insert snippet 메타를 만든다:
//   title       — 한국어 후킹형, ≤100자(강제 truncate).
//   description — 첫 줄 후킹 + 빌라 공개정보 요약 + 카카오 채널 텍스트(pf.kakao.com/_mVAfX) + 해시태그(#Shorts…).
//   tags        — 키워드 문자열 배열(# 없음), 총합 ≤500자 가드(YouTube 태그 상한).
// Gemini 미설정·실패 시 결정형 폴백. 금칙어 가드(caption.ts 재사용) → flaggedTerms.
//
// ★ 누수 절대 금지: 입력은 빌라 공개 정보(VillaPublicInfo)만 — 원가·마진·판매가·supplier 미포함(caption.ts와 동일 봉인).
//   확정가 박제 금지 — 설명·제목에 가격 숫자를 넣지 않는다("카톡 견적" 톤).
import {
  deriveFeatureTags,
  findBannedTerms,
  pickHeadline,
  publicLabelFor,
  type VillaPublicInfo,
} from "@/lib/instagram/caption";
import { getHashtagPools, loadCopyGuideRaw } from "@/lib/instagram/content-guide";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 30_000;

export const YT_TITLE_MAX = 100; // 스키마 주석·YouTube 제목 상한
const YT_DESC_MAX = 4900; // YouTube 설명 상한 5000자 — 여유 두고 절단
const YT_TAGS_TOTAL_MAX = 480; // YouTube tags 총합 상한 500자 — 여유 두고 가드

/** 카카오 채널 유도 텍스트(설명 고정 삽입) — 링크 클릭 불가 대응(검색 안내 병기). 판매가·마진 미포함. */
export const YT_KAKAO_LINE = "💬 예약·견적은 카카오톡 채널 '빌라고' 검색 (pf.kakao.com/_mVAfX)";

export interface GeneratedShortMeta {
  title: string; // ≤100자
  description: string;
  tags: string[]; // # 없는 키워드 배열, 총합 ≤500자
  flaggedTerms: string[]; // 제목+설명에서 검출된 금칙어(없으면 [])
  usedGemini: boolean;
}

// ── 빌라 공개 정보 요약(설명 본문 보강용) ──
function factsLine(v: VillaPublicInfo): string {
  const facts: string[] = [`침실 ${v.bedrooms}`, `최대 ${v.maxGuests}인`];
  if (v.hasPool) facts.push("전용 수영장");
  if (v.beachDistanceM != null) facts.push(`해변 도보 ${v.beachDistanceM}m`);
  if (v.breakfastAvailable) facts.push("조식 가능");
  return `🏠 ${facts.join(" · ")}`;
}

// ── 해시태그(설명 말미) — #Shorts 필수 + 카피사전 배합, ≤12개 ──
function composeShortHashtags(v: VillaPublicInfo): string[] {
  const pools = getHashtagPools();
  const featureTags = new Set(deriveFeatureTags(v));
  const out = new Set<string>(["#Shorts", "#푸꾸옥", "#푸꾸옥여행"]);
  for (const h of pools.major) out.add(h);
  for (const h of pools.mid.slice(0, 3)) out.add(h);
  if (featureTags.has("수영장")) out.add("#푸꾸옥풀빌라");
  if (featureTags.has("커플")) out.add("#푸꾸옥커플여행");
  if (featureTags.has("대가족")) out.add("#푸꾸옥가족여행");
  return [...out].slice(0, 12);
}

// ── 태그(snippet.tags) — # 없는 키워드, 총합 ≤480자 ──
function composeTagList(v: VillaPublicInfo): string[] {
  const base = [
    "푸꾸옥",
    "푸꾸옥여행",
    "베트남여행",
    "풀빌라",
    "푸꾸옥풀빌라",
    "푸꾸옥숙소",
    "가족여행",
    "해외여행",
    "빌라고",
  ];
  const featureTags = deriveFeatureTags(v);
  if (featureTags.includes("수영장")) base.push("프라이빗풀빌라");
  if (featureTags.includes("커플")) base.push("커플여행", "신혼여행");
  if (featureTags.includes("대가족")) base.push("대가족여행");
  if (featureTags.includes("골프")) base.push("푸꾸옥골프");

  // 중복 제거 + 총합 480자 가드(YouTube tags 500자 상한).
  const out: string[] = [];
  let total = 0;
  for (const t of [...new Set(base)]) {
    const add = total === 0 ? t.length : t.length + 1; // 구분자 근사
    if (total + add > YT_TAGS_TOTAL_MAX) break;
    out.push(t);
    total += add;
  }
  return out;
}

// ── Gemini 제목·설명 본문 생성 ──
interface GeminiGenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** @internal 테스트에서 프롬프트 누수 검증용으로 노출. */
export function buildMetaPrompt(v: VillaPublicInfo): string {
  const copyGuide = loadCopyGuideRaw();
  const guideBlock = copyGuide
    ? `다음은 카피 가이드(정본)다. 브랜드 보이스·톤·금칙어를 반드시 지켜라:\n<<<GUIDE\n${copyGuide.slice(0, 5000)}\nGUIDE>>>`
    : `브랜드 보이스: 먼저 다녀온 한국인 친구가 좋은 빌라를 소개하는 따뜻한 존댓말. 과장·가격 박제·최상급 표현 금지.`;

  const data = {
    complex: v.complex ?? "",
    bedrooms: v.bedrooms,
    maxGuests: v.maxGuests,
    beachDistanceM: v.beachDistanceM,
    hasPool: v.hasPool,
    breakfast: v.breakfastAvailable,
    features: v.featureKeys,
    featureTags: deriveFeatureTags(v),
  };

  return `너는 빌라고 푸꾸옥의 한국인 여행 카피라이터다. 유튜브 쇼츠(세로 영상)의 제목과 설명 본문을 작성하라.

${guideBlock}

규칙(엄수):
- 한국어. 존댓말.
- 제목(title): 후킹형 1줄, 100자 이내. 궁금증을 유발하되 과장·최상급·구체 가격 금지. 끝에 "ㅣ빌라고"를 붙여도 좋다.
- 설명(description): 2~4줄. 첫 줄은 강한 후킹. 빌라 공개 정보를 자연스럽게 녹이되 가격 숫자·원가·마진·수수료·"최저가/무조건/100%" 금지.
- 해시태그·카카오 링크·이모지 나열은 출력하지 마라(코드가 별도로 붙인다).
- 반드시 아래 JSON 형식으로만 출력(코드펜스 없이, 다른 설명 금지):
{"title":"...","description":"..."}

빌라 공개 정보(JSON):
${JSON.stringify(data, null, 0)}`;
}

/** AI 응답에서 JSON 객체 추출(코드펜스·머리말 허용). 실패 시 null. */
function extractJsonObject(text: string): { title?: unknown; description?: unknown } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Gemini로 제목·설명 본문 생성 — 키 미설정·오류 시 null(호출부 폴백). */
async function generateMetaBody(
  v: VillaPublicInfo,
  fetchFn: typeof fetch = fetch
): Promise<{ title: string; description: string } | null> {
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
          contents: [{ parts: [{ text: buildMetaPrompt(v) }] }],
          generationConfig: { temperature: 0.8, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as GeminiGenerateResponse;
    const out = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const obj = extractJsonObject(out);
    const title = typeof obj?.title === "string" ? obj.title.trim() : "";
    const description = typeof obj?.description === "string" ? obj.description.trim() : "";
    if (!title || !description) return null;
    return { title, description };
  } catch {
    return null;
  }
}

/** Gemini 실패 시 결정형 폴백. ★ 고유 실명 미사용 — 지역·특징 표시명(publicLabelFor). */
function fallbackMetaBody(v: VillaPublicInfo): { title: string; description: string } {
  const label = publicLabelFor(v);
  const headline = pickHeadline(v);
  const title = `${label}, ${headline}ㅣ빌라고`;
  const inComplex = v.complex ? `푸꾸옥 ${v.complex}에서` : "푸꾸옥에서";
  const description = [
    `${headline} 🌴`,
    ``,
    `${inComplex} 우리 가족만의 프라이빗 풀빌라 어때요?`,
    `한국어 상담으로 예약부터 준비까지 편하게 도와드려요.`,
  ].join("\n");
  return { title, description };
}

/** 제목 ≤100자 강제(공백 트림 후 절단). */
function truncateTitle(title: string): string {
  const t = title.trim().replace(/\s+/g, " ");
  return t.length > YT_TITLE_MAX ? t.slice(0, YT_TITLE_MAX).trimEnd() : t;
}

/**
 * 유튜브 쇼츠 메타 완성 — Gemini 제목·설명(or 폴백) + 결정형 카카오/해시태그/태그, 금칙어 검사.
 * ★ flaggedTerms가 있어도 생성은 하되(승인 화면 경고용) 발행 전 운영자 승인에서 걸러진다.
 */
export async function generateShortMeta(
  v: VillaPublicInfo,
  fetchFn: typeof fetch = fetch
): Promise<GeneratedShortMeta> {
  const body = await generateMetaBody(v, fetchFn);
  const usedGemini = body != null;
  const { title: rawTitle, description: rawBody } = body ?? fallbackMetaBody(v);

  const title = truncateTitle(rawTitle);
  const hashtags = composeShortHashtags(v);
  const descParts = [rawBody.trim(), "", factsLine(v), YT_KAKAO_LINE, "", hashtags.join(" ")];
  let description = descParts.join("\n");
  if (description.length > YT_DESC_MAX) description = description.slice(0, YT_DESC_MAX).trimEnd();

  const tags = composeTagList(v);
  const flaggedTerms = findBannedTerms(`${title}\n${description}`);

  return { title, description, tags, flaggedTerms, usedGemini };
}
