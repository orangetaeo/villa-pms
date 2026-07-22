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

/**
 * ★ 주요 검색봇은 **이름을 명시한 그룹**으로 따로 낸다 (실측 2026-07-22).
 *
 *   Cloudflare가 관리형 robots 블록(AI 크롤러 제어 + Content-Signal)을 **우리 robots.txt 위에
 *   주입**한다. 그 결과 `User-agent: *` 그룹이 두 개가 되는데, 첫 번째(Cloudflare)는
 *   `Allow: /` 뿐이고 Disallow가 없다. 크롤러가 그룹을 병합하지 않고 **첫 매칭 그룹만** 적용하면
 *   우리 차단 규칙이 통째로 무시되어 `/p/`(제안 토큰)·`/card/`(개인 연락처)·관리자 경로가
 *   크롤 대상이 된다.
 *
 *   robots.txt 규격상 크롤러는 **자기 이름과 정확히 일치하는 그룹을 `*`보다 우선**한다.
 *   따라서 Yeti(네이버)·Googlebot·bingbot·Daum에 같은 규칙을 이름으로 한 번 더 주면,
 *   Cloudflare 블록이 앞에 있어도 우리 규칙이 확실히 적용된다.
 */
const NAMED_BOTS = ["Yeti", "Googlebot", "Googlebot-Image", "bingbot", "Daum", "Daumoa"] as const;

export default function robots(): MetadataRoute.Robots {
  const allow = [...PUBLIC_ALLOW_PATHS];
  const disallow = [...PUBLIC_DISALLOW_PATHS];
  return {
    rules: [
      ...NAMED_BOTS.map((userAgent) => ({ userAgent, allow, disallow })),
      { userAgent: "*", allow, disallow },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    // Host 지시자는 스킴·경로 없는 호스트명이어야 한다(예: villa-go.net).
    host: new URL(seoBaseUrl()).host,
  };
}
