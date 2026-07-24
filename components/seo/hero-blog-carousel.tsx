"use client";

// components/seo/hero-blog-carousel.tsx — 공개 홈 히어로 롤링 캐러셀
//
// 테오 지시(2026-07-24) 반영:
//   1) 슬라이드 0 = 기존 히어로(브랜드 헤드라인 + 상담 CTA). 이것도 롤링에 포함한다.
//   2) 이후 슬라이드 = 빌라 블로그. 썸네일에 글자가 없으므로 **제목+요약 텍스트를 직접 오버레이**한다.
//      슬라이드 전체가 링크 → 누르면 해당 글(/blog/[slug])로 이동.
//   3) 빌라 블로그 글이 없으면 히어로 한 장만 남아 정지 상태로 표시(폴백).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";

export interface HeroPost {
  slug: string;
  title: string;
  summary: string;
  imageUrl: string;
  /** 서버에서 계산한 로케일별 글 URL(ADR-0050 §E) — 비-ko는 /{l}/blog/{slug}. */
  href: string;
}

export interface HeroCarouselLabels {
  eyebrow: string;
  title: string;
  subtitle: string;
  cta: string;
  consultHref: string;
  readMore: string;
}

const ROLL_MS = 4500;

export default function HeroCarousel({
  heroImageUrl,
  posts,
  labels,
}: {
  heroImageUrl: string | null;
  posts: HeroPost[];
  labels: HeroCarouselLabels;
}) {
  const total = 1 + posts.length; // [히어로, ...블로그]
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    if (total <= 1 || paused) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % total), ROLL_MS);
    return () => clearInterval(t);
  }, [total, paused]);

  const go = (i: number) => setIndex(((i % total) + total) % total);

  return (
    <section
      className="relative h-[60vh] max-h-[560px] min-h-[380px] select-none overflow-hidden bg-slate-900"
      aria-roledescription="carousel"
      aria-label="빌라 · 블로그"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
        if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1)); // 스와이프
        touchX.current = null;
      }}
    >
      <div
        className="flex h-full transition-transform duration-500 ease-out"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {/* 슬라이드 0 — 기존 히어로(브랜드 헤드라인 + CTA) */}
        <div className="relative h-full w-full shrink-0" aria-hidden={index !== 0}>
          {/* 히어로 배경은 어두운 그라데이션 오버레이(from-slate-900/80) 뒤라 화질을 낮춰도
              눈에 띄지 않는다 → quality 60으로 LCP 이미지 바이트 절감. fetchPriority high로
              브라우저가 최우선 다운로드하게 명시(LCP request discovery). */}
          {heroImageUrl && (
            <Image
              src={heroImageUrl}
              alt=""
              fill
              priority
              fetchPriority="high"
              quality={60}
              sizes="100vw"
              className="object-cover"
              aria-hidden
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/80 via-slate-900/60 to-slate-900/95" />
          <div className="relative flex h-full flex-col justify-center px-5">
            <p className="text-sm font-semibold text-amber-400">{labels.eyebrow}</p>
            <h1 className="mt-2 text-3xl font-extrabold leading-snug text-white sm:text-4xl">{labels.title}</h1>
            <p className="mt-3 max-w-md text-base leading-relaxed text-slate-200">{labels.subtitle}</p>
            <Link
              href={labels.consultHref}
              tabIndex={index === 0 ? 0 : -1}
              className="mt-6 inline-flex touch-target w-fit items-center rounded-full bg-white px-6 text-base font-bold text-slate-900"
            >
              {labels.cta}
            </Link>
          </div>
        </div>

        {/* 블로그 슬라이드 — 사진 + 제목·요약 오버레이 + 링크 */}
        {posts.map((p, i) => (
          <Link
            key={p.slug}
            href={p.href}
            aria-hidden={index !== i + 1}
            tabIndex={index === i + 1 ? 0 : -1}
            className="relative block h-full w-full shrink-0"
          >
            {/* LCP: 실제 첫 화면(슬라이드0) 이미지 한 장만 priority. 히어로 이미지가 있으면
              이 블로그 이미지들은 화면 밖(슬라이드1+)이므로 프리로드하지 않는다(대역폭 경쟁 방지).
              히어로 이미지가 없을 때만 첫 블로그 이미지가 LCP가 되어 priority를 받는다. */}
          <Image
            src={p.imageUrl}
            alt={p.title}
            fill
            sizes="100vw"
            quality={65}
            priority={i === 0 && !heroImageUrl}
            fetchPriority={i === 0 && !heroImageUrl ? "high" : "auto"}
            loading={i === 0 && !heroImageUrl ? undefined : "lazy"}
            className="object-cover"
          />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/30 to-slate-900/10" />
            <div className="absolute inset-x-0 bottom-0 p-5">
              <h2 className="line-clamp-2 text-xl font-extrabold leading-snug text-white sm:text-2xl">{p.title}</h2>
              {p.summary && (
                <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-slate-200">{p.summary}</p>
              )}
              <span className="mt-2 inline-block text-sm font-bold text-amber-300">{labels.readMore}</span>
            </div>
          </Link>
        ))}
      </div>

      {total > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="이전"
            className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-xl leading-none text-white backdrop-blur"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="다음"
            className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-xl leading-none text-white backdrop-blur"
          >
            ›
          </button>
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {Array.from({ length: total }).map((_, i) => (
              // 터치 타깃 ≥24px 확보(WCAG 2.5.8) — 시각적 막대는 작게 유지하되 클릭영역만 넓힌다.
              <button
                key={i}
                type="button"
                onClick={() => go(i)}
                aria-label={`${i + 1}번째 슬라이드`}
                aria-current={i === index}
                className="grid h-6 min-w-6 place-items-center"
              >
                <span
                  className={`block h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-white" : "w-1.5 bg-white/55"}`}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
