// components/seo/article-body.tsx — 가이드 글 본문 렌더 (T-seo-s3)
//
// ★ 블록 JSON만 렌더한다 — dangerouslySetInnerHTML을 쓰지 않는다.
//   본문은 Gemini 산출물(미신뢰 입력)이므로 HTML을 그대로 주입하면 저장형 XSS 표면이 된다.
//   lib/seo/article.ts parseArticleBody가 허용 타입 밖을 이미 버리고, 여기서는 텍스트로만 출력한다.
// ★ 사진이 여러 장 연속이면 **그리드 갤러리**로 묶어 보여준다(lib/seo/gallery.ts) — 사진첩처럼
//   세로로 길게 쌓이지 않고 4·2·1장 대칭으로 보기 좋게(테오 지적 2026-07-24).
import Image from "next/image";
import type { ArticleBlock } from "@/lib/seo/article";
import { galleryRows, groupBlocksForRender } from "@/lib/seo/gallery";

type ImgBlock = Extract<ArticleBlock, { type: "img" }>;

/**
 * 연속 이미지 묶음을 행(row) 단위 그리드로 — **사진을 크게**(테오 지적 2026-07-24).
 *   · 히어로 행(1장): 전폭 대형(가로가 넓은 3:2)으로 크게.
 *   · 2장 행: 큰 4:3 두 칸.
 * 캡션은 그리드에선 생략(가게명 반복이라 소음).
 */
function Gallery({ images }: { images: ImgBlock[] }) {
  const rows = galleryRows(images.length);
  let idx = 0;
  return (
    <div className="my-6 space-y-2">
      {rows.map((size, r) => {
        const slice = images.slice(idx, idx + size);
        idx += size;
        const hero = size === 1;
        return (
          <div key={r} className={`grid gap-2 ${hero ? "grid-cols-1" : "grid-cols-2"}`}>
            {slice.map((im, k) => (
              <div
                key={k}
                className={`relative ${hero ? "aspect-[3/2]" : "aspect-[4/3]"} overflow-hidden rounded-xl bg-slate-100`}
              >
                <Image
                  src={im.url}
                  alt={im.alt}
                  fill
                  sizes={hero ? "(max-width: 640px) 100vw, 640px" : "(max-width: 640px) 50vw, 320px"}
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function SingleImage({ b }: { b: ImgBlock }) {
  // alt는 파싱 단계에서 필수 보장 — 빈 alt 이미지는 블록째로 버려진다.
  // 이미지 검색 유입과 접근성이 alt에 달려 있으므로 장식용 빈 alt를 허용하지 않는다.
  return (
    <figure className="my-6">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-100">
        <Image src={b.url} alt={b.alt} fill sizes="(max-width: 640px) 100vw, 640px" className="object-cover" />
      </div>
      {b.caption && <figcaption className="mt-2 text-center text-xs text-slate-500">{b.caption}</figcaption>}
    </figure>
  );
}

function Block({ b }: { b: ArticleBlock }) {
  if (b.type === "img") return <SingleImage b={b} />;
  if (b.type === "video") {
    // youtube-nocookie = 재생 전 추적 쿠키 없음. lazy = 첫 화면 성능(랭킹 요소) 보호.
    return (
      <figure className="my-6">
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
    return <h2 className="pt-2 text-xl font-bold text-slate-900">{b.text}</h2>;
  }
  if (b.type === "ul") {
    return (
      <ul className="list-disc space-y-1.5 pl-5 text-slate-700">
        {b.items.map((it, j) => (
          <li key={j} className="leading-relaxed">
            {it}
          </li>
        ))}
      </ul>
    );
  }
  return <p className="leading-relaxed text-slate-700">{b.text}</p>;
}

export default function ArticleBody({ blocks }: { blocks: ArticleBlock[] }) {
  const items = groupBlocksForRender(blocks);
  return (
    <div className="space-y-5">
      {items.map((it, i) =>
        it.kind === "gallery" ? <Gallery key={i} images={it.images} /> : <Block key={i} b={it.block} />
      )}
    </div>
  );
}
