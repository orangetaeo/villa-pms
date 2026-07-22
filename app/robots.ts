// app/robots.ts — /robots.txt (T-seo-s1)
//
// 경로 목록은 lib/seo/routes.ts 단일 원천. 여기서 직접 문자열을 쓰지 않는다.
// ★ robots는 "크롤 억제"일 뿐 색인 차단 보장이 아니다 — 토큰 경로(/p·/g)·명함(/card)은
//   페이지 단에서 noindex 메타를 함께 걸어야 한다(이중 차단).
import type { MetadataRoute } from "next";
import { absoluteUrl, seoBaseUrl } from "@/lib/seo/base-url";
import { PUBLIC_ALLOW_PATHS, PUBLIC_DISALLOW_PATHS } from "@/lib/seo/routes";

// ★ force-dynamic 필수 — 기본(정적)이면 **빌드 타임 env**가 구워진다.
//   실측에서 Sitemap 링크가 http://localhost:3000 으로 박히는 사고가 실제로 발생했다.
//   robots.txt의 Sitemap 호스트가 틀리면 서치어드바이저 제출이 통째로 무효가 된다.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [...PUBLIC_ALLOW_PATHS],
        disallow: [...PUBLIC_DISALLOW_PATHS],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    // Host 지시자는 스킴·경로 없는 호스트명이어야 한다(예: villa-go.net).
    host: new URL(seoBaseUrl()).host,
  };
}
