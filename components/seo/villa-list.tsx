// components/seo/villa-list.tsx — 공개 빌라 목록 (T-seo-s2 · ADR-0050 로케일화)
//
// 목록·패싯 페이지가 공유하는 렌더 조각.
// ★ 가격·공실 표기 0 — 카드 CTA는 상담뿐이다(공개 판매가 = 마진 역산).
// ★ 로케일(기본 ko): 표시명=localizedVillaLabel, 칩·문구=villa-i18n, 링크=blogPaths.villa(slug, locale).
//   비-ko 티저는 VillaTranslation READY만(getVillaDescriptionsLocalized). 없으면 티저를 생략한다
//   (ADR §3 — 한국어 문단을 비-ko 페이지로 내보내지 않는다).
import Link from "next/link";
import Image from "next/image";
import {
  type PublicVilla,
  localizedVillaLabel,
  getVillaDescriptionsLocalized,
} from "@/lib/seo/public-villa";
import { blogPaths } from "@/lib/seo/routes";
import { type PublicLocale } from "@/lib/seo/public-i18n";
import { villaStrings } from "@/lib/seo/villa-i18n";

export default async function VillaList({
  villas,
  locale = "ko",
}: {
  villas: PublicVilla[];
  locale?: PublicLocale;
}) {
  const t = villaStrings(locale);

  if (villas.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm leading-relaxed text-slate-600">
        {t.listEmpty}{" "}
        <Link href="/chat?src=seo" className="font-semibold text-teal-700">
          {t.listEmptyCta}
        </Link>
        .
      </p>
    );
  }

  // 티저(소개문 2줄) — ko는 캐논 description, 비-ko는 READY 번역만. 없으면 티저 생략.
  const descMap =
    locale === "ko" ? null : await getVillaDescriptionsLocalized(villas.map((v) => v.id), locale);
  const teaser = (v: PublicVilla): string | null => {
    if (locale === "ko") return v.description ?? null;
    return descMap?.get(v.id) ?? null;
  };

  return (
    <ul className="space-y-5">
      {villas.map((v) => {
        const label = localizedVillaLabel(v, locale);
        const where =
          locale === "ko"
            ? (v.areaNameKo ?? v.areaName ?? v.complex ?? "")
            : (v.areaName ?? v.complex ?? "");
        const desc = teaser(v);
        return (
          <li key={v.id}>
            <article className="overflow-hidden rounded-2xl border border-slate-200">
              {v.photos[0] && (
                <Link href={blogPaths.villa(v.slug, locale)} className="relative block aspect-[16/9] bg-slate-100">
                  <Image
                    src={v.photos[0].url}
                    alt={`${label} ${t.exteriorAlt}`.trim()}
                    fill
                    sizes="(max-width: 640px) 100vw, 640px"
                    className="object-cover"
                  />
                </Link>
              )}
              <div className="p-4">
                {where && <p className="text-xs font-semibold text-amber-600">{where}</p>}
                <h3 className="mt-0.5 text-lg font-bold">
                  <Link href={blogPaths.villa(v.slug, locale)}>{label}</Link>
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                    {t.bedroomsChip(v.bedrooms)}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                    {t.maxGuestsChip(v.maxGuests)}
                  </span>
                  {v.hasPool && (
                    <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700">
                      {t.chipPool}
                    </span>
                  )}
                  {v.breakfastAvailable && (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                      {t.chipBreakfast}
                    </span>
                  )}
                  {v.beachDistanceM != null && v.beachDistanceM <= 500 && (
                    <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                      {t.beachChip(v.beachDistanceM)}
                    </span>
                  )}
                </div>
                {desc && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600">{desc}</p>}
                <Link
                  href={blogPaths.villa(v.slug, locale)}
                  className="mt-3 inline-block text-sm font-semibold text-teal-700"
                >
                  {t.readMore}
                </Link>
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
