// lib/seo/article-edit.ts — 승인 화면 본문 편집 (T-seo-article-edit)
//
// 왜: 지금까지 승인 화면은 **승인 아니면 반려**뿐이었다. 문장 하나가 마음에 안 들면 글 전체를 버려야 했다
// (메오키친 실사례: "신선한 재료", "즈엉동 중심부에 위치" 같은 지어낸 표현 3~4곳 때문에 반려).
// 90% 쓸 만한 글을 5초 고쳐 쓰는 쪽이 옳다.
//
// ★ 클라이언트 JS 없이 동작한다 — 폼 배열(FormData.getAll)은 **DOM 순서대로** 오므로 그 순서가 곧 블록 순서다.
//   삭제는 체크박스가 아니라 select("유지"/"삭제")로 받는다 — 체크 안 된 체크박스는 전송되지 않아
//   블록끼리 짝이 어긋난다(인덱스 밀림). 이건 실수하기 쉬운 지점이라 못박아 둔다.
// ★ 편집 결과도 파서(parseArticleBody)를 다시 통과시킨다 — 사람이 고쳤어도 렌더 계약은 그대로 지켜야 한다.
import type { ArticleBlock } from "@/lib/seo/article";

export interface EditedArticle {
  title: string;
  summary: string;
  blocks: ArticleBlock[];
}

/** 폼 → 블록 배열. 순서는 폼 필드 순서를 그대로 따른다(삭제된 블록만 빠진다). */
export function parseEditedBlocks(form: {
  getAll: (name: string) => FormDataEntryValue[];
}): ArticleBlock[] {
  const types = form.getAll("bType").map(String);
  const keeps = form.getAll("bKeep").map(String);
  const texts = form.getAll("bText").map(String);
  const urls = form.getAll("bUrl").map(String);
  const alts = form.getAll("bAlt").map(String);
  const videoIds = form.getAll("bVideo").map(String);

  const out: ArticleBlock[] = [];
  for (let i = 0; i < types.length; i++) {
    if (keeps[i] === "drop") continue; // 운영자가 삭제 선택
    const type = types[i];
    const text = (texts[i] ?? "").trim();

    if (type === "h2" || type === "p") {
      if (text.length === 0) continue; // 내용을 비우면 삭제와 같다
      out.push({ type, text });
    } else if (type === "ul") {
      const items = text
        .split("\n")
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
      if (items.length > 0) out.push({ type: "ul", items });
    } else if (type === "img") {
      const url = (urls[i] ?? "").trim();
      const alt = (alts[i] ?? "").trim();
      if (!url || !alt) continue; // alt 없는 이미지는 파서가 어차피 버린다 — 여기서 먼저 뺀다
      out.push(text ? { type: "img", url, alt, caption: text } : { type: "img", url, alt });
    } else if (type === "video") {
      const id = (videoIds[i] ?? "").trim();
      if (id) out.push({ type: "video", ytVideoId: id, title: text || "빌라 영상" });
    }
  }
  return out;
}

/** 편집 폼 전체 파싱(제목·요약 포함). 제목이 비면 원본을 유지하도록 호출부가 판단한다. */
export function parseEditedArticle(form: {
  get: (name: string) => FormDataEntryValue | null;
  getAll: (name: string) => FormDataEntryValue[];
}): EditedArticle {
  return {
    title: String(form.get("title") ?? "").trim().slice(0, 200),
    summary: String(form.get("summary") ?? "").trim().slice(0, 300),
    blocks: parseEditedBlocks(form),
  };
}
