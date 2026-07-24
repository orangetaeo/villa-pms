// lib/seo/gallery.ts — 본문 이미지 갤러리 그리드 레이아웃 (T-blog-gallery)
//
// 왜: 사진이 많은 글(맛집 등)에서 이미지를 한 장씩 세로로 쌓으면 사진첩처럼 길고 단조롭다.
// 테오 지적 2026-07-24: "4장짜리·2장짜리·1장짜리로 좌우 대칭 이쁘게, 골고루 들어가게".
// → **인접한 img 블록을 하나의 갤러리로 묶어** 행(row) 단위 그리드로 렌더한다.
//
// ★ 새 블록 타입을 만들지 않는다. 저장 정본은 그대로 `img` 블록의 연속이고, 이 파일은 **렌더 시점**에만
//   그것들을 묶는다. 그래서 파서·편집 폼·글자수 계산은 손대지 않아도 된다(회귀 위험 0).
// ★ 서버 전용 import를 두지 않는다(클라이언트 컴포넌트에서도 쓰므로). ArticleBlock은 타입만 가져온다.
import type { ArticleBlock } from "@/lib/seo/article";

type ImgBlock = Extract<ArticleBlock, { type: "img" }>;

/** 렌더 단위: 갤러리(연속 이미지 묶음) 또는 일반 블록 하나. */
export type RenderItem =
  | { kind: "gallery"; images: ImgBlock[] }
  | { kind: "block"; block: ArticleBlock };

/**
 * 인접한 img 블록을 하나의 갤러리로 묶는다.
 *   · 2장 이상 연속 → 갤러리(그리드)
 *   · 1장만 있으면 → 그냥 단일 이미지 블록(기존 렌더 그대로 — 캡션·전체폭 유지)
 * 블록 순서는 보존한다(텍스트 사이에 흩어진 이미지도 각자 위치에서 묶인다).
 */
export function groupBlocksForRender(blocks: ArticleBlock[]): RenderItem[] {
  const out: RenderItem[] = [];
  let run: ImgBlock[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) out.push({ kind: "block", block: run[0] });
    else out.push({ kind: "gallery", images: run });
    run = [];
  };
  for (const b of blocks) {
    if (b.type === "img") {
      run.push(b);
      continue;
    }
    flush();
    out.push({ kind: "block", block: b });
  }
  flush();
  return out;
}

/**
 * n장을 좌우 대칭으로 보기 좋은 행들로 나눈다.
 *   · 한 행 최대 3장 — 블로그는 모바일(한국 여행객)이 주 독자라 4장 이상은 각 사진이 너무 작아진다.
 *   · 마지막 행이 1장으로 외롭게 남지 않게 조정한다(나머지 1장 → 앞 행을 2+2로 분해).
 * 예: 1→[1] · 2→[2] · 3→[3] · 4→[2,2] · 5→[3,2] · 6→[3,3] · 7→[3,2,2] · 8→[3,3,2] · 10→[3,3,2,2]
 */
export function galleryRows(n: number): number[] {
  if (n <= 0) return [];
  if (n <= 3) return [n];
  const threes = Math.floor(n / 3);
  const rem = n % 3;
  if (rem === 0) return Array(threes).fill(3);
  if (rem === 2) return [...Array(threes).fill(3), 2];
  // rem === 1 → 마지막 3장 한 행을 2+2로 바꿔 외톨이 방지 (threes >= 1 보장: n >= 4)
  return [...Array(threes - 1).fill(3), 2, 2];
}
