// lib/instagram/headline-wrap.ts — 헤드라인 균형 줄바꿈(satori 고아 줄바꿈 방지)
//
// 문제(실측 2026-07-21): satori는 한글을 "글자 단위"로 줄바꿈한다. \n 없는 긴 헤드라인
//   ("이번 휴가는, 빌라 한 채를 통째로")이 오버레이 폭을 넘으면 마지막 음절("로")만 다음 줄로
//   떨어지는 고아(orphan) 줄바꿈이 생겨 디자인이 깨진다.
// 해결: 렌더 전에 헤드라인을 각 템플릿의 폰트 크기·내부 폭에 맞게 **공백 경계로 미리 줄바꿈**한다.
//   ① 필요한 최소 줄 수 L을 구하고 ② L줄을 유지하는 가장 작은 폭 한계로 다시 wrap → 줄 폭이 고르게
//   퍼져(균형 줄바꿈) 마지막 줄에 한 음절만 남는 고아를 방지한다. whiteSpace: pre-line 이 우리가
//   넣은 \n 을 그대로 반영하고, 각 줄의 추정 폭이 maxWidth 이하라 satori는 추가 줄바꿈을 하지 않는다.
//
// ★ 폭 추정은 "약간 과대" 방향으로 잡는다(한글 1.0em). 추정 ≥ 실제이면, 추정이 maxWidth 이하일 때
//   실제도 반드시 이하 → satori 고아가 절대 생기지 않는다(안전한 오차 방향).

/** 문자 1개의 대략적 advance(글자폭) 배수(em 기준). Myeongjo/Gothic 볼드 실측 근사. */
function glyphEm(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (ch === " ") return 0.3;
  // 한글 음절(가~힣)·자모·CJK·전각 = 정사각에 가까움 → 과대 방향으로 1.0.
  if (
    (code >= 0xac00 && code <= 0xd7a3) || // 한글 음절
    (code >= 0x1100 && code <= 0x11ff) || // 한글 자모
    (code >= 0x3130 && code <= 0x318f) || // 호환 자모
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 통합한자
    (code >= 0xff00 && code <= 0xffef) // 전각
  ) {
    return 1.0;
  }
  if (/[A-Z0-9]/.test(ch)) return 0.62; // 라틴 대문자·숫자
  if (/[a-z]/.test(ch)) return 0.52; // 라틴 소문자
  return 0.4; // 문장부호(쉼표·마침표·중점 등)는 좁다
}

/** 문자열의 추정 렌더 폭(px). */
export function estimateTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) em += glyphEm(ch);
  return em * fontSize;
}

/** 공백 없는 한 토큰이 limit을 넘으면 글자 단위로 강제 분할(희귀 안전망). */
function hardBreakToken(token: string, fontSize: number, limit: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of token) {
    const next = cur + ch;
    if (cur && estimateTextWidth(next, fontSize) > limit) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** words를 limit 폭으로 greedy 채우기. 개별 word가 limit을 넘으면 글자 단위 분할로 폴백. */
function greedyWrap(words: string[], fontSize: number, limit: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (estimateTextWidth(word, fontSize) > limit) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      const broken = hardBreakToken(word, fontSize, limit);
      cur = broken.pop() ?? "";
      lines.push(...broken);
      continue;
    }
    const candidate = cur ? `${cur} ${word}` : word;
    if (cur && estimateTextWidth(candidate, fontSize) > limit) {
      lines.push(cur);
      cur = word;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** 공백으로 나눈 한 세그먼트를 균형 줄바꿈(최소 줄 수 유지 + 줄 폭 균등화). */
function wrapSegment(segment: string, fontSize: number, maxWidth: number): string[] {
  const words = segment.split(" ").filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const minLines = greedyWrap(words, fontSize, maxWidth).length;
  if (minLines <= 1) return greedyWrap(words, fontSize, maxWidth);

  // minLines 를 유지하는 "가장 작은 폭 한계"를 이진탐색 → 줄들이 고르게 퍼진다(균형).
  // 하한 = 가장 넓은 단어(한 줄에 반드시 들어가야 함), 상한 = maxWidth.
  let lo = Math.max(...words.map((w) => estimateTextWidth(w, fontSize)));
  let hi = maxWidth;
  for (let i = 0; i < 40 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    if (greedyWrap(words, fontSize, mid).length <= minLines) hi = mid;
    else lo = mid;
  }
  return greedyWrap(words, fontSize, hi);
}

/**
 * 헤드라인을 fontSize·maxWidth에 맞게 균형 줄바꿈한 문자열(\n 결합)로 변환.
 * - 기존 "\n"(작가가 넣은 하드 줄바꿈)은 세그먼트 경계로 존중하고, 각 세그먼트를 폭에 맞춰 다시 wrap.
 * - 폭 추정이 실제보다 크므로(한글 1.0em) satori가 추가로 흘리지 않는다 → 고아 음절 방지.
 * @param text 헤드라인(변수 치환 완료)
 * @param fontSize 템플릿 폰트 크기(px)
 * @param maxWidth 오버레이 내부 가용 폭(px) = 캔버스폭 - 좌우 패딩
 */
export function wrapHeadlineToFit(text: string, fontSize: number, maxWidth: number): string {
  const segments = text.split("\n");
  const out: string[] = [];
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (trimmed.length === 0) {
      out.push(""); // 빈 줄(의도된 간격) 보존
      continue;
    }
    out.push(...wrapSegment(trimmed, fontSize, maxWidth));
  }
  return out.join("\n");
}
