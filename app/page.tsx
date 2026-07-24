import { auth } from "@/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { isOperator } from "@/lib/permissions";
import PublicHome from "@/components/seo/public-home";
import { getPublicVillas } from "@/lib/seo/public-villa";
import { getPublishedArticlesByCategory } from "@/lib/seo/article";
import { areaFacets } from "@/lib/seo/facets";
import { absoluteUrl } from "@/lib/seo/base-url";
import { getPublicLocale } from "@/lib/seo/public-locale";

// 루트: 세션 role별 홈으로 분기 / 비로그인은 **공개 홈**(T-seo-s1)
// [S-RBAC] 운영자(OWNER/MANAGER/STAFF/ADMIN)는 /dashboard. CLEANER=/cleaning, SUPPLIER=/my-villas.
// (구버전은 ADMIN만 /dashboard라 OWNER/MANAGER/STAFF가 /my-villas로 떨어져 무한 리다이렉트 루프 발생)
//
// ★ 공개 홈 도입 전에는 비로그인 방문자를 전부 /logout으로 보냈다. 그래서 villa-go.net 루트가
//   검색엔진에게 "리다이렉트만 하는 페이지"였고, 어느 콘솔에 등록해도 첫 페이지에서 튕겼다.
//   이제 순수 비로그인 방문자는 공개 홈을 200으로 받는다.
// ★ 단, **stale 세션 쿠키가 남아있는 경우는 기존대로 /logout**으로 보낸다.
//   무효 세션(비번 변경 등)은 RSC에서 응답 쿠키를 쓸 수 없어 /logout 라우트 핸들러가 유일한 출구다.
//   이 분기를 빼면 /login ↔ 보호경로 무한 리다이렉트 루프가 되살아난다(app/logout/route.ts 주석 참조).

// Auth.js v5 세션 쿠키 이름(청크 변형 포함) — app/logout/route.ts와 동일 목록을 유지할 것.
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.session-token.0",
  "authjs.session-token.1",
  "__Secure-authjs.session-token.0",
  "__Secure-authjs.session-token.1",
];

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "푸꾸옥 풀빌라 — 조건으로 찾는 현지 빌라 | Villa GO",
    description:
      "인원·시설 조건으로 고르는 푸꾸옥 풀빌라. 현지에서 직접 운영·검수한 빌라만 안내합니다. 견적은 상담으로 안내드립니다.",
    alternates: { canonical: absoluteUrl("/") },
    openGraph: {
      type: "website",
      siteName: "Villa GO",
      title: "푸꾸옥 풀빌라 — 조건으로 찾는 현지 빌라",
      description: "인원·시설로 고르는 푸꾸옥 현지 빌라. 현지 운영·검수.",
      url: absoluteUrl("/"),
      locale: "ko_KR",
    },
  };
}

export default async function Home() {
  const session = await auth();

  // ★ session이 truthy여도 user가 없을 수 있다 — auth()가 내부 오류(UntrustedHost 등)로
  //   빈 객체를 반환하는 경로가 실재한다(로컬 실측에서 `session.user.role` 500 재현).
  //   role이 실제로 있을 때만 역할 분기하고, 그 외는 비로그인 경로로 흘려보낸다.
  const role = session?.user?.role;
  if (role) {
    if (isOperator(role)) redirect("/dashboard");
    if (role === "CLEANER") redirect("/cleaning");
    if (role === "VENDOR") redirect("/vendor");
    if (role === "PARTNER") redirect("/partner"); // 여행사·랜드사 포털 (ADR-0028)
    redirect("/my-villas"); // SUPPLIER
  }

  // 세션은 없는데 쿠키가 남아있다 = 무효화된 stale 세션 → 쿠키를 지우는 단일 출구로.
  const jar = await cookies();
  if (SESSION_COOKIE_NAMES.some((n) => jar.get(n))) redirect("/logout");

  // 순수 비로그인 방문자 = 공개 홈(검색·광고 랜딩)
  //   DB 장애가 홈 자체를 500으로 만들면 안 된다 — 빌라 섹션만 비우고 페이지는 살린다.
  let villas: Awaited<ReturnType<typeof getPublicVillas>> = [];
  try {
    villas = await getPublicVillas();
  } catch {
    villas = [];
  }
  const areas = areaFacets(villas).map((f) => {
    const v = villas.find((x) => x.areaCode === f.params.area);
    return {
      code: f.params.area!,
      // 한국어 병기(nameKo)가 있으면 그것을, 없으면 라틴 정본명(표시 전용).
      label: v?.areaNameKo ?? v?.areaName ?? f.params.area!,
      count: f.count,
    };
  });

  // 히어로 롤링용 — "우선은 빌라의 블로그"(테오 2026-07-24): category=villa 발행 글.
  //   ★ 이미지는 텍스트 없는 원본 커버(coverPhotoUrl) 우선 — 슬라이드에서 제목·요약을 직접 오버레이하므로
  //     글자 구운 썸네일을 쓰면 텍스트가 이중으로 겹친다. 이미지 없는 글은 제외(빈 슬라이드 방지).
  let villaPosts: { slug: string; title: string; summary: string; imageUrl: string }[] = [];
  try {
    const { articles } = await getPublishedArticlesByCategory("villa", 1, 10);
    villaPosts = articles
      .map((a) => ({
        slug: a.slug,
        title: a.title,
        summary: a.summary,
        imageUrl: a.coverPhotoUrl ?? a.thumbnailUrl ?? "",
      }))
      .filter((p) => p.imageUrl);
  } catch {
    villaPosts = [];
  }

  const locale = await getPublicLocale();

  return <PublicHome villas={villas} areas={areas} villaPosts={villaPosts} locale={locale} />;
}
