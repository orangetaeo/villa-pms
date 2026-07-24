// lib/seo/article-draft.ts — 가이드 글 초안 생성 (T-seo-s3)
//
// 주제 풀에서 아직 안 쓴 주제를 골라 Gemini로 본문(블록 JSON)을 만든다.
// 산출물은 **PENDING_APPROVAL**로 저장된다 — 사람 승인 없이는 절대 발행되지 않는다.
//
// ★ 승인 게이트가 왜 규칙인가: 구글의 scaled content abuse 정책에서 "대량 자동생성"과
//   "AI를 도구로 쓴 편집된 콘텐츠"를 가르는 실질 근거가 사람의 검수다. 이 게이트를 없애면
//   기술적으로는 더 빨라지지만 도메인 전체가 위험해진다(기획 §0 치명2).
//
// ★ 공개 경계(T-seo-s1 §4.1) 승계: 프롬프트에 가격·공실·주소·공급자 정보를 넣지 않는다.
//   빌라 정보는 lib/seo/public-villa.ts 관문을 통과한 공개 필드만 사용한다.
import { findBannedTerms } from "@/lib/instagram/caption";
import { parseArticleBody, type ArticleBlock } from "@/lib/seo/article";
import type { PublicVilla } from "@/lib/seo/public-villa";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 60_000;

// ── 주제 풀 ─────────────────────────────────────────────────────────────────
// 한국 여행객이 실제로 검색하는 축(이동·시즌·동반자·액티비티·선택 기준)으로 구성.
// topicKey는 중복 생성 방지 키이자 slug 접두다. **추가만 하고 기존 키는 바꾸지 않는다**(URL 안정성).
export interface ArticleTopic {
  key: string;
  title: string;
  /** Gemini에 줄 취재 지시 — 무엇을 다뤄야 하는지 */
  brief: string;
}

export const ARTICLE_TOPICS: ArticleTopic[] = [
  {
    key: "airport-transfer",
    title: "푸꾸옥 공항에서 빌라까지 — 이동 방법 정리",
    brief: "공항에서 주요 리조트 단지까지 이동 수단 종류와 소요 시간대, 짐 많은 가족이 고려할 점, 밤 도착 시 주의점",
  },
  {
    key: "season-guide",
    title: "푸꾸옥 여행 시즌 — 건기와 우기, 언제 갈까",
    brief: "건기·우기의 체감 차이, 우기에도 괜찮은 이유와 주의점, 성수기 혼잡도, 월별 대략적인 날씨 경향",
  },
  {
    key: "family-with-kids",
    title: "아이와 함께 가는 푸꾸옥 빌라 여행 준비",
    brief: "아이 동반 시 빌라에서 확인할 것(수영장 깊이·안전·주방), 챙기면 좋은 준비물, 이동 동선 짜는 법",
  },
  {
    key: "villa-vs-hotel",
    title: "푸꾸옥, 빌라와 호텔 중 무엇이 맞을까",
    brief: "인원·일정·여행 스타일에 따른 선택 기준, 빌라가 유리한 경우와 호텔이 나은 경우를 균형 있게",
  },
  {
    key: "how-to-choose-villa",
    title: "푸꾸옥 빌라 고를 때 꼭 확인할 것",
    brief: "침실 구성과 실제 수용 인원의 차이, 수영장 형태, 해변까지 거리의 의미, 사진과 실제가 다를 때 확인법",
  },
  {
    key: "group-travel",
    title: "단체·대가족 푸꾸옥 여행 동선 짜기",
    brief: "8인 이상 단체가 겪는 문제(차량·식사·방 배정), 빌라 단위 여행의 장점, 일정 배분 요령",
  },
  {
    key: "golf-trip",
    title: "푸꾸옥 골프 여행, 빌라를 베이스로 삼기",
    brief: "골프장 인근 숙소의 장점, 라운딩 일정과 이동 시간, 동반자 중 비골퍼가 있을 때의 일정",
  },
  {
    key: "food-and-market",
    title: "푸꾸옥 먹거리와 야시장 즐기기",
    brief: "대표 먹거리 종류, 야시장 이용 요령, 빌라에서 해먹을 때 장보기 팁",
  },
];

/** 아직 만들지 않은 주제 — 이미 쓴 topicKey 집합을 받아 고른다. 전부 소진되면 null. */
export function pickTopic(usedKeys: Set<string>): ArticleTopic | null {
  return ARTICLE_TOPICS.find((t) => !usedKeys.has(t.key)) ?? null;
}

/** slug — topicKey를 그대로 쓴다(불변·중복 방지). 재생성 시에는 접미 번호를 붙인다. */
export function buildArticleSlug(topicKey: string, seq = 0): string {
  return seq > 0 ? `${topicKey}-${seq + 1}` : topicKey;
}

// ── 프롬프트 ────────────────────────────────────────────────────────────────
export function buildArticlePrompt(topic: ArticleTopic, villaHints: string[]): string {
  return [
    "너는 베트남 푸꾸옥 현지에서 빌라를 운영하는 회사의 콘텐츠 에디터다.",
    "한국인 여행객이 검색으로 들어와 읽을 여행 가이드 글을 쓴다.",
    "",
    `주제: ${topic.title}`,
    `다뤄야 할 내용: ${topic.brief}`,
    "",
    "형식(반드시 지켜라):",
    '- JSON 배열만 출력한다. 코드펜스·설명·머리말 없이 배열 하나만.',
    '- 각 원소는 {"type":"h2","text":"..."} 또는 {"type":"p","text":"..."} 또는 {"type":"ul","items":["...","..."]}',
    "- 소제목(h2) 3~5개, 각 소제목 아래 문단 2개 이상, 목록(ul)은 1~3개만 사용",
    "- 전체 본문 900~1500자(한국어 기준)",
    "",
    "내용 규칙(어기면 폐기된다):",
    "- 가격·요금·비용 금액을 절대 쓰지 마라. '얼마', '원', '동', '달러' 같은 금액 표현 금지",
    "- 특정 날짜의 예약 가능 여부를 쓰지 마라",
    "- 구체적인 빌라 주소나 소유자·관리인 정보를 쓰지 마라",
    "- 확인되지 않은 통계·수치(‘1위’, ‘90%가’ 같은 표현) 금지",
    "- 최상급·과장 광고 표현 금지. 담백하고 실용적으로",
    "- 실제로 도움이 되는 판단 기준을 제시하라. 뻔한 원론은 빼라",
    villaHints.length > 0
      ? `- 참고로 우리가 운영하는 빌라의 특징은 다음과 같다(자연스럽게 1~2회만 언급 가능): ${villaHints.join(", ")}`
      : "",
    "",
    "마지막 문단에서 상담을 권하되, 호객성 문구는 쓰지 마라.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 공개 빌라 → 프롬프트에 넣을 힌트(가격·주소·공급자 없음). */
export function villaHints(villas: PublicVilla[]): string[] {
  return villas.slice(0, 3).map((v) => {
    const parts = [`침실 ${v.bedrooms}개`, `최대 ${v.maxGuests}인`];
    if (v.hasPool) parts.push("전용 수영장");
    if (v.breakfastAvailable) parts.push("조식 가능");
    if (v.beachDistanceM != null) parts.push(`해변 ${v.beachDistanceM}m`);
    return parts.join("·");
  });
}

// ── Gemini 호출 ─────────────────────────────────────────────────────────────
interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** 응답 텍스트에서 JSON 배열만 추출 — 코드펜스·머리말이 섞여 와도 살려낸다. */
export function extractJsonArray(text: string): unknown {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export interface DraftResult {
  blocks: ArticleBlock[];
  /** 금칙어 가드 검출 결과 — 있으면 운영자 승인 화면에 경고로 띄운다(자동 폐기는 하지 않음) */
  flaggedTerms: string[];
}

/**
 * Gemini로 본문 생성. 키 미설정·오류·형식 위반이면 null(호출부가 이번 회차를 건너뛴다).
 * ★ 폴백 템플릿을 두지 않는다 — 캡션과 달리 가이드 글은 **내용이 핵심**이라
 *   기계적 폴백 글을 발행하면 그 자체가 얇은 콘텐츠다. 못 만들면 안 만드는 게 옳다.
 */
export async function generateArticleBody(
  topic: ArticleTopic,
  hints: string[],
  fetchFn: typeof fetch = fetch
): Promise<DraftResult | null> {
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
          contents: [{ parts: [{ text: buildArticlePrompt(topic, hints) }] }],
          // responseMimeType:"application/json" — 큰 프롬프트(카피가이드 주입)에서 모델이 가이드를
          // 복창해 파싱 0블록이 되는 간헐 실패를 차단(JSON 디코딩 모드 강제). 실패 시 null 폴백은 유지.
          generationConfig: {
            temperature: 0.7,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: "application/json",
          },
        }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as GeminiResponse;
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const blocks = parseArticleBody(extractJsonArray(raw));
    if (blocks.length === 0) return null;

    const flat = blocks
      .map((b) => (b.type === "ul" ? b.items.join(" ") : b.type === "img" ? (b.caption ?? "") : b.type === "video" ? b.title : b.text))
      .join(" ");
    return { blocks, flaggedTerms: findBannedTerms(flat) };
  } catch {
    return null;
  }
}

/** 요약(메타 디스크립션) — 첫 문단을 잘라 쓴다. Gemini를 한 번 더 부르지 않는다(비용·지연). */
export function buildSummary(blocks: ArticleBlock[], max = 150): string {
  const firstP = blocks.find((b) => b.type === "p");
  const text = firstP && firstP.type === "p" ? firstP.text : "";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// ── 이미지 배치 (SEO: 이미지 검색 유입 · 공유 썸네일 · Article.image 권장 필드) ──
//
// ★ 이미지가 순위를 직접 올리지는 않는다. 실효는 ① 이미지 검색이라는 별도 유입 채널
//   ② 공유 시 썸네일 CTR ③ 구조화 데이터 image 필드 충족 — 그리고 우리는 빌라 사진이 곧 상품이라
//   전환에도 직결된다.
// ★ 소스는 공개 관문(getPublicVillas) 통과 사진뿐. 공개 대상 빌라가 없으면 브랜드 이미지로 폴백한다
//   (억지로 외부 스톡 이미지를 끌어오지 않는다 — 통제 못 하는 URL은 언제든 깨진다).

/** 공개 빌라가 하나도 없을 때 쓰는 브랜드 폴백. public/og-villa-go.png */
export const BRAND_FALLBACK_IMAGE = "/og-villa-go.png";

/** PhotoSpace → 한국어 alt 조각. 이미지 검색은 alt 텍스트로 색인된다. */
const SPACE_LABEL_KO: Record<string, string> = {
  EXTERIOR: "외관",
  POOL: "수영장",
  LIVING: "거실",
  BEDROOM: "침실",
  KITCHEN: "주방",
  BATHROOM: "욕실",
  BALCONY: "발코니",
  ETC: "내부",
};

export interface PickedImage {
  url: string;
  alt: string;
  caption?: string;
}

/**
 * 글에 쓸 이미지 후보를 공간 다양성 있게 고른다(같은 침실 사진 3장 같은 중복 방지).
 * alt는 "단지명 빌라명 공간" 형태 — 검색어와 맞물리게 한국어로 만든다.
 */
/** 문자열 → 결정적 정수(글마다 다른 사진을 고르기 위한 시드). 같은 글은 항상 같은 결과. */
export function seedOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function pickArticleImages(villas: PublicVilla[], max = 3, seedKey = ""): PickedImage[] {
  if (villas.length === 0) return [];
  const out: PickedImage[] = [];
  const usedUrls = new Set<string>();
  const seed = seedOf(seedKey);

  // ★ 글마다 다른 사진이 나와야 한다 — 모든 글이 같은 이미지를 쓰면 중복 이미지 신호가 되고
  //   독자에게도 성의 없어 보인다. 빌라 순서와 공간 시작점을 시드로 회전시킨다.
  //   시드가 같으면 결과도 같다(재생성 시 URL이 널뛰지 않음).
  const rotatedVillas = villas.map((_, i) => villas[(i + seed) % villas.length]);
  const priority = ["EXTERIOR", "POOL", "LIVING", "BEDROOM", "KITCHEN", "BALCONY", "BATHROOM", "ETC"];
  const rotatedSpaces = priority.map((_, i) => priority[(i + (seed % priority.length)) % priority.length]);

  // 빌라를 번갈아 돌며 공간이 겹치지 않게 채운다(한 빌라 사진만 몰리는 것 방지).
  for (const space of rotatedSpaces) {
    if (out.length >= max) break;
    for (const v of rotatedVillas) {
      if (out.length >= max) break;
      const photo = v.photos.find((p) => p.space === space && !usedUrls.has(p.url));
      if (!photo) continue;
      const where = v.areaNameKo ?? v.areaName ?? v.complex ?? "푸꾸옥";
      const spaceKo = SPACE_LABEL_KO[space] ?? "내부";
      out.push({
        url: photo.url,
        alt: `${v.publicLabel} ${spaceKo}`,
        caption: `${where} · 침실 ${v.bedrooms}개 · 최대 ${v.maxGuests}인`,
      });
      usedUrls.add(photo.url);
      break; // 같은 공간은 한 장만 — 다음 공간으로
    }
  }
  return out;
}

/** PickedImage → img 블록(캡션은 있을 때만). 저장 정본에는 mediaId 등 부가 필드를 싣지 않는다. */
function toImgBlock(im: PickedImage): ArticleBlock {
  return { type: "img", url: im.url, alt: im.alt, ...(im.caption ? { caption: im.caption } : {}) };
}

/**
 * 이미지를 **그룹 단위**로 소제목마다 배치한다 — 한 그룹의 이미지들이 **연속**으로 들어가므로
 * 렌더 시 그리드 갤러리로 묶인다(lib/seo/gallery.ts). 묶음 글에서 그룹=한 장소 → 그 장소 소제목 아래
 * 그 가게 사진들이 모여 나온다(사진-장소 짝 유지). 소제목보다 그룹이 많으면 나머지는 본문 끝에 붙인다.
 */
export function interleaveImageGroups(blocks: ArticleBlock[], groups: PickedImage[][]): ArticleBlock[] {
  const nonEmpty = groups.filter((g) => g.length > 0);
  if (nonEmpty.length === 0) return blocks;
  const out: ArticleBlock[] = [];
  let gi = 0;
  let sawH2 = false;
  for (const b of blocks) {
    out.push(b);
    if (b.type === "h2") {
      sawH2 = true;
      continue;
    }
    if (sawH2 && b.type === "p" && gi < nonEmpty.length) {
      for (const im of nonEmpty[gi]) out.push(toImgBlock(im));
      gi++;
      sawH2 = false;
    }
  }
  for (; gi < nonEmpty.length; gi++) for (const im of nonEmpty[gi]) out.push(toImgBlock(im));
  return out;
}

/** items를 groupsWanted개(각 ≤ maxPer)로 최대한 균등하게 쪼갠다. */
function chunkEven<T>(items: T[], groupsWanted: number, maxPer: number): T[][] {
  if (items.length === 0) return [];
  const groupsNeeded = Math.max(groupsWanted, Math.ceil(items.length / maxPer));
  const base = Math.floor(items.length / groupsNeeded);
  let extra = items.length % groupsNeeded;
  const out: T[][] = [];
  let idx = 0;
  for (let i = 0; i < groupsNeeded; i++) {
    const size = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    out.push(items.slice(idx, idx + size));
    idx += size;
  }
  return out.filter((g) => g.length > 0);
}

/**
 * 한 스트림의 이미지를 소제목 수만큼 그룹으로 쪼개 **골고루** 흩뿌린다(단독 장소 글처럼 한 가게 사진이 많을 때).
 * 각 그룹은 연속 배치되어 그리드 갤러리로 렌더된다. 소제목이 적으면 한 갤러리가 커지되 maxPerRun으로 제한한다.
 */
export function spreadImageGroups(blocks: ArticleBlock[], images: PickedImage[], maxPerRun = 6): ArticleBlock[] {
  if (images.length === 0) return blocks;
  const h2count = blocks.filter((b) => b.type === "h2").length;
  const runs = Math.max(1, Math.min(Math.max(1, h2count), Math.ceil(images.length / maxPerRun)));
  return interleaveImageGroups(blocks, chunkEven(images, runs, maxPerRun));
}

/**
 * 본문 블록에 이미지를 끼워 넣는다 — 소제목(h2) 다음 문단 뒤에 하나씩.
 * 첫 이미지는 커버로 따로 쓰므로 본문에는 두 번째부터 넣는다(같은 사진 중복 노출 방지).
 */
export function interleaveImages(blocks: ArticleBlock[], images: PickedImage[]): ArticleBlock[] {
  if (images.length === 0) return blocks;
  const out: ArticleBlock[] = [];
  let imgIdx = 0;
  let sawH2 = false;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    out.push(b);
    if (b.type === "h2") {
      sawH2 = true;
      continue;
    }
    // 소제목 바로 뒤 첫 문단 다음에 이미지 1장
    if (sawH2 && b.type === "p" && imgIdx < images.length) {
      const img = images[imgIdx++];
      out.push({ type: "img", url: img.url, alt: img.alt, ...(img.caption ? { caption: img.caption } : {}) });
      sawH2 = false;
    }
  }
  return out;
}

// ── 빌라 소개 글 (T-seo-villa-article) ───────────────────────────────────────
//
// 왜 따로 만드는가: 가이드 글(공항 이동·시즌 등)에 빌라 사진을 끼우면 **본문과 무관한 이미지**가 된다.
// 사진이 의미를 가지려면 글의 주제가 그 빌라여야 한다. 그래서 가이드 글에서는 본문 이미지를 빼고,
// 빌라를 소재로 한 글을 따로 만들어 거기에 해당 빌라의 사진·영상을 넣는다.
//
// ★ 중복 콘텐츠 회피: 빌라 상세 페이지(/blog/villa/[slug])는 **스펙 중심**이고,
//   이 글은 **"어떤 여행에 맞는 빌라인가"** 각도로 쓴다. 같은 내용을 두 번 쓰지 않고 서로 링크한다.
// ★ 공개 경계 승계: 가격·공실·주소·공급자 정보는 프롬프트에도 본문에도 들어가지 않는다.

/** 빌라 글의 topicKey — 빌라 슬러그로 고정(중복 생성 방지 + slug 안정) */
export function villaTopicKey(slug: string): string {
  return `villa-${slug}`;
}

export function buildVillaArticleTitle(v: PublicVilla): string {
  // 고유 실명 미사용 — 지역·특징 표시명(publicLabel)만. 실명은 검색 우회·직거래 위험(원칙 1).
  return `${v.publicLabel}, 어떤 여행에 맞을까`;
}

export function buildVillaArticlePrompt(v: PublicVilla): string {
  const where = v.areaNameKo ?? v.areaName ?? v.complex ?? "푸꾸옥";
  const facts: string[] = [
    `단지: ${where}`,
    `구성: 침실 ${v.bedrooms}개 · 욕실 ${v.bathrooms}개 · 최대 ${v.maxGuests}인`,
  ];
  if (v.hasPool) facts.push("전용 수영장 있음");
  if (v.breakfastAvailable) facts.push("조식 제공 가능");
  if (v.beachDistanceM != null) facts.push(`해변까지 약 ${v.beachDistanceM}m`);
  if (v.areaSqm) facts.push(`전용면적 약 ${v.areaSqm}㎡`);
  if (v.floors) facts.push(`${v.floors}층 구조`);
  if (v.parkingSlots > 0) facts.push(`주차 ${v.parkingSlots}대`);
  facts.push(`반려동물 ${v.petsAllowed ? "동반 가능" : "동반 불가"}`);
  facts.push(`흡연 ${v.smokingAllowed ? "가능" : "불가"}`);
  facts.push(`파티 ${v.partyAllowed ? "가능" : "불가"}`);
  const feats = v.featureKeys.map((k) => FEATURE_KO_ARTICLE[k]).filter(Boolean);
  if (feats.length) facts.push(`특징: ${feats.join(", ")}`);
  const spaces = [...new Set(v.photos.map((p) => SPACE_LABEL_KO[p.space] ?? "내부"))];
  if (spaces.length) facts.push(`사진이 있는 공간: ${spaces.join(", ")}`);

  return [
    "너는 베트남 푸꾸옥 현지에서 빌라를 운영하는 회사의 콘텐츠 에디터다.",
    `아래 빌라 한 곳을 소개하는 글을 쓴다. 제목은 이미 정해져 있으니 본문만 쓴다.`,
    "",
    // ★ 고유 실명 대신 지역·특징 표시명만 준다 — 실명을 본문에 쓰면 검색 우회·직거래로 이어진다(원칙 1).
    `빌라: ${v.publicLabel}`,
    "확인된 사실:",
    ...facts.map((x) => `- ${x}`),
    "",
    "글의 각도(중요):",
    "- 스펙을 나열하지 마라. 스펙은 이미 별도 페이지에 있다",
    "- **어떤 여행·어떤 일행에게 맞는 빌라인지**를 중심으로 써라",
    "- 이 구성으로 하루를 어떻게 보내게 되는지 그려줘라(아침·낮·저녁의 동선)",
    "- 이 빌라가 안 맞는 경우도 솔직히 한 번 짚어라(예: 인원이 더 많거나, 도보 이동을 선호하지 않는 경우)",
    "",
    "형식(반드시 지켜라):",
    '- JSON 배열만 출력한다. 코드펜스·설명 없이 배열 하나만',
    '- 각 원소는 {"type":"h2","text":"..."} 또는 {"type":"p","text":"..."} 또는 {"type":"ul","items":["..."]}',
    "- 소제목(h2) 3~4개, 각 소제목 아래 문단 2개 이상",
    "- 전체 본문 900~1400자(한국어)",
    "- **이미지·영상 블록은 넣지 마라**(시스템이 알아서 배치한다)",
    "",
    "내용 규칙(어기면 폐기된다):",
    "- 위에 없는 사실을 지어내지 마라. 없는 시설·전망·서비스를 추측하지 않는다",
    "- 가격·요금·금액 표현 금지('원', '동', '달러', '얼마')",
    "- 특정 날짜의 예약 가능 여부를 쓰지 마라",
    "- 상세 주소·소유자·관리인 정보를 쓰지 마라",
    "- 최상급·과장('최고', '최상', '1위')·미확인 통계 금지",
    "",
    "마지막 문단에서 상담을 자연스럽게 권하되 호객성 문구는 쓰지 마라.",
  ].join("\n");
}

const FEATURE_KO_ARTICLE: Record<string, string> = {
  viewSea: "바다뷰",
  viewMountain: "마운틴뷰",
  viewCity: "시티뷰",
  bbq: "BBQ 시설",
  elevator: "엘리베이터",
  generator: "발전기",
  kidsPool: "키즈풀",
  privatePool: "프라이빗 풀",
  gym: "헬스장",
  golfNearby: "골프장 인근",
  beachFront: "해변 바로앞",
  marketNearby: "시장 인근",
};

/**
 * 빌라 한 곳의 사진을 공간 다양성 있게 고른다 — **그 빌라 글에만** 쓰이므로 본문과 정확히 맞는다.
 * 첫 장은 커버로 쓰고 나머지를 본문에 배치한다.
 */
export function pickVillaPhotos(v: PublicVilla, max = 4): PickedImage[] {
  const priority = ["EXTERIOR", "POOL", "LIVING", "BEDROOM", "KITCHEN", "BALCONY", "BATHROOM", "ETC"];
  const out: PickedImage[] = [];
  const used = new Set<string>();
  for (const space of priority) {
    if (out.length >= max) break;
    const photo = v.photos.find((p) => p.space === space && !used.has(p.url));
    if (!photo) continue;
    used.add(photo.url);
    const spaceKo = SPACE_LABEL_KO[space] ?? "내부";
    out.push({
      url: photo.url,
      alt: `${v.publicLabel} ${spaceKo}`,
      caption: photo.spaceLabel ?? `${v.publicLabel} ${spaceKo}`.trim(),
    });
  }
  return out;
}

/**
 * 빌라 글 본문에 그 빌라의 사진·영상을 배치한다.
 *   · 사진: 소제목 뒤 첫 문단 다음
 *   · 영상: 본문 끝(직전)에 1개 — 글을 다 읽고 영상으로 넘어가는 흐름
 */
export function composeVillaBody(
  blocks: ArticleBlock[],
  photos: PickedImage[],
  video: { ytVideoId: string; title: string } | null
): ArticleBlock[] {
  const withPhotos = interleaveImages(blocks, photos);
  if (!video) return withPhotos;
  return [...withPhotos, { type: "video", ytVideoId: video.ytVideoId, title: video.title }];
}

/**
 * 빌라 글 본문 생성 — 그 빌라의 사실만으로 "어떤 여행에 맞는지" 각도로 쓴다.
 * 실패 시 null(호출부가 이번 회차 건너뜀). 폴백 템플릿 없음(가이드 글과 동일 원칙).
 */
export async function generateVillaArticleBody(
  v: PublicVilla,
  fetchFn: typeof fetch = fetch
): Promise<DraftResult | null> {
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
          contents: [{ parts: [{ text: buildVillaArticlePrompt(v) }] }],
          // responseMimeType:"application/json" — 큰 프롬프트(카피가이드 주입)에서 모델이 가이드를
          // 복창해 파싱 0블록이 되는 간헐 실패를 차단(JSON 디코딩 모드 강제). 실패 시 null 폴백은 유지.
          generationConfig: {
            temperature: 0.7,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: "application/json",
          },
        }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as GeminiResponse;
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const blocks = parseArticleBody(extractJsonArray(raw));
    if (blocks.length === 0) return null;
    const flat = blocks
      .map((b) => (b.type === "ul" ? b.items.join(" ") : b.type === "img" ? (b.caption ?? "") : b.type === "video" ? b.title : b.text))
      .join(" ");
    return { blocks, flaggedTerms: findBannedTerms(flat) };
  } catch {
    return null;
  }
}
