// app/blog/villa/[slug]/page.tsx — 공개 빌라 상세 (T-seo-s2)
//
// ★ 이 페이지에 절대 넣지 않는 것 (T-seo-s1 §4.1):
//   가격·1박 요금·시작가 / 날짜별 공실·"예약 가능" / 상세주소·지도 링크 / 공급자 정보 /
//   wifi·출입정보. 데이터는 lib/seo/public-villa.ts 관문이 이미 걸러내며, 이 파일은
//   그 DTO 밖의 값을 알지 못한다(관문을 우회하는 조회를 여기서 만들지 말 것).
// ★ 가격을 못 쓰는 대신 CTA는 "1분 견적 상담"으로 통일한다 — 공개 판매가 = 마진 역산이기 때문.
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublicVillaBySlug } from "@/lib/seo/public-villa";
import { blogPaths, BLOG_ROOT } from "@/lib/seo/routes";
import { absoluteUrl } from "@/lib/seo/base-url";
import { FEATURE_ITEMS } from "@/lib/features";

export const dynamic = "force-dynamic";
export const revalidate = 1800;

type Params = { params: Promise<{ slug: string }> };

const FEATURE_KO: Record<string, string> = {
  viewSea: "바다뷰",
  viewMountain: "마운틴뷰",
  viewCity: "시티뷰",
  bbq: "BBQ",
  elevator: "엘리베이터",
  generator: "발전기",
  kidsPool: "키즈풀",
  privatePool: "프라이빗 풀",
  gym: "헬스장",
  golfNearby: "골프장 인근",
  beachFront: "해변 바로앞",
  marketNearby: "시장 인근",
};
const VALID_FEATURES = new Set(Object.values(FEATURE_ITEMS).flat().map((f) => f.featureKey));

/** 분(0~1439) → "14:00" */
function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const v = await getPublicVillaBySlug(slug).catch(() => null);
  if (!v) return { title: "찾을 수 없는 빌라 | Villa GO", robots: { index: false } };
  const where = v.areaNameKo ?? v.areaName ?? v.complex ?? "푸꾸옥";
  const title = `${where} ${v.name} — 침실 ${v.bedrooms}개 · 최대 ${v.maxGuests}인 | Villa GO`;
  const description = (v.description ?? "").slice(0, 150) || `푸꾸옥 ${where} 빌라. 침실 ${v.bedrooms}개, 최대 ${v.maxGuests}인.`;
  const url = absoluteUrl(blogPaths.villa(v.slug));
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      siteName: "Villa GO",
      title,
      description,
      url,
      locale: "ko_KR",
      ...(v.photos[0] ? { images: [{ url: v.photos[0].url }] } : {}),
    },
  };
}

export default async function PublicVillaPage({ params }: Params) {
  const { slug } = await params;
  const v = await getPublicVillaBySlug(slug).catch(() => null);
  if (!v) notFound();

  const where = v.areaNameKo ?? v.areaName ?? v.complex ?? "푸꾸옥";
  const features = v.featureKeys.filter((k) => VALID_FEATURES.has(k));

  // JSON-LD — LodgingBusiness. ★ priceRange·offers·availability 필드는 넣지 않는다(공개 경계).
  //   주소도 단지 수준(addressLocality)까지만. 정확 주소는 어떤 형태로도 내보내지 않는다.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    name: `${where} ${v.name}`,
    description: v.description ?? undefined,
    inLanguage: "ko",
    url: absoluteUrl(blogPaths.villa(v.slug)),
    address: { "@type": "PostalAddress", addressLocality: where, addressCountry: "VN" },
    numberOfRooms: v.bedrooms,
    petsAllowed: v.petsAllowed,
    smokingAllowed: v.smokingAllowed,
    // ★ image를 URL 문자열이 아니라 ImageObject로 준다 — 구글 이미지의 "라이선스 가능" 배지는
    //   IPTC 파일 메타데이터 **또는 구조화 데이터**로 활성화된다. 우리 업로드 파이프라인은
    //   캔버스 재인코딩으로 EXIF/IPTC가 제거되므로(위치정보 유출 방지 측면에선 바람직)
    //   구조화 데이터 경로를 쓴다. 사진 무단 도용 억제에도 도움이 된다.
    image: v.photos.slice(0, 6).map((p) => ({
      "@type": "ImageObject",
      contentUrl: p.url,
      creditText: "Villa GO",
      creator: { "@type": "Organization", name: "Villa GO" },
      copyrightNotice: "© Villa GO",
      acquireLicensePage: absoluteUrl("/chat?src=seo"),
    })),
    amenityFeature: [
      ...(v.hasPool ? [{ "@type": "LocationFeatureSpecification", name: "수영장", value: true }] : []),
      ...(v.breakfastAvailable ? [{ "@type": "LocationFeatureSpecification", name: "조식", value: true }] : []),
      ...features.map((k) => ({ "@type": "LocationFeatureSpecification", name: FEATURE_KO[k] ?? k, value: true })),
    ],
  };

  // 발행된 유튜브 쇼츠가 있으면 VideoObject를 함께 낸다.
  //   ★ 영상은 파일 메타데이터를 봇이 읽는 방식이 아니라 **구조화 데이터**로 색인된다
  //     (검색결과 동영상 썸네일 노출 경로). 미발행·비공개 영상은 관문에서 이미 걸러진다.
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
    { label: "침실", value: `${v.bedrooms}개` },
    { label: "욕실", value: `${v.bathrooms}개` },
    { label: "최대 인원", value: `${v.maxGuests}인` },
    ...(v.areaSqm ? [{ label: "면적", value: `${v.areaSqm}㎡` }] : []),
    ...(v.floors ? [{ label: "층수", value: `${v.floors}층` }] : []),
    ...(v.beachDistanceM != null ? [{ label: "해변까지", value: `약 ${v.beachDistanceM}m` }] : []),
    ...(v.parkingSlots > 0 ? [{ label: "주차", value: `${v.parkingSlots}대` }] : []),
    { label: "체크인 / 체크아웃", value: `${hhmm(v.checkInTime)} / ${hhmm(v.checkOutTime)}` },
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

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-lg font-extrabold tracking-tight text-teal-600">
          Villa GO
        </Link>
        <Link
          href="/chat?src=seo"
          className="rounded-full border border-teal-600 px-3 py-1.5 text-sm font-semibold text-teal-700"
        >
          상담하기
        </Link>
      </header>

      <article className="px-5 py-6">
        <p className="text-sm font-semibold text-amber-600">{where}</p>
        <h1 className="mt-1 text-2xl font-extrabold leading-snug">{v.name}</h1>
        {v.nameVi && <p className="mt-1 text-sm text-slate-400">{v.nameVi}</p>}

        {/* 사진 — alt에 단지·빌라·공간을 넣는다(이미지 검색 색인은 alt 텍스트에 달려 있다) */}
        {v.photos[0] && (
          <div className="relative mt-4 aspect-[16/9] overflow-hidden rounded-2xl bg-slate-100">
            <Image
              src={v.photos[0].url}
              alt={`${where} ${v.name} 외관`}
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
            <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700">수영장</span>
          )}
          {v.breakfastAvailable && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">조식 가능</span>
          )}
          {v.extraBedAvailable && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">엑스트라베드</span>
          )}
          {features.map((k) => (
            <span key={k} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              {FEATURE_KO[k] ?? k}
            </span>
          ))}
        </div>

        {v.description && (
          <section className="mt-6">
            <h2 className="text-lg font-bold">빌라 소개</h2>
            <p className="mt-2 whitespace-pre-line leading-relaxed text-slate-700">{v.description}</p>
          </section>
        )}

        {v.photos.length > 1 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold">사진</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {v.photos.slice(1, 9).map((p) => (
                <div key={p.id} className="relative aspect-square overflow-hidden rounded-xl bg-slate-100">
                  <Image
                    src={p.url}
                    alt={`${where} ${v.name} ${p.spaceLabel ?? ""}`.trim()}
                    fill
                    sizes="(max-width: 640px) 50vw, 320px"
                    className="object-cover"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-lg font-bold">이용 규칙</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            <li>흡연 {v.smokingAllowed ? "가능" : "불가"}</li>
            <li>반려동물 {v.petsAllowed ? "동반 가능" : "동반 불가"}</li>
            <li>파티 {v.partyAllowed ? "가능" : "불가"}</li>
          </ul>
        </section>

        {/* ★ 가격·공실 대신 상담 CTA */}
        <section className="mt-10 rounded-2xl bg-slate-50 p-5">
          <h2 className="text-lg font-bold">이 빌라가 마음에 드세요?</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            인원과 일정을 알려주시면 이용 가능 여부와 견적을 함께 보내드립니다.
          </p>
          <Link
            href="/chat?src=seo"
            className="mt-4 inline-flex touch-target items-center rounded-full bg-teal-600 px-6 text-base font-bold text-white"
          >
            1분 견적 상담
          </Link>
        </section>
      </article>

      <footer className="border-t border-slate-100 px-5 py-8 text-sm text-slate-500">
        <p>
          <Link href={BLOG_ROOT} className="font-semibold text-teal-700">
            ← 푸꾸옥 여행 가이드
          </Link>
        </p>
        <p className="mt-3">
          <Link href="/privacy" className="underline">
            개인정보처리방침
          </Link>
        </p>
      </footer>
    </div>
  );
}
