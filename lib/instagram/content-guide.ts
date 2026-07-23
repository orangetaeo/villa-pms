// lib/instagram/content-guide.ts — 카피 가이드·해시태그 사전 로더/파서 (COPY 문서 = 정본)
//
// docs/marketing/copy-guide.md·hashtags.md를 런타임에 읽어 파싱한다(파일 존재 시 정본, 부재·파싱 실패 시
// 내장 폴백). COPY 서브에이전트가 두 문서를 갱신하면 코드 변경 없이 캡션·해시태그·금칙어가 갱신된다.
//
// 파싱 대상(현 문서 형식 — COPY와 형식 계약):
//   copy-guide.md: `## 5. 금칙어` 섹션의 모든 ```json 배열 = 금칙어. `## 2.` 표 = 헤드라인 뱅크.
//   hashtags.md:   `## N. 대형/중형/틈새/서비스` 다음 첫 ```json 배열. `## 5. 시즌`의 ```json 객체(active_* 키).
import { readFileSync } from "fs";
import path from "path";

const COPY_GUIDE_PATH = path.join(process.cwd(), "docs", "marketing", "copy-guide.md");
const HASHTAGS_PATH = path.join(process.cwd(), "docs", "marketing", "hashtags.md");

// ── 내장 폴백 (문서 부재·파싱 실패 시) ──────────────────────────────
const FALLBACK_BANNED = [
  "원가", "마진", "업체가", "도매가", "수수료", "차익",
  "최저가 보장", "최저가", "무조건", "100%", "박제", "특가 마감임박",
];
const FALLBACK_HASHTAGS = {
  major: ["#푸꾸옥", "#베트남여행", "#해외여행", "#풀빌라", "#가족여행", "#푸꾸옥여행"],
  mid: ["#푸꾸옥풀빌라", "#푸꾸옥숙소", "#푸꾸옥자유여행", "#푸꾸옥리조트", "#베트남풀빌라"],
  niche: ["#푸꾸옥가족여행", "#푸꾸옥커플여행", "#아이와푸꾸옥", "#푸꾸옥프라이빗풀빌라", "#푸꾸옥신혼여행"],
  season: ["#여름휴가", "#방학여행"],
  service: ["#푸꾸옥마사지", "#빈원더스", "#푸꾸옥BBQ", "#푸꾸옥케이블카"],
};
const FALLBACK_HEADLINES: HeadlineEntry[] = [
  { text: "푸꾸옥에서 눈 뜨자마자, 수영장", tags: ["수영장"] },
  { text: "온 가족 {maxGuests}명이 한 지붕 아래", tags: ["대가족"] },
  { text: "해변까지 딱 도보 {beachDistanceM}m", tags: ["해변근접"] },
  { text: "둘만의 푸꾸옥, 조용한 프라이빗 빌라", tags: ["커플"] },
  { text: "{villaName}에서 보내는 우리만의 하루", tags: ["범용"] },
];

export interface HeadlineEntry {
  text: string;
  tags: string[];
}
export interface HashtagPools {
  major: string[];
  mid: string[];
  niche: string[];
  season: string[];
  service: string[];
}

// ── 캐시 (프로세스 수명 — cron 1회 실행이라 재읽기 비용 무의미하나 안전상 캐시) ──
let _copyRaw: string | null | undefined;
let _hashRaw: string | null | undefined;

function readFileSafe(p: string): string | null {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** copy-guide.md 원문 — Gemini 프롬프트 주입용(없으면 null). */
export function loadCopyGuideRaw(): string | null {
  if (_copyRaw === undefined) _copyRaw = readFileSafe(COPY_GUIDE_PATH);
  return _copyRaw;
}
/** hashtags.md 원문 — Gemini 프롬프트 주입용(없으면 null). */
export function loadHashtagsRaw(): string | null {
  if (_hashRaw === undefined) _hashRaw = readFileSafe(HASHTAGS_PATH);
  return _hashRaw;
}

/** md에서 `## ` 헤딩 기준으로 해당 섹션 본문 슬라이스(heading 매칭=제목에 needle 포함). */
function sliceSection(md: string, needle: string): string | null {
  const lines = md.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]) && lines[i].includes(needle)) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** 텍스트 내 모든 ```json … ``` 블록을 파싱해 반환(파싱 실패 블록은 스킵). */
function extractJsonBlocks(text: string): unknown[] {
  const out: unknown[] = [];
  const re = /```json\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      /* 스킵 */
    }
  }
  return out;
}

/** 금칙어 배열 — copy-guide.md `## 5. 금칙어` 섹션의 모든 json 문자열 배열 합집합. */
export function getBannedTerms(): string[] {
  const raw = loadCopyGuideRaw();
  if (!raw) return FALLBACK_BANNED;
  const section = sliceSection(raw, "금칙어") ?? raw;
  const terms = new Set<string>();
  for (const block of extractJsonBlocks(section)) {
    if (Array.isArray(block)) {
      for (const t of block) if (typeof t === "string" && t.trim()) terms.add(t.trim());
    }
  }
  // 하드코딩 최소셋은 문서가 있어도 항상 포함(누수 방어의 마지막 보루).
  for (const t of FALLBACK_BANNED) terms.add(t);
  return terms.size > 0 ? [...terms] : FALLBACK_BANNED;
}

/** 특정 섹션(needle 헤딩) 다음 첫 json 문자열 배열. */
function firstStringArrayInSection(md: string, needle: string): string[] | null {
  const section = sliceSection(md, needle);
  if (!section) return null;
  for (const block of extractJsonBlocks(section)) {
    if (Array.isArray(block) && block.every((x) => typeof x === "string")) {
      return block as string[];
    }
  }
  return null;
}

/** 해시태그 풀 — hashtags.md 파싱(대형/중형/틈새/서비스 배열 + 시즌 활성 배열). */
export function getHashtagPools(): HashtagPools {
  const raw = loadHashtagsRaw();
  if (!raw) return { ...FALLBACK_HASHTAGS };

  const major = firstStringArrayInSection(raw, "대형") ?? FALLBACK_HASHTAGS.major;
  const mid = firstStringArrayInSection(raw, "중형") ?? FALLBACK_HASHTAGS.mid;
  const niche = firstStringArrayInSection(raw, "틈새") ?? FALLBACK_HASHTAGS.niche;
  const service = firstStringArrayInSection(raw, "서비스") ?? FALLBACK_HASHTAGS.service;

  // 시즌: json 객체에서 active_* 키(현재 활성)만.
  let season: string[] = FALLBACK_HASHTAGS.season;
  const seasonSection = sliceSection(raw, "시즌");
  if (seasonSection) {
    for (const block of extractJsonBlocks(seasonSection)) {
      if (block && typeof block === "object" && !Array.isArray(block)) {
        const obj = block as Record<string, unknown>;
        const activeKey = Object.keys(obj).find((k) => k.toLowerCase().startsWith("active"));
        if (activeKey && Array.isArray(obj[activeKey])) {
          season = (obj[activeKey] as unknown[]).filter((x): x is string => typeof x === "string");
          break;
        }
      }
    }
  }
  return { major, mid, niche, season, service };
}

/** 헤드라인 뱅크 — copy-guide.md `## 2.` 표 파싱: `| # | 헤드라인 | 특징 태그 |` 행. */
export function getHeadlineBank(): HeadlineEntry[] {
  const raw = loadCopyGuideRaw();
  if (!raw) return FALLBACK_HEADLINES;
  const section = sliceSection(raw, "헤드라인 문구 뱅크") ?? sliceSection(raw, "오버레이 헤드라인");
  if (!section) return FALLBACK_HEADLINES;
  const out: HeadlineEntry[] = [];
  for (const line of section.split(/\r?\n/)) {
    // 표 행: | 1 | 헤드라인 텍스트 | 태그, 태그 |
    const cells = line.split("|").map((c) => c.trim());
    // 앞뒤 빈 셀 제거 후 [번호, 헤드라인, 태그] 형태.
    if (cells.length >= 5 && /^\d+$/.test(cells[1]) && cells[2]) {
      const tags = cells[3]
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
      out.push({ text: cells[2], tags });
    }
  }
  return out.length > 0 ? out : FALLBACK_HEADLINES;
}

/** 테스트/디버그 전용 — 캐시 리셋. */
/**
 * 프롬프트에 넣을 카피가이드 블록 (T-copy-everywhere).
 * ★ **모든 생성 경로**(블로그 본문·인스타 캡션·릴스 자막·쇼츠 메타)가 이걸 통과해야 한다 —
 *   테오 지시 2026-07-23: "영상·포스팅·릴스·블로그 만들 때 카피라이터 MD가 일을 하게 하라".
 *   문서(docs/marketing/copy-guide.md)가 규칙의 정본이고, 코드는 규칙을 새로 만들지 않는다.
 */
export function copyGuidePromptBlock(maxChars = 6000): string {
  const raw = loadCopyGuideRaw();
  if (!raw) return "";
  return ["[카피가이드 — 브랜드 보이스·금칙어. 아래 규칙을 따른다]", raw.slice(0, maxChars), ""].join(
    String.fromCharCode(10)
  );
}

export function __resetContentGuideCache(): void {
  _copyRaw = undefined;
  _hashRaw = undefined;
}
