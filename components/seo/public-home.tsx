// components/seo/public-home.tsx — villa-go.net 공개 홈 (T-seo-s1)
//
// 검색엔진이 처음 만나는 페이지이자 Google Ads 랜딩. 기존 공개 화면(제안 페이지 /p) 디자인 라인을
// 그대로 계승한다 — 라이트 · teal #0D9488 · 웜샌드 #F59E0B · 사진 중심 · 한국어.
// (DESIGN.md 워크플로 5: 첫 화면에서 추출한 토큰을 이후 화면이 재사용한다)
//
// ★ 절대 금지 (계약 T-seo-s1 §4.1):
//   가격·1박 요금·시작가·통화 표기 / 날짜별 공실·"예약 가능" / 상세주소 / 공급자 정보.
//   가격은 상담으로만 안내한다 — 공급자가 자기 원가를 알기 때문에 공개 판매가 = 마진 역산이다.
//
// ★ 빈 상태 설계: 공개 대상 빌라가 0개인 현재(실빌라 2개·공개 0)에도 **껍데기 섹션을 만들지 않는다**.
//   빌라·지역 섹션은 데이터가 있을 때만 렌더된다. 신규 도메인에 빈 목록 페이지를 내보내면
//   저품질 신호가 되고, 그 판정은 도메인 전체에 번진다(기획 §0 치명2).
import Link from "next/link";
import Image from "next/image";
import type { PublicVilla } from "@/lib/seo/public-villa";
import { blogPaths } from "@/lib/seo/routes";
import { FEATURE_ITEMS } from "@/lib/features";

/** 상담 진입점 — 웹챗(/chat)으로 통일하고 유입 출처를 seo로 표기(인박스에서 구분). */
const CONSULT_HREF = "/chat?src=seo";

/** 홈에 노출할 대표 조건(패싯) — 라벨은 한국어, 링크는 /blog/feature/[key]. */
const HOME_FEATURES: { key: string; label: string; icon: string }[] = [
  { key: "privatePool", label: "프라이빗 풀", icon: "pool" },
  { key: "viewSea", label: "바다뷰", icon: "waves" },
  { key: "beachFront", label: "해변 바로앞", icon: "beach_access" },
  { key: "bbq", label: "BBQ 가능", icon: "outdoor_grill" },
  { key: "golfNearby", label: "골프장 근처", icon: "golf_course" },
  { key: "kidsPool", label: "키즈풀", icon: "pool" },
];

// 사전에 실제로 존재하는 키만 남긴다(사전 변경 시 링크가 조용히 404가 되는 것을 방지).
const VALID_KEYS = new Set(Object.values(FEATURE_ITEMS).flat().map((f) => f.featureKey));

export interface PublicHomeProps {
  /** 공개 대상 빌라(관문 통과분). 비어 있으면 빌라 섹션 자체가 렌더되지 않는다. */
  villas: PublicVilla[];
  /** 지역 카드 — 공개 빌라가 있는 지역만 상위에서 집계해 전달한다. */
  areas: { code: string; label: string; count: number }[];
}

export default function PublicHome({ villas, areas }: PublicHomeProps) {
  const featured = villas.slice(0, 3);
  const features = HOME_FEATURES.filter((f) => VALID_KEYS.has(f.key));

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* 헤더 — 로그인 버튼 없음(소비자 대상). 상담만 노출 */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-lg font-extrabold tracking-tight text-teal-600">
          Villa GO
        </Link>
        <Link
          href={CONSULT_HREF}
          className="rounded-full border border-teal-600 px-3 py-1.5 text-sm font-semibold text-teal-700"
        >
          상담하기
        </Link>
      </header>

      {/* 히어로 */}
      <section className="relative isolate overflow-hidden bg-slate-900">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/70 via-slate-900/60 to-slate-900/90" />
        <div className="relative px-5 py-16 sm:py-24">
          <p className="text-sm font-semibold text-amber-400">푸꾸옥 현지 빌라</p>
          <h1 className="mt-2 text-3xl font-extrabold leading-snug text-white sm:text-4xl">
            푸꾸옥 풀빌라,
            <br />
            조건으로 찾으세요
          </h1>
          <p className="mt-3 max-w-md text-base leading-relaxed text-slate-200">
            인원·시설로 골라보는 현지 빌라. 현지에서 직접 운영하고 검수합니다.
          </p>
          <Link
            href={CONSULT_HREF}
            className="mt-6 inline-flex touch-target items-center rounded-full bg-white px-6 text-base font-bold text-slate-900"
          >
            1분 견적 상담
          </Link>
        </div>
      </section>

      {/* 지역으로 찾기 — 공개 빌라가 있는 지역만 */}
      {areas.length > 0 && (
        <section className="px-5 py-8">
          <h2 className="text-xl font-bold">지역으로 찾기</h2>
          <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
            {areas.map((a) => (
              <Link
                key={a.code}
                href={blogPaths.area(a.code)}
                className="shrink-0 rounded-xl border border-slate-200 px-4 py-3"
              >
                <span className="block font-semibold">{a.label}</span>
                <span className="mt-1 block rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                  빌라 {a.count}곳
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 조건으로 찾기 — 빌라가 있을 때만(빈 결과 페이지로 보내지 않는다) */}
      {villas.length > 0 && features.length > 0 && (
        <section className="px-5 py-8">
          <h2 className="text-xl font-bold">조건으로 찾기</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {features.map((f) => (
              <Link
                key={f.key}
                href={blogPaths.feature(f.key)}
                className="flex touch-target items-center gap-2 rounded-xl border border-slate-200 px-4"
              >
                <span className="material-symbols-outlined text-teal-600" aria-hidden>
                  {f.icon}
                </span>
                <span className="text-sm font-semibold">{f.label}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 추천 빌라 — ★ 가격·공실 표기 없음. CTA는 견적 문의 */}
      {featured.length > 0 && (
        <section className="px-5 py-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-bold">추천 빌라</h2>
            <Link href={blogPaths.villas()} className="text-sm font-semibold text-teal-700">
              전체 보기 →
            </Link>
          </div>
          <div className="mt-4 space-y-5">
            {featured.map((v) => (
              <article key={v.id} className="overflow-hidden rounded-2xl border border-slate-200">
                {v.photos[0] && (
                  <div className="relative aspect-[16/9] bg-slate-100">
                    <Image
                      src={v.photos[0].url}
                      alt={`${v.publicLabel} 외관`}
                      fill
                      sizes="(max-width: 640px) 100vw, 640px"
                      className="object-cover"
                    />
                  </div>
                )}
                <div className="p-4">
                  <h3 className="text-lg font-bold">
                    <Link href={blogPaths.villa(v.slug)}>{v.publicLabel}</Link>
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
                  </div>
                  {v.description && (
                    <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600">
                      {v.description}
                    </p>
                  )}
                  <Link
                    href={CONSULT_HREF}
                    className="mt-3 inline-block text-sm font-semibold text-teal-700"
                  >
                    견적 문의 →
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* 서비스 소개 — 빌라가 아직 없어도 페이지가 성립하게 하는 본문.
          Google Ads 랜딩 심사 요건(무엇을 하는 서비스인지 명확)에도 대응한다. */}
      <section className="bg-slate-50 px-5 py-10">
        <h2 className="text-xl font-bold">Villa GO는 이렇게 다릅니다</h2>
        <dl className="mt-5 space-y-5">
          <div>
            <dt className="font-semibold text-teal-700">현지 운영</dt>
            <dd className="mt-1 text-sm leading-relaxed text-slate-600">
              푸꾸옥 현지에서 빌라를 직접 관리합니다. 체크인·청소·현장 대응을 한국어로 안내합니다.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-teal-700">검수한 빌라만</dt>
            <dd className="mt-1 text-sm leading-relaxed text-slate-600">
              청소 검수를 통과한 빌라만 안내합니다. 사진과 실제가 다른 일이 없도록 공간별로 확인합니다.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-teal-700">조건에 맞춰 제안</dt>
            <dd className="mt-1 text-sm leading-relaxed text-slate-600">
              인원과 일정, 원하는 시설을 알려주시면 조건에 맞는 빌라를 골라 견적과 함께 보내드립니다.
            </dd>
          </div>
        </dl>
        <Link
          href={CONSULT_HREF}
          className="mt-6 inline-flex touch-target items-center rounded-full bg-teal-600 px-6 text-base font-bold text-white"
        >
          조건 알려주고 견적 받기
        </Link>
      </section>

      {/* 파트너·공급자 모집 — 기존 정적 소개 자산 재사용(색인 허용 경로) */}
      <section className="px-5 py-8">
        <h2 className="text-lg font-bold">함께 일하실 분</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li>
            <a href="/intro-partner.html" className="font-medium text-teal-700">
              여행사·랜드사 파트너 안내 →
            </a>
          </li>
          <li>
            <a href="/intro.html" className="font-medium text-teal-700">
              빌라 관리인(공급자) 안내 →
            </a>
          </li>
          <li>
            <a href="/intro-vendor.html" className="font-medium text-teal-700">
              부가서비스 업체 안내 →
            </a>
          </li>
        </ul>
      </section>

      {/* 푸터 — Google Ads 랜딩 요건: 사업자 정보·연락 수단·개인정보처리방침 */}
      <footer className="border-t border-slate-100 px-5 py-8 text-sm text-slate-500">
        <p className="font-semibold text-slate-700">Villa GO</p>
        <p className="mt-1">푸꾸옥 빌라 예약·현지 운영</p>
        <p className="mt-2">
          문의 <a href="mailto:biz.villago@gmail.com" className="text-teal-700">biz.villago@gmail.com</a>
        </p>
        <p className="mt-3">
          <Link href="/privacy" className="underline">
            개인정보처리방침
          </Link>
        </p>
      </footer>

      {/* 고정 하단 CTA */}
      <div className="pb-safe sticky bottom-0 z-20 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
        <Link
          href={CONSULT_HREF}
          className="flex touch-target w-full items-center justify-center rounded-xl bg-teal-600 text-base font-bold text-white"
        >
          빌라 문의하기
        </Link>
      </div>
    </div>
  );
}
