// lib/seo/place-article.ts — 푸꾸옥 장소(맛집·카페·쇼핑) 소개 글 (T-seo-place-article)
//
// 다른 글 종류와 결정적으로 다른 점 두 가지:
//  ① **고갈되지 않는다.** 빌라 글은 재고 수만큼, 서비스 글은 9종, 가이드 글은 8종이 끝이다.
//     장소 글만 테오가 다닐수록 늘어난다 — 그래서 회차(1편·2편·3편…)로 이어진다.
//  ② **사실 원천이 우리 DB가 아니다.** 남의 가게라 AI가 지어낼 여지가 가장 크다.
//     → **등록된 장소만 등장할 수 있고, 문장만 AI가 쓴다.** 이 모듈은 그 계약을 강제한다.
//
// ★ 영업시간·가격·휴무일·전화번호는 **필드 자체가 없다**(SeoPlace 참조). 수시로 바뀌는데 갱신 수단이
//   없어 쓰는 순간부터 틀린 글이 되기 때문이다. 사람이 책임질 문장은 oneLiner·tips로 들어온다.
// ★ 묶음 글(3곳 이상)인 이유: 카페 한 곳으로 800자를 채우면 지어낼 수밖에 없다.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { findBannedTerms } from "@/lib/instagram/caption";
import { parseArticleBody } from "@/lib/seo/article";
import { extractJsonArray, type DraftResult, type PickedImage } from "@/lib/seo/article-draft";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 60_000;

/** 한 편에 묶는 장소 수 — 최소 3곳이어야 글이 되고, 너무 많으면 각 장소가 얇아진다. */
export const MIN_PLACES_PER_ARTICLE = 3;
export const MAX_PLACES_PER_ARTICLE = 5;
/** 재료 하한(자) — 이름만 등록된 상태로는 쓰지 않는다. */
export const MIN_PLACE_FACT_CHARS = 120;

export interface PlaceCategory {
  key: string;
  /** 글 제목에 들어가는 말 */
  label: string;
  /** 집필 각도 */
  brief: string;
}

/** ★ 화이트리스트 — DB는 String이라 여기 없는 값은 글에 쓰이지 않는다(오타 방어). */
export const PLACE_CATEGORIES: PlaceCategory[] = [
  {
    key: "restaurant",
    label: "맛집",
    brief: "어떤 상황·일행에게 맞는 집인지, 무엇을 먹으러 가는 집인지, 빌라 일정 중 언제 넣으면 좋은지",
  },
  {
    key: "cafe",
    label: "카페",
    brief: "머무는 목적(더위 피하기·작업·아이 동반)에 따른 선택, 해변·시내 동선과의 관계",
  },
  {
    key: "shop",
    label: "쇼핑",
    brief: "무엇을 사러 가는 곳인지, 귀국 선물·현지 조달 관점, 빌라에서의 접근성",
  },
  {
    key: "market",
    label: "시장·야시장",
    brief: "언제 가는 게 좋은지, 무엇을 보러 가는지, 아이·어르신 동반 시 고려할 점",
  },
  { key: "bar", label: "바·펍", brief: "분위기와 시간대, 빌라로 돌아가는 동선, 일행 구성에 따른 선택" },
  { key: "spot", label: "가볼 만한 곳", brief: "무엇을 보러 가는 곳인지, 소요 시간과 일정 중 배치" },
];

export function placeCategory(key: string): PlaceCategory | undefined {
  return PLACE_CATEGORIES.find((c) => c.key === key);
}

/** topicKey 겸 slug — 회차가 이어진다(place-cafe-1, place-cafe-2 …). */
export function placeTopicKey(categoryKey: string, seq: number): string {
  return `place-${categoryKey}-${seq}`;
}

export const PLACE_SELECT = {
  id: true,
  name: true,
  nameLocal: true,
  category: true,
  area: true,
  oneLiner: true,
  tips: true,
  photos: {
    where: { active: true },
    select: { id: true, url: true, alt: true, caption: true },
    orderBy: { createdAt: "asc" as const },
    // 묶음 글은 장소당 1장만 쓰지만, **단독 글**은 여러 장을 쓴다(T-seo-ux-fix).
    take: 8,
  },
} satisfies Prisma.SeoPlaceSelect;

export type PlaceRow = Prisma.SeoPlaceGetPayload<{ select: typeof PLACE_SELECT }>;

export interface PlaceCandidate {
  category: PlaceCategory;
  seq: number;
  places: PlaceRow[];
}

/** 재료 총량 — 이름·인상·팁·지역만 센다(지어내기 방지의 근거가 되는 사람 입력분). */
export function placeFactCharCount(places: PlaceRow[]): number {
  return places
    .map((p) => [p.name, p.nameLocal ?? "", p.area ?? "", p.oneLiner, p.tips ?? ""].join(""))
    .join("").length;
}

export function hasEnoughPlaceFacts(places: PlaceRow[]): boolean {
  if (places.length < MIN_PLACES_PER_ARTICLE) return false;
  if (places.some((p) => p.oneLiner.trim().length === 0)) return false; // 인상 없는 장소는 못 쓴다
  return placeFactCharCount(places) >= MIN_PLACE_FACT_CHARS;
}

/**
 * 글로 묶을 수 있는 카테고리를 고른다 — **아직 소개하지 않은** 활성 장소가 3곳 이상 모인 카테고리.
 * 장소가 없으면 빈 배열(장소 글 단계 통째로 no-op).
 */
export async function getPlaceCandidates(db: DbClient = prisma): Promise<PlaceCandidate[]> {
  const rows = await db.seoPlace.findMany({
    where: { active: true, usedInArticleId: null },
    select: PLACE_SELECT,
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return [];

  const out: PlaceCandidate[] = [];
  for (const category of PLACE_CATEGORIES) {
    const places = rows.filter((r) => r.category === category.key).slice(0, MAX_PLACES_PER_ARTICLE);
    if (!hasEnoughPlaceFacts(places)) continue;
    // 회차 = 이 카테고리로 이미 만든 글 수 + 1 (상태 무관 — 반려분도 번호를 소비한다)
    const already = await db.seoArticle.count({ where: { topicKey: { startsWith: `place-${category.key}-` } } });
    out.push({ category, seq: already + 1, places });
  }
  return out;
}

/**
 * 제목 — 한 곳만 다루는 글은 **가게 이름이 제목에 와야 한다**(검색어가 곧 가게 이름이다).
 * "맛집 1곳"은 사람이 검색하지 않는 말이다.
 */
export function buildPlaceArticleTitle(c: PlaceCategory, places: PlaceRow[], seq: number): string {
  if (places.length === 1) {
    const p = places[0];
    const where = p.area ? `푸꾸옥 ${p.area}` : "푸꾸옥";
    return `${p.name} — ${where} ${c.label}, 직접 가보고 적는다`;
  }
  const suffix = seq > 1 ? ` (${seq}편)` : "";
  return `푸꾸옥 ${c.label} ${places.length}곳 — 직접 가본 곳만${suffix}`;
}

/**
 * 묶음 글은 **장소당 1장**(한 가게가 글을 잡아먹지 않게), 단독 글은 그 가게 사진을 여러 장 쓴다.
 * alt는 업로드 때 사람이 쓴 문장 그대로 — 사진 설명을 AI가 짓지 않는다.
 */
export function pickPlacePhotos(places: PlaceRow[], maxForSingle = 4): PickedImage[] {
  const out: PickedImage[] = [];
  const seen = new Set<string>();
  const perPlace = places.length === 1 ? maxForSingle : 1;
  for (const p of places) {
    let taken = 0;
    for (const photo of p.photos) {
      if (taken >= perPlace) break;
      if (seen.has(photo.url)) continue;
      seen.add(photo.url);
      out.push({ url: photo.url, alt: photo.alt, caption: photo.caption ?? p.name });
      taken++;
    }
  }
  return out;
}

/**
 * 소제목 다듬기 — ★모델이 **프롬프트의 뼈대를 그대로 소제목에 베껴 쓰는** 문제를 결정적으로 막는다.
 *   실측: "① 어떤 곳인가요?" "② 무엇을 먹거나 보러 가나요?"처럼 지시문의 번호·물음표가 그대로 나왔다.
 *   프롬프트로 "쓰지 마라"고만 하면 지켜지지 않는다 — 값에서 지우는 쪽이 확실하다.
 * 문단(p)은 건드리지 않는다(분량 하한 판정에 영향을 주면 안 된다).
 */
export function tidyHeadings<T extends { type: string }>(blocks: T[]): T[] {
  return blocks.map((b) => {
    if (b.type !== "h2") return b;
    const h = b as unknown as { type: "h2"; text: string };
    const text = h.text
      .replace(/^[\s]*[①②③④⑤⑥⑦⑧⑨⑩]\s*/u, "") // 원문자 번호
      .replace(/^[\s]*\d+[).．.]\s*/u, "") // "1) " "2. "
      .replace(/\?$/u, "") // 물음표 소제목("~인가요?") → 명사구로
      .trim();
    return { ...b, text: text || h.text } as T;
  });
}

/** 사용 처리 — 같은 가게가 다음 편에 다시 나오지 않게 한다. */
export async function markPlacesUsed(ids: string[], articleId: string, db: DbClient = prisma): Promise<void> {
  if (ids.length === 0) return;
  await db.seoPlace.updateMany({
    where: { id: { in: ids } },
    data: { usedInArticleId: articleId, usedAt: new Date() },
  });
}

/**
 * 초안 1편 생성 — cron(자동)과 운영자 버튼(수동)이 **같은 경로**를 쓴다.
 * ★ 수동 호출은 장소 1곳으로도 허용한다(운영자가 명시적으로 누른 것이고, 어차피 승인 게이트가 있다).
 *   자동 생성만 3곳 하한을 지킨다 — 사람이 안 보는 경로일수록 보수적이어야 한다.
 * 반환: 만든 글 / 못 만든 이유.
 */
export async function createPlaceArticleDraft(
  input: { category: PlaceCategory; places: PlaceRow[]; seq: number; createdBy: string },
  deps: {
    db?: DbClient;
    generate?: typeof generatePlaceArticleBody;
    /** 순환 참조를 피하려고 호출부가 넘긴다(article-draft의 공용 헬퍼들) */
    helpers: {
      isArticlePublishable: (blocks: ReturnType<typeof parseArticleBody>) => boolean;
      buildArticleSlug: (key: string) => string;
      buildSummary: (blocks: ReturnType<typeof parseArticleBody>) => string;
      interleaveImages: (
        blocks: ReturnType<typeof parseArticleBody>,
        images: PickedImage[]
      ) => ReturnType<typeof parseArticleBody>;
      brandFallbackImage: string;
    };
  }
): Promise<{ ok: true; id: string; slug: string; title: string; photos: number } | { ok: false; reason: string }> {
  const db = deps.db ?? prisma;
  const generate = deps.generate ?? generatePlaceArticleBody;
  const { category, places, seq, createdBy } = input;
  const key = placeTopicKey(category.key, seq);

  const draft = await generate(category, places);
  if (!draft) return { ok: false, reason: "생성 실패" };
  if (!deps.helpers.isArticlePublishable(draft.blocks)) return { ok: false, reason: "분량·구조 하한 미달" };

  const photos = pickPlacePhotos(places);
  const body = deps.helpers.interleaveImages(draft.blocks, photos);
  const row = await db.seoArticle.create({
    data: {
      slug: deps.helpers.buildArticleSlug(key),
      title: buildPlaceArticleTitle(category, places, seq),
      summary: deps.helpers.buildSummary(draft.blocks),
      bodyJson: body,
      topicKey: key,
      coverPhotoUrl: photos[0]?.url ?? deps.helpers.brandFallbackImage,
      status: "PENDING_APPROVAL",
      flaggedTerms: draft.flaggedTerms.length > 0 ? draft.flaggedTerms : undefined,
      createdBy,
    },
    select: { id: true, slug: true, title: true },
  });
  // ★ 글 저장 성공 뒤에만 소비 처리 — 실패한 회차가 장소를 태우면 그 가게는 영영 못 나온다.
  await markPlacesUsed(
    places.map((p) => p.id),
    row.id,
    db
  );
  return { ok: true, ...row, photos: photos.length };
}

export function buildPlaceArticlePrompt(c: PlaceCategory, places: PlaceRow[]): string {
  const blocks = places.map((p, i) => {
    const lines = [`${i + 1}) ${p.name}${p.nameLocal ? ` (현지 표기: ${p.nameLocal})` : ""}`];
    if (p.area) lines.push(`   - 위치: ${p.area}`);
    lines.push(`   - 직접 가본 인상: ${p.oneLiner}`);
    if (p.tips) lines.push(`   - 메모: ${p.tips}`);
    return lines.join("\n");
  });

  // ★ 한 곳만 다루는 글은 구조가 다르다 — 장소당 소제목 1개로는 800자 하한을 채울 수 없고,
  //   억지로 채우게 하면 없는 사실을 지어낸다. 그래서 "사실은 그대로 두고 판단·활용을 나눠 쓰는" 틀을 준다.
  const single = places.length === 1;
  const howTo = single
    ? [
        "쓰는 방법(중요):",
        "- 이 한 곳만 다루는 글이다. 아래 네 갈래를 각각 하나의 소제목으로 다뤄라:",
        "  (가) 어떤 곳인지(위 인상을 풀어서) (나) 무엇을 먹거나 보러 가는지(위에 적힌 것만)",
        "  (다) 어떤 일행·상황에 맞고 안 맞는지(판단) (라) 빌라 일정과 어떻게 엮으면 좋은지",
        "- ★ 소제목은 **이 지시문을 베끼지 마라**. 번호(①·1.)·괄호기호·물음표를 쓰지 말고,",
        "  그 단락 내용을 요약한 짧은 명사구로 직접 지어라(예: '반세오와 할아버지 맥주', '어떤 일행에게 맞나').",
        "- ③④는 위 사실에서 **추론한 판단**이다. '어떤 일행에게 맞는지', '일정 중 언제 넣을지' 같은",
        "  여행자 관점의 판단만 쓴다. 판단을 쓴다는 이유로 **가게에 관한 새 사실을 만들면 안 된다**",
        "- 특히 다음은 전부 '사실'이라 지어내면 폐기된다:",
        "  · 위치 관계('야시장 근처', '해변에서 가깝다', '시내 중심') — 위에 적힌 동네 이름까지만 쓴다",
        "  · 가게 컨셉·역사('현지 음식을 현대적으로 재해석', '오래된 노포')",
        "  · 재료·조리 방식('신선한 재료', '직접 반죽')·좌석·분위기·인기 여부",
        "- 도입부에서 '직접 가본 곳'이라는 점을 담백하게 밝혀라",
      ]
    : [
        "쓰는 방법(중요):",
        "- 각 장소를 소제목 하나씩으로 다뤄라. 위에 적힌 인상·메모를 자연스러운 문장으로 풀어 쓴다",
        "- **위에 없는 사실을 추가하지 마라** — 메뉴 이름, 분위기, 좌석, 뷰, 역사, 인기 여부를 지어내지 않는다",
        "- 인상이 짧으면 짧은 대로 쓴다. 억지로 부풀리지 마라",
        "- 도입부에서 이 목록이 '직접 가본 곳'이라는 점을 담백하게 밝혀라",
        "- 마지막에 빌라에 묵는 일정과 어떻게 엮으면 좋은지 한 문단",
      ];

  return [
    "너는 베트남 푸꾸옥에 살면서 빌라를 운영하는 사람의 글을 대신 정리하는 에디터다.",
    "운영자가 직접 다녀온 곳들을 한국인 여행객에게 소개하는 글을 쓴다. 본문만 쓴다.",
    "",
    `주제: 푸꾸옥 ${c.label} 소개`,
    `글의 각도: ${c.brief}`,
    "",
    single
      ? "다녀온 곳(이 가게 말고 다른 가게는 절대 언급하지 마라):"
      : "다녀온 곳(이 목록 밖의 가게는 절대 언급하지 마라):",
    ...blocks,
    "",
    ...howTo,
    "",
    "형식(반드시 지켜라):",
    "- JSON 배열만 출력한다. 코드펜스·설명 없이 배열 하나만",
    '- 각 원소는 {"type":"h2","text":"..."} 또는 {"type":"p","text":"..."} 또는 {"type":"ul","items":["..."]}',
    single ? "- 소제목(h2) 3~4개, 각 소제목 아래 문단 2개 이상" : "- 장소마다 소제목(h2) 1개 + 문단 2개 이상",
    "- 전체 본문 900~1500자(한국어). **900자 미만이면 실패로 폐기된다**",
    "- **이미지·영상 블록은 넣지 마라**(시스템이 알아서 배치한다)",
    "",
    "내용 규칙(어기면 폐기된다):",
    "- **영업시간·휴무일·가격·예산·전화번호를 쓰지 마라.** 바뀌는 정보라 쓰는 순간 틀린 글이 된다",
    "- 정확한 주소·좌표를 쓰지 마라(동네 이름까지만)",
    "- ★ 첫 블록부터 바로 본론이다. 인사·자기소개·예고 문장을 쓰지 마라",
    "  (금지 예: '안녕하세요', '소개해 드립니다', '이번에는 ~입니다', '~해 보세요')",
    "- 광고 문구체 금지('입안 가득 행복감', '망설임 없이 선택해 보세요', '놓칠 수 없는'). 담백한 서술체",
    "- 최상급·과장 표현은 **운영자가 직접 쓴 인상에 있을 때만** 그대로 인용하고, 네가 새로 만들지 마라",
    "- 확인되지 않은 통계·순위·수상 이력 금지",
    "- 다른 가게를 깎아내리지 마라",
  ].join("\n");
}

/** 장소 글 본문 생성. 실패 시 null — 폴백 템플릿 없음(다른 글 종류와 동일 원칙). */
export async function generatePlaceArticleBody(
  c: PlaceCategory,
  places: PlaceRow[],
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
          contents: [{ parts: [{ text: buildPlaceArticlePrompt(c, places) }] }],
          generationConfig: { temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const blocks = tidyHeadings(parseArticleBody(extractJsonArray(raw)));
    if (blocks.length === 0) return null;

    const flat = blocks
      .map((b) =>
        b.type === "ul" ? b.items.join(" ") : b.type === "img" ? (b.caption ?? "") : b.type === "video" ? b.title : b.text
      )
      .join(" ");
    return { blocks, flaggedTerms: findBannedTerms(flat) };
  } catch {
    return null;
  }
}
