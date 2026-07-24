// lib/seo/article-html.ts — 블록 → 상세페이지 HTML (T-blog-visual)
//
// 테오 지시 2026-07-23: "추후 홈페이지를 만들면 거기 올라갈 콘텐츠를 미리 만든다고 생각하면 된다.
// 상세페이지 내용은 HTML로 만들어줘야 된다."
//
// 그래서 글은 **블록(정본) + HTML(산출물)** 두 형태로 보관한다:
//   · 블록 = 편집·검증·재렌더의 원천(파서가 지키는 계약)
//   · HTML = 그대로 홈페이지 상세페이지에 붙일 수 있는 결과물
// ★ HTML은 **정본이 아니다** — 블록이 바뀌면 다시 만든다(불일치가 생기면 블록이 이긴다).
// ★ 이스케이프 필수: 본문은 Gemini 산출물이라 신뢰할 수 없다. 태그 주입을 값 단계에서 막는다.
import type { ArticleBlock } from "@/lib/seo/article";
import { galleryRows, groupBlocksForRender } from "@/lib/seo/gallery";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ArticleHtmlOptions {
  title: string;
  /** 대표 썸네일(있으면 맨 위에 넣는다) */
  thumbnailUrl?: string | null;
  /** 상세페이지 상단 요약 */
  summary?: string | null;
}

/**
 * 블록 배열 → 상세페이지 HTML 문자열.
 * 클래스명은 `vg-` 접두사로 통일 — 홈페이지에 붙일 때 스타일 충돌을 피하고, 그대로 CSS를 잡을 수 있다.
 */
export function toArticleHtml(blocks: ArticleBlock[], opts: ArticleHtmlOptions): string {
  const parts: string[] = [];
  parts.push(`<article class="vg-article">`);
  if (opts.thumbnailUrl) {
    parts.push(
      `<figure class="vg-hero"><img src="${escapeHtml(opts.thumbnailUrl)}" alt="${escapeHtml(opts.title)}" loading="eager" /></figure>`
    );
  }
  parts.push(`<h1 class="vg-title">${escapeHtml(opts.title)}</h1>`);
  if (opts.summary) parts.push(`<p class="vg-summary">${escapeHtml(opts.summary)}</p>`);

  // ★ 연속 이미지는 그리드 갤러리로 묶는다(vg-gallery). 1장은 기존 단일 figure 그대로.
  //   행 컬럼 수는 vg-cols-N 클래스로 표시 — 홈페이지 CSS에서 grid-template-columns를 잡는다.
  for (const it of groupBlocksForRender(blocks)) {
    if (it.kind === "gallery") {
      const rows = galleryRows(it.images.length);
      let idx = 0;
      const rowHtml = rows
        .map((size) => {
          const cells = it.images
            .slice(idx, idx + size)
            .map((im) => `<img src="${escapeHtml(im.url)}" alt="${escapeHtml(im.alt)}" loading="lazy" />`)
            .join("");
          idx += size;
          return `<div class="vg-gallery-row vg-cols-${size}">${cells}</div>`;
        })
        .join("");
      parts.push(`<div class="vg-gallery">${rowHtml}</div>`);
      continue;
    }
    const b = it.block;
    if (b.type === "h2") {
      parts.push(`<h2 class="vg-h2">${escapeHtml(b.text)}</h2>`);
    } else if (b.type === "p") {
      parts.push(`<p class="vg-p">${escapeHtml(b.text)}</p>`);
    } else if (b.type === "ul") {
      parts.push(`<ul class="vg-ul">${b.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`);
    } else if (b.type === "img") {
      const cap = b.caption ? `<figcaption>${escapeHtml(b.caption)}</figcaption>` : "";
      parts.push(
        `<figure class="vg-figure"><img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.alt)}" loading="lazy" />${cap}</figure>`
      );
    } else if (b.type === "video") {
      // youtube-nocookie — 기존 공개 렌더와 같은 정책(추적 최소화)
      parts.push(
        `<figure class="vg-video"><iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(b.ytVideoId)}" ` +
          `title="${escapeHtml(b.title)}" loading="lazy" allowfullscreen></iframe></figure>`
      );
    }
  }
  parts.push(`</article>`);
  return parts.join("\n");
}
