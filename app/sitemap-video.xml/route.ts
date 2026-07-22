// app/sitemap-video.xml/route.ts — 구글 전용 비디오 사이트맵 (T-seo-media)
//
// ★ 왜 분리했나 (실측 2026-07-22):
//   네이버 서치어드바이저가 메인 sitemap.xml을 거부했다 —
//   "사이트맵/RSS 형식이 올바르지 않습니다. 오류 위치: 135행 14열" = `<video:title>` 지점.
//   네이버는 구글 **이미지 확장(image:)은 통과**시키지만 **비디오 확장(video:)은 규격에 없어** 실패한다.
//   → 메인 사이트맵은 최대 호환(비디오 없음)으로 두고, 비디오는 이 파일로 분리해
//     **구글 Search Console에만 수동 제출**한다.
//
// ★ robots.txt에는 이 파일을 넣지 않는다 — 네이버가 robots의 Sitemap: 줄을 자동으로 읽다가
//   같은 오류를 다시 만나면 안 된다. 구글 GSC에서 직접 제출하는 용도다.
import { absoluteUrl } from "@/lib/seo/base-url";
import { blogPaths } from "@/lib/seo/routes";
import { getPublicVillas } from "@/lib/seo/public-villa";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

/** XML 텍스트 이스케이프 — 영상 제목·설명에 &·< 가 들어와도 사이트맵이 깨지지 않게. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET() {
  let entries = "";

  try {
    const villas = await getPublicVillas();
    for (const v of villas) {
      if (v.videos.length === 0) continue;
      const loc = absoluteUrl(blogPaths.villa(v.slug));
      const videos = v.videos
        .map((vid) => {
          // description은 유튜브 원문이라 줄바꿈·이모지가 섞여 있다. 200자로 자르고 이스케이프.
          const desc = vid.description.replace(/\s+/g, " ").trim().slice(0, 200) || vid.title;
          return `    <video:video>
      <video:thumbnail_loc>https://i.ytimg.com/vi/${esc(vid.ytVideoId)}/hqdefault.jpg</video:thumbnail_loc>
      <video:title>${esc(vid.title)}</video:title>
      <video:description>${esc(desc)}</video:description>
      <video:player_loc>https://www.youtube.com/embed/${esc(vid.ytVideoId)}</video:player_loc>
      <video:publication_date>${(vid.publishedAt ?? v.updatedAt).toISOString()}</video:publication_date>
    </video:video>`;
        })
        .join("\n");
      entries += `  <url>
    <loc>${esc(loc)}</loc>
${videos}
  </url>\n`;
    }
  } catch {
    // DB 장애 시에도 유효한 빈 사이트맵을 반환한다(500 반복 = 제출 무효화).
    entries = "";
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${entries}</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
