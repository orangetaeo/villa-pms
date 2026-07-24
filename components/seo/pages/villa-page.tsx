// components/seo/pages/villa-page.tsx — 공개 빌라 상세 본체 (ko/en/vi/ru/zh 공용, ADR-0050)
//
// ★ app/blog/villa/[slug]/page.tsx(ko)·app/[locale]/blog/villa/[slug]/page.tsx(비-ko)가 공용 호출.
// ★ 절대 넣지 않는 것(T-seo-s1 §4.1): 가격·1박요금·시작가 / 날짜별 공실·"예약 가능" / 상세주소·지도 링크 /
//   공급자 정보 / wifi·출입정보. 데이터는 lib/seo/public-villa.ts 관문이 이미 걸러낸다.
// ★ 비-ko는 **404가 아니라 항상 200**(빌라 자체가 없을 때만 404) — 라벨·스펙·칩·규칙·사진은 사전/숫자로
//   즉시 로케일화되고, description만 한 섹션이다. READY 번역이 없으면 **소개 섹션·티저를 통째로 생략**한다
//   (ko 문단을 비-ko URL로 내보내지 않는다, ADR §3). ko 폴백 텍스트 금지.
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BlogHeader } from "@/components/seo/pages/blog-header";
import {
  getPublicVillaBySlug,
  getPublicVillaApproxMapEmbed,
  getVillaDescriptionsLocalized,
  localizedVillaLabel,
} from "@/lib/seo/public-villa";
import { blogPaths } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";
import { FEATURE_ITEMS } from "@/lib/features";
import { allLocaleAlternates, BCP47, OG_LOCALE } from "@/lib/seo/article-i18n";
import { PUBLIC_LOCALES, type PublicLocale } from "@/lib/seo/public-i18n";
import { blogStrings } from "@/lib/seo/blog-i18n";
import { villaStrings, featureLabels, spaceLabel } from "@/lib/seo/villa-i18n";

const VALID_FEATURES = new Set(Object.values(FEATURE_ITEMS).flat().map((f) => f.featureKey));

/** 분(0~1439) → "14:00" */
function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 로케일별 소개문(READY만) — ko는 캐논 description, 비-ko는 VillaTranslation READY. 없으면 null. */
async function localizedDescription(villaId: string, locale: PublicLocale): Promise<string | null> {
  const map = await getVillaDescriptionsLocalized([villaId], locale);
  return map.get(villaId) ?? null;
}

export async function villaMetadata(slug: string, locale: PublicLocale): Promise<Metadata> {
  const t = villaStrings(locale);
  const v = await getPublicVillaBySlug(slug).catch(() => null);
  if (!v) return { title: t.villaNotFound, robots: { index: false } };
  const label = localizedVillaLabel(v, locale);
  const desc = await localizedDescription(v.id, locale).catch(() => null);
  const title = t.villaMetaTitle(label, v.maxGuests);
  const description = (desc ?? "").slice(0, 150) || t.villaMetaDescFallback(label, v.bedrooms, v.maxGuests);
  const url = absoluteUrl(blogPaths.villa(v.slug, locale));
  return {
    title,
    description,
    alternates: { canonical: url, ...allLocaleAlternates((l) => blogPaths.villa(v.slug, l)) },
    openGraph: {
      type: "article",
      siteName: "Villa GO",
      title,
      description,
      url,
      locale: OG_LOCALE[locale],
      ...(v.photos[0] ? { images: [{ url: v.photos[0].url }] } : {}),
    },
  };
}

export async function VillaPage({ slug, locale }: { slug: string; locale: PublicLocale }) {
  const t = villaStrings(locale);
  const chrome = blogStrings(locale);
  const feat = featureLabels(locale);
  const v = await getPublicVillaBySlug(slug).catch(() => null);
  if (!v) notFound();

  const label = localizedVillaLabel(v, locale);
  const where =
    locale === "ko"
      ? (v.areaNameKo ?? v.areaName ?? v.complex ?? chrome.phuQuoc)
      : (v.areaName ?? v.complex ?? chrome.phuQuoc);
  const features = v.featureKeys.filter((k) => VALID_FEATURES.has(k));

  const [description, villaMapEmbed] = await Promise.all([
    localizedDescription(v.id, locale).catch(() => null),
    getPublicVillaApproxMapEmbed(v.id).catch(() => null),
  ]);

  // 언어 스위처 — 같은 빌라의 각 로케일 URL(전 로케일 200).
  const langLinks: Partial<Record<PublicLocale, string>> = Object.fromEntries(
    PUBLIC_LOCALES.map((l) => [l.code, blogPaths.villa(v.slug, l.code)]),
  );

  // JSON-LD — LodgingBusiness. ★ priceRange·offers·availability 금지(공개 경계). 주소도 단지 수준까지만.
  //   inLanguage=BCP47[locale], description=READY 번역만(없으면 미포함).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    name: label,
    description: description ?? undefined,
    inLanguage: BCP47[locale],
    url: absoluteUrl(blogPaths.villa(v.slug, locale)),
    address: { "@type": "PostalAddress", addressLocality: where, addressCountry: "VN" },
    numberOfRooms: v.bedrooms,
    petsAllowed: v.petsAllowed,
    smokingAllowed: v.smokingAllowed,
    image: v.photos.slice(0, 6).map((p) => ({
      "@type": "ImageObject",
      contentUrl: p.url,
      creditText: "Villa GO",
      creator: { "@type": "Organization", name: "Villa GO" },
      copyrightNotice: "© Villa GO",
      acquireLicensePage: absoluteUrl("/chat?src=seo"),
    })),
    amenityFeature: [
      ...(v.hasPool ? [{ "@type": "LocationFeatureSpecification", name: t.chipPool, value: true }] : []),
      ...(v.breakfastAvailable
        ? [{ "@type": "LocationFeatureSpecification", name: t.chipBreakfast, value: true }]
        : []),
      ...features.map((k) => ({ "@type": "LocationFeatureSpecification", name: feat[k] ?? k, value: true })),
    ],
  };

  const videoLd = v.videos.map((vid) => ({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: vid.title,
    description: vid.description.slice(0, 500),
    thumbnailUrl: [`https://i.ytimg.com/vi/${vid.ytVideoId}/hqdefault.jpg`],
    uploadDate: (vid.publishedAt ?? new Date()).toISOString(),
    contentUrl: `https://www.youtube.com/watch?v=${vid.ytVideoId}`,
    embedUrl: `https://www.youtube.com/embed/${vid.ytVideoId}`,
    publisher: { "@type": "Organization", name: "Villa GO" },
  }));

  const specs: { label: string; value: string }[] = [
    { label: t.specBedrooms, value: t.countRooms(v.bedrooms) },
    { label: t.specBathrooms, value: t.countRooms(v.bathrooms) },
    { label: t.specMaxGuests, value: t.guestsValue(v.maxGuests) },
    ...(v.areaSqm ? [{ label: t.specArea, value: t.areaValue(v.areaSqm) }] : []),
    ...(v.floors ? [{ label: t.specFloors, value: t.floorsValue(v.floors) }] : []),
    ...(v.beachDistanceM != null ? [{ label: t.specBeach, value: t.beachValue(v.beachDistanceM) }] : []),
    ...(v.parkingSlots > 0 ? [{ label: t.specParking, value: t.parkingValue(v.parkingSlots) }] : []),
    { label: t.specCheckInOut, value: `${hhmm(v.checkInTime)} / ${hhmm(v.checkOutTime)}` },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      {videoLd.map((ld, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }}
        />
      ))}

      <BlogHeader locale={locale} links={langLinks} consultLabel={chrome.consult} />

      <article className="px-5 py-6">
        <p className="text-sm font-semibold text-amber-600">{where}</p>
        <h1 className="mt-1 text-2xl font-extrabold leading-snug">{label}</h1>

        {/* 사진 — alt에 지역·특징 표시명을 넣는다. 고유 실명은 넣지 않는다. */}
        {v.photos[0] && (
          <div className="relative mt-4 aspect-[16/9] overflow-hidden rounded-2xl bg-slate-100">
            <Image
              src={v.photos[0].url}
              alt={`${label} ${t.exteriorAlt}`.trim()}
              fill
              sizes="(max-width: 640px) 100vw, 640px"
              className="object-cover"
              priority
            />
          </div>
        )}

        <dl className="mt-5 grid grid-cols-2 gap-3">
          {specs.map((s) => (
            <div key={s.label} className="rounded-xl border border-slate-200 px-3 py-2">
              <dt className="text-xs text-slate-500">{s.label}</dt>
              <dd className="mt-0.5 font-semibold">{s.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {v.hasPool && (
            <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700">{t.chipPool}</span>
          )}
          {v.breakfastAvailable && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
              {t.chipBreakfast}
            </span>
          )}
          {v.extraBedAvailable && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              {t.chipExtraBed}
            </span>
          )}
          {features.map((k) => (
            <span key={k} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              {feat[k] ?? k}
            </span>
          ))}
        </div>

        {/* 소개 — READY 번역(또는 ko 캐논)이 있을 때만. 없으면 섹션 통째 생략(ko 폴백 금지). */}
        {description && (
          <section className="mt-6">
            <h2 className="text-lg font-bold">{t.introTitle}</h2>
            <p className="mt-2 whitespace-pre-line leading-relaxed text-slate-700">{description}</p>
          </section>
        )}

        {v.photos.length > 1 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold">{t.photosTitle}</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {v.photos.slice(1, 9).map((p) => (
                <div key={p.id} className="relative aspect-square overflow-hidden rounded-xl bg-slate-100">
                  <Image
                    src={p.url}
                    alt={`${label} ${spaceLabel(locale, p.space)}`.trim()}
                    fill
                    sizes="(max-width: 640px) 50vw, 320px"
                    className="object-cover"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {v.videos.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold">{t.videoTitle}</h2>
            <div className="mt-3 space-y-4">
              {v.videos.map((vid) => (
                <figure key={vid.ytVideoId}>
                  <div className="relative mx-auto aspect-[9/16] w-full max-w-xs overflow-hidden rounded-2xl bg-slate-100">
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${vid.ytVideoId}`}
                      title={vid.title}
                      loading="lazy"
                      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="absolute inset-0 h-full w-full"
                    />
                  </div>
                  <figcaption className="mt-2 text-center text-sm text-slate-600">{vid.title}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-lg font-bold">{t.rulesTitle}</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            <li>{t.ruleSmoking(v.smokingAllowed)}</li>
            <li>{t.rulePets(v.petsAllowed)}</li>
            <li>{t.ruleParty(v.partyAllowed)}</li>
          </ul>
        </section>

        {/* 위치(대략) — 정확 핀 대신 동네 수준만(원칙 1). 서버가 좌표를 뭉갠 임베드 URL만 넘긴다. */}
        {villaMapEmbed && (
          <section className="mt-8">
            <h2 className="text-lg font-bold">{chrome.location}</h2>
            <p className="mt-1 text-sm text-slate-500">{chrome.villaApproxNote}</p>
            <div className="relative mt-3 aspect-video w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
              <iframe
                src={villaMapEmbed}
                title={chrome.location}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="absolute inset-0 h-full w-full border-0"
              />
            </div>
          </section>
        )}

        {/* ★ 가격·공실 대신 상담 CTA */}
        <section className="mt-10 rounded-2xl bg-slate-50 p-5">
          <h2 className="text-lg font-bold">{t.villaCtaTitle}</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{t.villaCtaBody}</p>
          <Link
            href="/chat?src=seo"
            className="mt-4 inline-flex touch-target items-center rounded-full bg-teal-600 px-6 text-base font-bold text-white"
          >
            {chrome.ctaButton}
          </Link>
        </section>
      </article>

      <footer className="border-t border-slate-100 px-5 py-8 text-sm text-slate-500">
        <p>
          <Link href={blogPaths.hub(locale)} className="font-semibold text-teal-700">
            {chrome.backToGuide}
          </Link>
        </p>
        <p className="mt-3">
          <Link href="/privacy" className="underline">
            {chrome.privacy}
          </Link>
        </p>
      </footer>
    </div>
  );
}
