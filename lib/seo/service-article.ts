// lib/seo/service-article.ts — 부가서비스 글 (T-seo-service-article)
//
// 왜 필요한가: 초안 cron이 만드는 글은 **빌라 글**과 **가이드 글 8종**뿐이라,
// 앞으로 판매할 마사지·입장권·BBQ·차량·조식 같은 상품은 어느 쪽에도 걸리지 않아 영원히 글이 없었다.
// 검색으로 팔아야 하는 상품인데 검색에 걸릴 페이지가 없는 상태였다.
//
// ★★ 원칙 2(마진 비공개) 구조적 차단: 이 모듈은 카탈로그에서 **금액 필드를 애초에 읽지 않는다**.
//    SERVICE_ITEM_SELECT에 priceVnd·costVnd가 없고, 옵션도 `labelKo`만 추출한다
//    (options JSON 안에 priceVnd·costVnd가 들어 있으므로 통째로 넘기면 그대로 샌다).
//    "프롬프트에 쓰지 말라고 지시" 같은 방식은 신뢰하지 않는다 — 값 자체를 가져오지 않는 것이 계약이다.
// ★ 벤더(업체명·연락처)도 다루지 않는다 — 직거래 우회 차단.
import { ServiceType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { parseCatalogOptions } from "@/lib/service-catalog";
import { findBannedTerms } from "@/lib/instagram/caption";
import { copyGuidePromptBlock } from "@/lib/instagram/content-guide";
import { parseArticleBody } from "@/lib/seo/article";
import { extractJsonArray, type DraftResult, type PickedImage } from "@/lib/seo/article-draft";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 60_000;

/** 재료가 이보다 얇으면 글을 만들지 않는다 — 이름만 있는 카탈로그로 쓴 글은 그 자체가 얇은 콘텐츠다. */
export const MIN_SERVICE_FACT_CHARS = 40;

export interface ServiceTopic {
  type: ServiceType;
  /** topicKey 겸 slug — URL이 되므로 소문자·하이픈만 */
  key: string;
  title: string;
  /** 집필 각도 — 상품 나열이 아니라 "언제 필요한가"를 쓰게 만든다 */
  brief: string;
}

export const SERVICE_TOPICS: ServiceTopic[] = [
  {
    type: ServiceType.BBQ,
    key: "service-bbq",
    title: "푸꾸옥 빌라 BBQ — 준비부터 뒷정리까지 어떻게 진행되나",
    brief: "빌라에서 바베큐를 하는 흐름(주문 시점·준비물·인원별 양·뒷정리), 직접 장을 보는 것과 비교했을 때의 차이",
  },
  {
    type: ServiceType.TICKET,
    key: "service-ticket",
    title: "푸꾸옥 입장권 — 무엇을 미리 준비하면 편한가",
    brief: "현장 구매와 사전 준비의 차이, 일행 구성(아이·어르신)에 따라 달라지는 선택, 이동 동선과 묶어 생각하는 법",
  },
  {
    type: ServiceType.GUIDE,
    key: "service-guide",
    title: "푸꾸옥 한국어 가이드 — 언제 필요하고 언제 필요 없나",
    brief: "가이드가 실제로 도움이 되는 상황과 굳이 필요 없는 상황, 일정 중 어느 구간에 붙이면 효율적인지",
  },
  {
    type: ServiceType.CAR_RENTAL,
    key: "service-car-rental",
    title: "푸꾸옥 차량 이용 — 기사 포함 이동이 편한 경우",
    brief: "섬 안 이동 거리와 도로 사정, 짐·아이가 있는 일행의 이동, 시간 단위 이용과 구간 이용의 차이",
  },
  {
    type: ServiceType.BREAKFAST,
    key: "service-breakfast",
    title: "빌라 조식 — 아침을 어떻게 해결할까",
    brief: "빌라 숙박에서 아침이 애매해지는 이유, 배달 조식·직접 준비·외식의 비교, 아이 동반 일행의 선택",
  },
  {
    type: ServiceType.MOTORBIKE_RENTAL,
    key: "service-motorbike-rental",
    title: "푸꾸옥 오토바이 이용 — 빌리기 전에 알아둘 것",
    brief: "면허·안전 장비·주행 구간 등 실제로 확인해야 할 점, 오토바이가 맞는 일정과 맞지 않는 일정",
  },
  {
    type: ServiceType.MASSAGE,
    key: "service-massage",
    title: "푸꾸옥 마사지 — 빌라에서 받는 방문 마사지 안내",
    brief: "샵 방문과 빌라 방문의 차이, 일정 중 언제 넣으면 좋은지, 인원·시간 구성 잡는 법, 준비해두면 좋은 것",
  },
  {
    type: ServiceType.BARBER,
    key: "service-barber",
    title: "푸꾸옥 이발·귀 관리 — 현지에서 이용하기 전에",
    brief: "현지 이발소 이용 흐름과 소통 문제, 시간이 얼마나 걸리는지, 일정 중 넣기 좋은 시점",
  },
  {
    type: ServiceType.FRUIT,
    key: "service-fruit",
    title: "푸꾸옥 열대과일 — 빌라로 받아 먹는 방법",
    brief: "제철 과일과 보관·손질 문제, 시장에서 직접 사는 것과의 차이, 아이 동반 일행이 챙기면 좋은 구성",
  },
];

export function serviceTopicByType(type: ServiceType): ServiceTopic | undefined {
  return SERVICE_TOPICS.find((t) => t.type === type);
}

/**
 * ★ 금액 필드를 select에 넣지 않는다 — 조회 자체를 하지 않는 것이 원칙 2의 구조적 방어다.
 *   options는 금액을 품고 있으므로 이 모듈 안에서 라벨만 뽑아 쓴다(밖으로 그대로 내보내지 않는다).
 */
export const SERVICE_ITEM_SELECT = {
  id: true,
  type: true,
  nameKo: true,
  descKo: true,
  unitLabelKo: true,
  options: true,
  photoUrl: true,
} satisfies Prisma.ServiceCatalogItemSelect;

export type ServiceItemRow = Prisma.ServiceCatalogItemGetPayload<{ select: typeof SERVICE_ITEM_SELECT }>;

/** 프롬프트에 넘길 재료 — **금액 키가 존재하지 않는 형태**로 고정한다(테스트로 잠금). */
export interface ServiceFacts {
  names: string[];
  units: string[];
  descriptions: string[];
  optionLabels: string[];
}

export function buildServiceFacts(items: ServiceItemRow[]): ServiceFacts {
  const names: string[] = [];
  const units: string[] = [];
  const descriptions: string[] = [];
  const optionLabels: string[] = [];

  for (const it of items) {
    const name = (it.nameKo ?? "").trim();
    if (name) names.push(name);
    const unit = (it.unitLabelKo ?? "").trim();
    if (unit && !units.includes(unit)) units.push(unit);
    const desc = (it.descKo ?? "").trim();
    if (desc) descriptions.push(desc);

    // ★ 옵션은 labelKo만. priceVnd·costVnd는 여기서 버려진다.
    const opts = parseCatalogOptions(it.options);
    for (const group of [opts.variants, opts.addons, opts.modifiers]) {
      for (const o of group ?? []) {
        const label = (o.labelKo ?? "").trim();
        if (label && !optionLabels.includes(label)) optionLabels.push(label);
      }
    }
  }
  return { names, units, descriptions, optionLabels };
}

/** 재료 총량(자) — 하한 판정용. 이름만 있는 상태로는 글을 쓰지 않는다. */
export function serviceFactsCharCount(f: ServiceFacts): number {
  return [...f.names, ...f.units, ...f.descriptions, ...f.optionLabels].join("").length;
}

export function hasEnoughServiceFacts(f: ServiceFacts): boolean {
  return f.names.length > 0 && serviceFactsCharCount(f) >= MIN_SERVICE_FACT_CHARS;
}

/** 상품 사진 — 카탈로그 항목 사진은 **그 서비스의 실사진**이라 본문 주제와 정확히 맞는다. */
export function pickServicePhotos(topic: ServiceTopic, items: ServiceItemRow[], max = 3): PickedImage[] {
  const out: PickedImage[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (out.length >= max) break;
    const url = (it.photoUrl ?? "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const name = (it.nameKo ?? "").trim();
    out.push({
      url,
      alt: name ? `푸꾸옥 ${name}` : topic.title,
      ...(name ? { caption: name } : {}),
    });
  }
  return out;
}

export interface ServiceCandidate {
  topic: ServiceTopic;
  items: ServiceItemRow[];
  facts: ServiceFacts;
}

/**
 * 글을 쓸 수 있는 서비스 타입을 고른다 — 아직 글이 없고(usedKeys), 활성 항목이 있고, 재료가 충분한 타입.
 * ★ 카탈로그가 비면 빈 배열 → 서비스 글 단계는 통째로 no-op다(현재 상태가 그렇다).
 */
export async function getServiceCandidates(
  usedKeys: Set<string>,
  db: DbClient = prisma
): Promise<ServiceCandidate[]> {
  const pending = SERVICE_TOPICS.filter((t) => !usedKeys.has(t.key));
  if (pending.length === 0) return [];

  const rows = await db.serviceCatalogItem.findMany({
    where: { active: true, type: { in: pending.map((t) => t.type) } },
    select: SERVICE_ITEM_SELECT,
    orderBy: { sortOrder: "asc" },
  });
  if (rows.length === 0) return [];

  const out: ServiceCandidate[] = [];
  for (const topic of pending) {
    const items = rows.filter((r) => r.type === topic.type);
    if (items.length === 0) continue;
    const facts = buildServiceFacts(items);
    if (!hasEnoughServiceFacts(facts)) continue; // 재료가 얇으면 다음 회차로 미룬다
    out.push({ topic, items, facts });
  }
  return out;
}

export function buildServiceArticlePrompt(topic: ServiceTopic, facts: ServiceFacts): string {
  const lines: string[] = [];
  if (facts.names.length) lines.push(`- 우리가 실제로 제공하는 구성: ${facts.names.join(", ")}`);
  if (facts.units.length) lines.push(`- 판매 단위: ${facts.units.join(", ")}`);
  if (facts.optionLabels.length) lines.push(`- 선택 가능한 옵션: ${facts.optionLabels.join(", ")}`);
  for (const d of facts.descriptions.slice(0, 5)) lines.push(`- 설명: ${d}`);

  return [
    copyGuidePromptBlock(),
    "너는 베트남 푸꾸옥 현지에서 빌라를 운영하는 회사의 콘텐츠 에디터다.",
    "빌라에 묵는 한국인 여행객이 검색으로 들어와 읽을, 부가서비스 안내 글을 쓴다. 본문만 쓴다.",
    "",
    `주제: ${topic.title}`,
    `다뤄야 할 내용: ${topic.brief}`,
    "",
    "확인된 사실(이 범위 안에서만 쓴다):",
    ...lines,
    "",
    "글의 각도(중요):",
    "- 상품 목록을 나열하지 마라. 목록은 주문 화면에 이미 있다",
    "- **언제 필요하고 언제 필요 없는지**, 어떤 일행에게 맞는지를 중심으로 써라",
    "- 실제 진행 흐름(언제 이야기하면 되는지, 무엇을 준비하면 되는지)을 그려줘라",
    "- 맞지 않는 경우도 한 번은 솔직히 짚어라",
    "",
    "형식(반드시 지켜라):",
    "- JSON 배열만 출력한다. 코드펜스·설명 없이 배열 하나만",
    '- 각 원소는 {"type":"h2","text":"..."} 또는 {"type":"p","text":"..."} 또는 {"type":"ul","items":["..."]}',
    "- 소제목(h2) 3~4개, 각 소제목 아래 문단 2개 이상",
    "- 전체 본문 900~1400자(한국어)",
    "- **이미지·영상 블록은 넣지 마라**(시스템이 알아서 배치한다)",
    "",
    "내용 규칙(어기면 폐기된다):",
    "- 위에 없는 사실을 지어내지 마라. 없는 구성·옵션·소요 시간을 추측하지 않는다",
    "- **가격·요금·금액 표현 절대 금지**('원', '동', '달러', '얼마', '무료' 포함)",
    "- 업체명·기사·직원 등 협력업체 정보를 쓰지 마라",
    "- 최상급·과장('최고', '1위')·미확인 통계 금지",
    "- 의료 효능·치료 효과를 단정하지 마라",
    "",
    "마지막 문단에서 상담을 자연스럽게 권하되 호객성 문구는 쓰지 마라.",
  ].join("\n");
}

/**
 * 서비스 글 본문 생성. 실패 시 null(호출부가 이번 회차 건너뜀).
 * 폴백 템플릿 없음 — 빌라 글·가이드 글과 같은 원칙(못 만들면 안 만든다).
 */
export async function generateServiceArticleBody(
  topic: ServiceTopic,
  facts: ServiceFacts,
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
          contents: [{ parts: [{ text: buildServiceArticlePrompt(topic, facts) }] }],
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
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const blocks = parseArticleBody(extractJsonArray(raw));
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
