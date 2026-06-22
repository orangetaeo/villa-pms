"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

/** c1 빌라 카드 사진 캐러셀 — 스크롤 스냅 + 하단 dots. 탭하면 전체화면 확대(라이트박스). */
export function PhotoCarousel({ urls, alt }: { urls: string[]; alt: string }) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const close = useCallback(() => setLightbox(null), []);
  const prev = useCallback(
    () => setLightbox((i) => (i === null ? null : (i - 1 + urls.length) % urls.length)),
    [urls.length]
  );
  const next = useCallback(
    () => setLightbox((i) => (i === null ? null : (i + 1) % urls.length)),
    [urls.length]
  );

  // 키보드(←→·Esc) + 배경 스크롤 잠금
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [lightbox, close, prev, next]);

  // 인접 이미지 미리 로드 — 화살표 누르면 즉시 뜨도록
  useEffect(() => {
    if (lightbox === null || urls.length < 2) return;
    for (const url of [urls[(lightbox + 1) % urls.length], urls[(lightbox - 1 + urls.length) % urls.length]]) {
      if (!url) continue;
      const img = new window.Image();
      img.src = url;
    }
  }, [lightbox, urls]);

  if (urls.length === 0) {
    return (
      <div className="aspect-[4/3] bg-neutral-100 flex items-center justify-center">
        <span className="material-symbols-outlined text-neutral-300 text-5xl">villa</span>
      </div>
    );
  }

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  };

  return (
    <div className="relative aspect-[4/3] overflow-hidden">
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex h-full w-full overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {urls.map((url, i) => (
          <button
            type="button"
            key={url}
            onClick={() => setLightbox(i)}
            aria-label={`${alt} 사진 ${i + 1} 확대`}
            className="relative w-full h-full shrink-0 snap-center cursor-zoom-in"
          >
            <Image
              src={url}
              alt={`${alt} 사진 ${i + 1}`}
              fill
              sizes="(max-width: 448px) 100vw, 448px"
              className="object-cover"
              priority={i === 0}
            />
          </button>
        ))}
      </div>

      {/* 확대 힌트 아이콘 */}
      <span className="pointer-events-none absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white">
        <span className="material-symbols-outlined text-base">zoom_out_map</span>
      </span>

      {urls.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
          {urls.map((url, i) => (
            <span
              key={url}
              className={`w-2 h-2 rounded-full ${i === active ? "bg-white" : "bg-white/50"}`}
            />
          ))}
        </div>
      )}

      {/* 라이트박스 */}
      {lightbox !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${alt} 사진`}
          onClick={close}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
        >
          <button
            type="button"
            onClick={close}
            aria-label="닫기"
            className="absolute top-4 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <span className="material-symbols-outlined">close</span>
          </button>

          {urls.length > 1 && (
            <>
              <button
                type="button"
                aria-label="이전 사진"
                onClick={(e) => {
                  e.stopPropagation();
                  prev();
                }}
                className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <button
                type="button"
                aria-label="다음 사진"
                onClick={(e) => {
                  e.stopPropagation();
                  next();
                }}
                className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </>
          )}

          <div className="relative h-[82vh] w-[92vw]">
            <Image
              src={urls[lightbox]}
              alt={`${alt} 사진 ${lightbox + 1}`}
              fill
              sizes="92vw"
              className="object-contain"
              priority
              unoptimized
            />
          </div>

          {urls.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white">
              {lightbox + 1}/{urls.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
