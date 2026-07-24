"use client";

// components/seo/hero-blog-carousel.tsx — 공개 홈 히어로: 빌라 블로그 썸네일 롤링 캐러셀
//
// 테오 지시(2026-07-24): 히어로 자리에 블로그 썸네일을 롤링으로 보여주고, 누르면 해당 글로 이동.
//   "우선은 빌라의 블로그 정보만" → 상위(app/page.tsx)에서 category=villa 글만 넘긴다.
//
// ★ 썸네일(lib/seo/thumbnail.ts)은 16:9(1200×675)에 제목·후킹·브랜드가 이미 구워져 있다.
//   그래서 여기서는 별도 텍스트 오버레이 없이 이미지를 그대로 굴린다(비율 일치 → 크롭 없음).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { blogPaths } from "@/lib/seo/routes";

export interface HeroBlogSlide {
  slug: string;
  title: string;
  imageUrl: string;
}

/** 자동 롤링 간격(ms). */
const ROLL_MS = 4500;

export default function HeroBlogCarousel({ slides }: { slides: HeroBlogSlide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);
  const n = slides.length;

  // 자동 롤링 — 슬라이드가 2개 이상이고 사용자가 만지고 있지 않을 때만.
  useEffect(() => {
    if (n <= 1 || paused) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % n), ROLL_MS);
    return () => clearInterval(t);
  }, [n, paused]);

  if (n === 0) return null;

  const go = (i: number) => setIndex(((i % n) + n) % n);

  return (
    <section
      className="relative select-none bg-slate-900"
      aria-roledescription="carousel"
      aria-label="빌라 블로그"
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
      <div className="overflow-hidden">
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {slides.map((s, i) => (
            <Link
              key={s.slug}
              href={blogPaths.article(s.slug)}
              className="relative block aspect-[16/9] w-full shrink-0"
              aria-label={s.title}
              aria-hidden={i !== index}
              tabIndex={i === index ? 0 : -1}
            >
              <Image
                src={s.imageUrl}
                alt={s.title}
                fill
                sizes="(max-width: 640px) 100vw, 640px"
                priority={i === 0}
                className="object-cover"
              />
            </Link>
          ))}
        </div>
      </div>

      {n > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="이전 글"
            className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-xl leading-none text-white backdrop-blur"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="다음 글"
            className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-xl leading-none text-white backdrop-blur"
          >
            ›
          </button>
          {/* 인디케이터 — 현재 슬라이드만 길게 */}
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.slug}
                type="button"
                onClick={() => go(i)}
                aria-label={`${i + 1}번째 글로`}
                aria-current={i === index}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-5 bg-white" : "w-1.5 bg-white/55"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
