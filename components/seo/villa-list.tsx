// components/seo/villa-list.tsx — 공개 빌라 목록 (T-seo-s2)
//
// 목록·패싯 페이지가 공유하는 렌더 조각.
// ★ 가격·공실 표기 0 — 카드 CTA는 상담뿐이다(공개 판매가 = 마진 역산).
import Link from "next/link";
import Image from "next/image";
import type { PublicVilla } from "@/lib/seo/public-villa";
import { blogPaths } from "@/lib/seo/routes";

export default function VillaList({ villas }: { villas: PublicVilla[] }) {
  if (villas.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm leading-relaxed text-slate-600">
        조건에 맞는 빌라를 준비 중입니다.{" "}
        <Link href="/chat?src=seo" className="font-semibold text-teal-700">
          원하는 조건을 알려주시면 찾아드릴게요
        </Link>
        .
      </p>
    );
  }

  return (
    <ul className="space-y-5">
      {villas.map((v) => {
        const where = v.areaNameKo ?? v.areaName ?? v.complex ?? "푸꾸옥";
        return (
          <li key={v.id}>
            <article className="overflow-hidden rounded-2xl border border-slate-200">
              {v.photos[0] && (
                <Link href={blogPaths.villa(v.slug)} className="relative block aspect-[16/9] bg-slate-100">
                  <Image
                    src={v.photos[0].url}
                    alt={`${where} ${v.name} 외관`}
                    fill
                    sizes="(max-width: 640px) 100vw, 640px"
                    className="object-cover"
                  />
                </Link>
              )}
              <div className="p-4">
                <p className="text-xs font-semibold text-amber-600">{where}</p>
                <h3 className="mt-0.5 text-lg font-bold">
                  <Link href={blogPaths.villa(v.slug)}>{v.name}</Link>
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                    침실 {v.bedrooms}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                    최대 {v.maxGuests}인
                  </span>
                  {v.hasPool && (
                    <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700">
                      수영장
                    </span>
                  )}
                  {v.breakfastAvailable && (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                      조식
                    </span>
                  )}
                  {v.beachDistanceM != null && v.beachDistanceM <= 500 && (
                    <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                      해변 {v.beachDistanceM}m
                    </span>
                  )}
                </div>
                {v.description && (
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600">{v.description}</p>
                )}
                <Link
                  href={blogPaths.villa(v.slug)}
                  className="mt-3 inline-block text-sm font-semibold text-teal-700"
                >
                  자세히 보기 →
                </Link>
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
