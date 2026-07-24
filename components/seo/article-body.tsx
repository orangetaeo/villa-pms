// components/seo/article-body.tsx — 가이드 글 본문 렌더 (T-seo-s3)
//
// ★ 블록 JSON만 렌더한다 — dangerouslySetInnerHTML을 쓰지 않는다.
//   본문은 Gemini 산출물(미신뢰 입력)이므로 HTML을 그대로 주입하면 저장형 XSS 표면이 된다.
//   lib/seo/article.ts parseArticleBody가 허용 타입 밖을 이미 버리고, 여기서는 텍스트로만 출력한다.
import Image from "next/image";
import type { ArticleBlock } from "@/lib/seo/article";

export default function ArticleBody({ blocks }: { blocks: ArticleBlock[] }) {
  return (
    <div className="space-y-5">
      {blocks.map((b, i) => {
        if (b.type === "img") {
          // alt는 파싱 단계에서 필수 보장 — 빈 alt 이미지는 블록째로 버려진다.
          // 이미지 검색 유입과 접근성이 alt에 달려 있으므로 장식용 빈 alt를 허용하지 않는다.
          return (
            <figure key={i} className="my-6">
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-100">
                <Image
                  src={b.url}
                  alt={b.alt}
                  fill
                  sizes="(max-width: 640px) 100vw, 640px"
                  className="object-cover"
                />
              </div>
              {b.caption && (
                <figcaption className="mt-2 text-center text-xs text-slate-500">{b.caption}</figcaption>
              )}
            </figure>
          );
        }
        if (b.type === "video") {
          // youtube-nocookie = 재생 전 추적 쿠키 없음. lazy = 첫 화면 성능(랭킹 요소) 보호.
          return (
            <figure key={i} className="my-6">
              <div className="relative mx-auto aspect-[9/16] w-full max-w-xs overflow-hidden rounded-2xl bg-slate-100">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${b.ytVideoId}`}
                  title={b.title}
                  loading="lazy"
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="absolute inset-0 h-full w-full"
                />
              </div>
              <figcaption className="mt-2 text-center text-xs text-slate-500">{b.title}</figcaption>
            </figure>
          );
        }
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
