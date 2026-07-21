// lib/instagram/caption.ts — 캡션·헤드라인·해시태그·금칙어 가드 (콘텐츠 생성 cron 사용)
//
// ★ 누수 절대 금지: 입력은 빌라 공개 정보만(name·complex·bedrooms·maxGuests·beachDistanceM·features·
//   hasPool·breakfast). 원가·마진·판매가·supplier 정보는 이 모듈에 들어오지 않는다(호출부 select 책임 + 타입 봉인).
//
// 캡션 = Gemini 본문(카피 가이드 주입) + 결정형 해시태그(로테이션) 조합. Gemini 미설정·실패 시 템플릿 폴백.
// Gemini는 gemini.ts와 동일한 키·모델·REST 규약을 쓰되, 캡션 전용 프롬프트라 호출을 로컬 구현한다.
import {
  getBannedTerms,
  getHashtagPools,
  getHeadlineBank,
  loadCopyGuideRaw,
  type HeadlineEntry,
} from "@/lib/instagram/content-guide";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 30_000;

/** 캡션 생성 입력 — 빌라 공개 정보만(마진·원가·판매가·supplier 없음). */
export interface VillaPublicInfo {
  name: string;
  nameVi?: string | null;
  complex: string | null;
  bedrooms: number;
  maxGuests: number;
  beachDistanceM: number | null;
  hasPool: boolean;
  breakfastAvailable: boolean;
  /** VillaFeature.featureKey 목록 (viewSea·privatePool·golfNearby·bbq 등) */
  featureKeys: string[];
}

export type IgContentKind = "VILLA_SHOWCASE" | "SERVICE" | "INFO" | "REELS";

// ── 특징 태그 파생 (헤드라인/해시태그 매칭용 — copy-guide 태그 어휘와 정합) ──
export function deriveFeatureTags(v: VillaPublicInfo): string[] {
  const keys = new Set(v.featureKeys);
  const tags = new Set<string>(["범용"]);
  if (v.hasPool || keys.has("privatePool") || keys.has("kidsPool")) tags.add("수영장");
  if (keys.has("beachFront") || (v.beachDistanceM != null && v.beachDistanceM <= 500)) tags.add("해변근접");
  if (keys.has("golfNearby")) tags.add("골프");
  if (keys.has("bbq")) tags.add("BBQ");
  if (v.breakfastAvailable) tags.add("조식");
  if (v.maxGuests >= 8) tags.add("대가족");
  if (v.maxGuests <= 4) tags.add("커플");
  return [...tags];
}

/**
 * 릴스/쇼츠 중간 프레임용 짧은 셀링포인트 캡션(공개정보만 — 원가·마진·판매가 절대 미포함).
 * 밋밋한 중간 사진 위에 순서대로 올린다. 빌라 특성에 맞는 문구만 포함, 마지막은 카톡 유도.
 */
export function reelMiddleCaptions(v: VillaPublicInfo): string[] {
  const out: string[] = [];
  if (v.hasPool) out.push("전용 풀에서\n즐기는 하루");
  out.push(`침실 ${v.bedrooms} · 최대 ${v.maxGuests}인`);
  if (v.beachDistanceM != null) out.push(`해변까지 도보 ${v.beachDistanceM}m`);
  const keys = new Set(v.featureKeys);
  if (keys.has("viewSea")) out.push("바다가 보이는 풍경");
  if (v.breakfastAvailable) out.push("조식 준비 가능");
  if (keys.has("bbq")) out.push("정원에서 즐기는 BBQ");
  if (keys.has("golfNearby")) out.push("골프장 가까이");
  out.push("예약·견적은\n카카오톡 '빌라고'");
  return out;
}

// ── 변수 치환 ──
function substituteVars(text: string, v: VillaPublicInfo): string {
  return text
    .replace(/\{villaName\}/g, v.name)
    .replace(/\{complex\}/g, v.complex ?? v.name)
    .replace(/\{bedrooms\}/g, String(v.bedrooms))
    .replace(/\{maxGuests\}/g, String(v.maxGuests))
    .replace(/\{beachDistanceM\}/g, v.beachDistanceM != null ? String(v.beachDistanceM) : "");
}

// ── 무작위 픽 (로테이션 — 동일 세트 반복 = 스팸 시그널 방지) ──
function pickRandom<T>(pool: T[], n: number): T[] {
  if (n <= 0 || pool.length === 0) return [];
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 헤드라인 선택 — 빌라 특징 태그와 겹치는 후보 우선, 없으면 범용. 변수 치환 후 반환.
 * beachDistanceM 없는 빌라에 "도보 {beachDistanceM}m" 헤드라인이 걸리지 않게 필터.
 */
export function pickHeadline(v: VillaPublicInfo, bank: HeadlineEntry[] = getHeadlineBank()): string {
  const featureTags = new Set(deriveFeatureTags(v));
  const usable = bank.filter((h) => {
    if (h.text.includes("{beachDistanceM}") && v.beachDistanceM == null) return false;
    return true;
  });
  const matched = usable.filter((h) => h.tags.some((t) => featureTags.has(t)));
  const pool = matched.length > 0 ? matched : usable.length > 0 ? usable : bank;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return substituteVars(chosen.text, v).trim();
}

/**
 * 해시태그 조합 — 대형3~4 + 중형5~7 + 틈새4~6 + 시즌0~3, SERVICE면 서비스4~6 추가(중형·틈새 축소).
 * 매 호출 무작위 로테이션. 위치 태그 "Phú Quốc"는 해시태그가 아니라 캡션 말미에 별도 부착(호출부).
 */
export function composeHashtags(kind: IgContentKind, featureTags: string[]): string[] {
  const pools = getHashtagPools();
  const isService = kind === "SERVICE";
  const out: string[] = [];

  out.push(...pickRandom(pools.major, randInt(3, 4)));
  out.push(...pickRandom(pools.mid, isService ? randInt(3, 4) : randInt(5, 7)));
  out.push(...pickRandom(pools.niche, isService ? randInt(1, 3) : randInt(4, 6)));
  out.push(...pickRandom(pools.season, randInt(0, 3)));
  if (isService) out.push(...pickRandom(pools.service, randInt(4, 6)));

  // 특징 매칭 태그 보강 (커플/대가족/골프) — 풀에 있으면 우선 포함.
  const featureHashMap: Record<string, string> = {
    커플: "#푸꾸옥커플여행",
    대가족: "#푸꾸옥가족여행",
    골프: "#푸꾸옥골프",
  };
  for (const t of featureTags) {
    const h = featureHashMap[t];
    if (h && !out.includes(h)) out.push(h);
  }

  // 중복 제거 + 최대 20개 상한(스팸 방지).
  return [...new Set(out)].slice(0, 20);
}

// ── 금칙어 가드 ──
/** 텍스트에서 걸린 금칙어 목록(공백·대소문자 무시 부분일치). 없으면 빈 배열. */
export function findBannedTerms(text: string, banned: string[] = getBannedTerms()): string[] {
  const norm = text.toLowerCase().replace(/\s+/g, "");
  const hits: string[] = [];
  for (const term of banned) {
    const nt = term.toLowerCase().replace(/\s+/g, "");
    if (nt.length > 0 && norm.includes(nt)) hits.push(term);
  }
  return [...new Set(hits)];
}

// ── Gemini 캡션 본문 생성 ──
interface GeminiGenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

function buildCaptionPrompt(v: VillaPublicInfo, kind: IgContentKind): string {
  const copyGuide = loadCopyGuideRaw();
  const guideBlock = copyGuide
    ? `다음은 카피 가이드(정본)다. 브랜드 보이스·톤·이모지 규칙·금칙어를 반드시 지켜라:\n<<<GUIDE\n${copyGuide.slice(0, 6000)}\nGUIDE>>>`
    : `브랜드 보이스: 먼저 다녀온 한국인 친구가 좋은 빌라를 소개하는 따뜻한 존댓말. 과장·가격 박제·최상급 표현 금지.`;

  // 입력 데이터는 공개 정보만 — 원가·마진·판매가·supplier 절대 미포함.
  const data = {
    complex: v.complex ?? "",
    villaName: v.name,
    bedrooms: v.bedrooms,
    maxGuests: v.maxGuests,
    beachDistanceM: v.beachDistanceM,
    hasPool: v.hasPool,
    breakfast: v.breakfastAvailable,
    features: v.featureKeys,
    featureTags: deriveFeatureTags(v),
  };

  return `너는 빌라고 푸꾸옥의 한국인 여행 카피라이터다. 인스타그램 ${
    kind === "SERVICE" ? "부가서비스 홍보" : kind === "INFO" ? "여행 정보" : "빌라 쇼케이스"
  } 포스트의 캡션 본문을 작성하라.

${guideBlock}

규칙(엄수):
- 한국어. 존댓말. 3~6줄. 이모지 2~4개.
- 구체 가격/숫자 금액 절대 박제 금지. "카톡으로 견적" 톤.
- 원가·마진·수수료·"최저가/무조건/100%" 등 과장·비공개 표현 금지.
- 캡션 본문만 출력. **해시태그·위치태그는 출력하지 마라(코드가 별도로 붙인다).**
- CTA 한 줄 포함: 예약·견적은 프로필 링크 또는 DM → 카카오톡 상담 유도.
- 마지막 줄에 별도 설명·따옴표·머리말 금지.

빌라 공개 정보(JSON):
${JSON.stringify(data, null, 0)}`;
}

/** Gemini로 캡션 본문 생성 — 키 미설정·오류 시 null(호출부 폴백). */
async function generateCaptionBody(
  v: VillaPublicInfo,
  kind: IgContentKind,
  fetchFn: typeof fetch = fetch
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
          contents: [{ parts: [{ text: buildCaptionPrompt(v, kind) }] }],
          generationConfig: { temperature: 0.8, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as GeminiGenerateResponse;
    const out = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return out.trim() || null;
  } catch {
    return null;
  }
}

/** Gemini 실패 시 폴백 캡션 본문(템플릿 A/B 결정형). */
function fallbackCaptionBody(v: VillaPublicInfo, kind: IgContentKind, headline: string): string {
  const complex = v.complex ?? v.name;
  if (kind === "SERVICE") {
    return [
      `빌라에서 편하게 즐기는 푸꾸옥 🌴`,
      ``,
      `예약부터 준비까지 한 번에, 한국어로 도와드려요.`,
      ``,
      `✔️ 번거로운 예약 대행`,
      `✔️ 예약·견적은 카톡으로 한 번에`,
      ``,
      `📩 궁금한 점은 프로필 링크에서 카카오톡으로 문의 주세요!`,
    ].join("\n");
  }
  const lines: string[] = [`🌴 푸꾸옥 ${complex} 프라이빗 풀빌라`, ``, `${headline}.`];
  lines.push(`${v.bedrooms}베드룸에 최대 ${v.maxGuests}명, 우리 가족만의 시간 어때요?`, ``);
  if (v.hasPool) lines.push(`✔️ 전용 수영장`);
  if (v.beachDistanceM != null) lines.push(`✔️ 해변까지 도보 ${v.beachDistanceM}m 남짓`);
  if (v.breakfastAvailable) lines.push(`✔️ 조식 준비 가능`);
  lines.push(`✔️ 한국어 상담 · 카톡으로 바로 견적`, ``, `📩 예약·견적 문의는 프로필 링크 클릭!`);
  return lines.join("\n");
}

export interface GeneratedCaption {
  caption: string; // 본문 + 해시태그 + 위치태그
  body: string; // 본문만
  hashtags: string[];
  headline: string;
  flaggedTerms: string[]; // 캡션+헤드라인에서 검출된 금칙어(없으면 [])
  usedGemini: boolean;
}

/**
 * 캡션 완성 — Gemini 본문(or 폴백) + 결정형 해시태그 + 위치태그, 금칙어 검사.
 * ★ flaggedTerms가 있어도 생성은 하되(승인 화면 경고용) 발행 전 운영자 승인에서 걸러진다.
 */
export async function generateCaption(
  v: VillaPublicInfo,
  kind: IgContentKind,
  fetchFn: typeof fetch = fetch
): Promise<GeneratedCaption> {
  const featureTags = deriveFeatureTags(v);
  const headline = pickHeadline(v);

  const geminiBody = await generateCaptionBody(v, kind, fetchFn);
  const usedGemini = geminiBody != null;
  const body = geminiBody ?? fallbackCaptionBody(v, kind, headline);

  const hashtags = composeHashtags(kind, featureTags);
  // 본문이 비정상적으로 길면(Gemini 폭주) 인스타 캡션 상한(2200자) 내로 절단 — 해시태그·위치태그 자리 확보.
  const tail = `\n\n${hashtags.join(" ")}\n📍 Phú Quốc`;
  const maxBody = 2200 - tail.length;
  const safeBody = body.length > maxBody ? body.slice(0, Math.max(0, maxBody - 1)).trimEnd() + "…" : body;
  const caption = `${safeBody}${tail}`;

  const flaggedTerms = findBannedTerms(`${headline}\n${caption}`);

  return { caption, body, hashtags, headline, flaggedTerms, usedGemini };
}
