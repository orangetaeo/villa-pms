// components/seo/public-home.tsx — villa-go.net 공개 홈 (T-seo-s1)
//
// 검색엔진이 처음 만나는 페이지이자 Google Ads 랜딩. 라이트 · teal #0D9488 · 웜샌드 #F59E0B · 사진 중심.
//
// ★ 절대 금지 (계약 T-seo-s1 §4.1):
//   가격·1박 요금·시작가·통화 표기 / 날짜별 공실·"예약 가능" / 상세주소 / 공급자 정보.
//
// ★ 5개 언어(ko·en·vi·ru·zh): UI 문구는 lib/seo/public-i18n.ts 사전으로 전환한다(테오 2026-07-24).
//   블로그·빌라 콘텐츠 자체는 한국어 SEO 자산이라 번역하지 않는다.
// ★ 히어로는 롤링 캐러셀 — 슬라이드0=브랜드 히어로, 이후=빌라 블로그(제목·요약 오버레이·클릭 이동).
import Link from "next/link";
import Image from "next/image";
import {
  type PublicVilla,
  localizedVillaLabel,
  getVillaDescriptionsLocalized,
} from "@/lib/seo/public-villa";
import { blogPaths } from "@/lib/seo/routes";
import { FEATURE_ITEMS } from "@/lib/features";
import { VillaGoHeaderLogo } from "@/components/brand/villa-go-header-logo";
import HeroCarousel, { type HeroPost } from "@/components/seo/hero-blog-carousel";
import PublicLangSwitcher from "@/components/seo/public-lang-switcher";
import { homeStrings, type PublicLocale } from "@/lib/seo/public-i18n";
import { featureLabels } from "@/lib/seo/villa-i18n";

/** 상담 진입점 — 웹챗(/chat)으로 통일하고 유입 출처를 seo로 표기(인박스에서 구분). */
const CONSULT_HREF = "/chat?src=seo";

/** 홈에 노출할 대표 조건(패싯) — 라벨은 로케일별 사전(featureLabels), 링크는 /blog/feature/[key]. */
const HOME_FEATURES: { key: string; icon: string }[] = [
  { key: "privatePool", icon: "pool" },
  { key: "viewSea", icon: "waves" },
  { key: "beachFront", icon: "beach_access" },
  { key: "bbq", icon: "outdoor_grill" },
  { key: "golfNearby", icon: "golf_course" },
  { key: "kidsPool", icon: "pool" },
];

// 사전에 실제로 존재하는 키만 남긴다(사전 변경 시 링크가 조용히 404가 되는 것을 방지).
const VALID_KEYS = new Set(Object.values(FEATURE_ITEMS).flat().map((f) => f.featureKey));

export interface PublicHomeProps {
  /** 공개 대상 빌라(관문 통과분). 비어 있으면 빌라 섹션 자체가 렌더되지 않는다. */
  villas: PublicVilla[];
  /** 지역 카드 — 공개 빌라가 있는 지역만 상위에서 집계해 전달한다. */
  areas: { code: string; label: string; count: number }[];
  /** 히어로 롤링용 빌라 블로그(최신순). 비어 있으면 히어로 한 장만. */
  villaPosts: HeroPost[];
  /** 공개 홈 로케일(pub-locale 쿠키 → 기본 ko). */
  locale: PublicLocale;
}

// 히어로 배경으로 어울리는 공간 우선순위. 화장실(BATHROOM)·주방(KITCHEN)·ETC는
//   대표 사진으로 부적합하므로 아예 후보에서 뺀다(전 빌라에 걸맞은 것이 없으면 null → 단색 폴백).
const HERO_SPACE_PRIORITY = ["POOL", "EXTERIOR", "LIVING", "BALCONY", "BEDROOM"] as const;

function pickHeroPhoto(villas: PublicVilla[]): string | undefined {
  const candidates = villas.slice(0, 3).flatMap((v) => v.photos);
  for (const space of HERO_SPACE_PRIORITY) {
    const hit = candidates.find((p) => p.space === space);
    if (hit) return hit.url;
  }
  return undefined; // 적합한 공간이 하나도 없으면 배경 없이 단색으로 둔다
}

export default async function PublicHome({ villas, areas, villaPosts, locale }: PublicHomeProps) {
  const t = homeStrings(locale);
  const feat = featureLabels(locale);
  const featured = villas.slice(0, 3);
  const heroPhoto = pickHeroPhoto(villas) ?? null;
  // 추천 카드 티저 — ko는 캐논 description, 비-ko는 READY 번역만(없으면 생략, ADR §E). 3장뿐이라 저렴.
  const featuredDesc =
    locale === "ko" ? null : await getVillaDescriptionsLocalized(featured.map((v) => v.id), locale);
  const teaser = (v: PublicVilla): string | null =>
    locale === "ko" ? (v.description ?? null) : (featuredDesc?.get(v.id) ?? null);
  // ★ 매칭 빌라가 1곳이라도 있는 조건만 노출한다 — 없는 조건 칩을 누르면 404다.
  const features = HOME_FEATURES.filter(
    (f) => VALID_KEYS.has(f.key) && villas.some((v) => v.featureKeys.includes(f.key))
  );

  return (
    <div lang={locale} className="min-h-screen bg-white text-slate-900">
      {/* 헤더 — 로고 + 언어전환(5개) + 블로그·로그인·상담 */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
        <VillaGoHeaderLogo />
        <div className="flex items-center gap-0.5">
          <PublicLangSwitcher current={locale} />
          <Link
            href={blogPaths.hub(locale)}
            className="rounded-full px-2 py-1.5 text-sm font-semibold text-slate-600 hover:text-teal-700"
          >
            {t.navBlog}
          </Link>
          <Link
            href="/login"
            className="rounded-full px-2 py-1.5 text-sm font-semibold text-slate-600 hover:text-teal-700"
          >
            {t.navLogin}
          </Link>
          <Link
            href={CONSULT_HREF}
            className="rounded-full border border-teal-600 px-2.5 py-1.5 text-sm font-semibold text-teal-700"
          >
            {t.navConsult}
          </Link>
        </div>
      </header>

      {/* 본문 랜드마크 — 스크린리더 내비게이션 + Best Practices(main landmark). 헤더/푸터/고정CTA는 밖. */}
      <main>
      {/* 히어로 롤링 — 슬라이드0=브랜드 히어로, 이후=빌라 블로그(제목·요약 오버레이) */}
      <HeroCarousel
        heroImageUrl={heroPhoto}
        posts={villaPosts}
        labels={{
          eyebrow: t.heroEyebrow,
          title: t.heroTitle,
          subtitle: t.heroSubtitle,
          cta: t.heroCta,
          consultHref: CONSULT_HREF,
          readMore: t.readMore,
        }}
      />

      {/* 지역으로 찾기 — 공개 빌라가 있는 지역만 */}
      {areas.length > 0 && (
        <section className="px-5 py-8">
          <h2 className="text-xl font-bold">{t.areasTitle}</h2>
          <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
            {areas.map((a) => (
              <Link
                key={a.code}
                href={blogPaths.area(a.code, locale)}
                className="shrink-0 rounded-xl border border-slate-200 px-4 py-3"
              >
                <span className="block font-semibold">{a.label}</span>
                <span className="mt-1 block rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                  {t.villaCount(a.count)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 조건으로 찾기 — 빌라가 있을 때만(빈 결과 페이지로 보내지 않는다) */}
      {villas.length > 0 && features.length > 0 && (
        <section className="px-5 py-8">
          <h2 className="text-xl font-bold">{t.featuresTitle}</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {features.map((f) => (
              <Link
                key={f.key}
                href={blogPaths.feature(f.key, locale)}
                className="flex touch-target items-center gap-2 rounded-xl border border-slate-200 px-4"
              >
                <span className="material-symbols-outlined text-teal-600" aria-hidden>
                  {f.icon}
                </span>
                <span className="text-sm font-semibold">{feat[f.key] ?? f.key}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 추천 빌라 — ★ 가격·공실 표기 없음. CTA는 견적 문의 */}
      {featured.length > 0 && (
        <section className="px-5 py-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-bold">{t.featuredTitle}</h2>
            <Link
              href={blogPaths.villas(locale)}
              className="inline-flex min-h-6 items-center py-1 text-sm font-semibold text-teal-700"
            >
              {t.viewAll}
            </Link>
          </div>
          <div className="mt-4 space-y-5">
            {featured.map((v) => {
              const label = localizedVillaLabel(v, locale);
              const desc = teaser(v);
              return (
              <article key={v.id} className="overflow-hidden rounded-2xl border border-slate-200">
                {v.photos[0] && (
                  <div className="relative aspect-[16/9] bg-slate-100">
                    <Image
                      src={v.photos[0].url}
                      alt={label}
                      fill
                      sizes="(max-width: 640px) 100vw, 640px"
                      className="object-cover"
                    />
                  </div>
                )}
                <div className="p-4">
                  <h3 className="text-lg font-bold">
                    <Link href={blogPaths.villa(v.slug, locale)}>{label}</Link>
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                      {t.bedrooms(v.bedrooms)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                      {t.maxGuests(v.maxGuests)}
                    </span>
                    {v.hasPool && (
                      <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700">
                        {t.pool}
                      </span>
                    )}
                    {v.breakfastAvailable && (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                        {t.breakfast}
                      </span>
                    )}
                  </div>
                  {desc && (
                    <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600">{desc}</p>
                  )}
                  <Link
                    href={CONSULT_HREF}
                    className="mt-3 inline-block text-sm font-semibold text-teal-700"
                  >
                    {t.inquiry}
                  </Link>
                </div>
              </article>
              );
            })}
          </div>
        </section>
      )}

      {/* 서비스 소개 — 빌라가 아직 없어도 페이지가 성립하게 하는 본문. */}
      <section className="bg-slate-50 px-5 py-10">
        <h2 className="text-xl font-bold">{t.whyTitle}</h2>
        <dl className="mt-5 space-y-5">
          <div>
            <dt className="font-semibold text-teal-700">{t.why1t}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-slate-600">{t.why1d}</dd>
          </div>
          <div>
            <dt className="font-semibold text-teal-700">{t.why2t}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-slate-600">{t.why2d}</dd>
          </div>
          <div>
            <dt className="font-semibold text-teal-700">{t.why3t}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-slate-600">{t.why3d}</dd>
          </div>
        </dl>
        <Link
          href={CONSULT_HREF}
          className="mt-6 inline-flex touch-target items-center rounded-full bg-teal-600 px-6 text-base font-bold text-white"
        >
          {t.whyCta}
        </Link>
      </section>

      {/* 빌라 이야기·여행 가이드(블로그) 진입 */}
      <section className="px-5 py-8">
        <div className="rounded-2xl border border-slate-200 bg-teal-50/40 p-5">
          <h2 className="text-xl font-bold">{t.blogTitle}</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{t.blogDesc}</p>
          <Link
            href={blogPaths.hub(locale)}
            className="mt-4 inline-flex touch-target items-center rounded-full bg-teal-600 px-6 text-base font-bold text-white"
          >
            {t.blogCta}
          </Link>
        </div>
      </section>

      {/* 파트너·공급자 모집 — 기존 정적 소개 자산 재사용(색인 허용 경로) */}
      <section className="px-5 py-8">
        <h2 className="text-lg font-bold">{t.partnerTitle}</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li>
            <a href="/intro-partner.html" className="font-medium text-teal-700">
              {t.partnerLink1}
            </a>
          </li>
          <li>
            <a href="/intro.html" className="font-medium text-teal-700">
              {t.partnerLink2}
            </a>
          </li>
          <li>
            <a href="/intro-vendor.html" className="font-medium text-teal-700">
              {t.partnerLink3}
            </a>
          </li>
        </ul>
      </section>

      </main>

      {/* 푸터 — Google Ads 랜딩 요건: 사업자 정보·연락 수단·개인정보처리방침 */}
      <footer className="border-t border-slate-100 px-5 py-8 text-sm text-slate-500">
        <p className="font-semibold text-slate-700">Villa GO</p>
        <p className="mt-1">{t.footerTagline}</p>
        <p className="mt-2">
          {t.footerContact}{" "}
          <a href="mailto:biz.villago@gmail.com" className="text-teal-700">
            biz.villago@gmail.com
          </a>
        </p>
        <p className="mt-3">
          <Link href="/privacy" className="underline">
            {t.privacy}
          </Link>
        </p>
      </footer>

      {/* 고정 하단 CTA */}
      <div className="pb-safe sticky bottom-0 z-20 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
        <Link
          href={CONSULT_HREF}
          className="flex touch-target w-full items-center justify-center rounded-xl bg-teal-600 text-base font-bold text-white"
        >
          {t.stickyCta}
        </Link>
      </div>
    </div>
  );
}
