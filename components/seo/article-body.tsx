// components/seo/article-body.tsx — 가이드 글 본문 렌더 (T-seo-s3)
//
// ★ 블록 JSON만 렌더한다 — dangerouslySetInnerHTML을 쓰지 않는다.
//   본문은 Gemini 산출물(미신뢰 입력)이므로 HTML을 그대로 주입하면 저장형 XSS 표면이 된다.
//   lib/seo/article.ts parseArticleBody가 허용 타입 밖을 이미 버리고, 여기서는 텍스트로만 출력한다.
import type { ArticleBlock } from "@/lib/seo/article";

export default function ArticleBody({ blocks }: { blocks: ArticleBlock[] }) {
  return (
    <div className="space-y-5">
      {blocks.map((b, i) => {
        if (b.type === "h2") {
          return (
            <h2 key={i} className="pt-2 text-xl font-bold text-slate-900">
              {b.text}
            </h2>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={i} className="list-disc space-y-1.5 pl-5 text-slate-700">
              {b.items.map((it, j) => (
                <li key={j} className="leading-relaxed">
                  {it}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="leading-relaxed text-slate-700">
            {b.text}
          </p>
        );
      })}
    </div>
  );
}
