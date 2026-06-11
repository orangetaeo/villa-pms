"use client";

import { useRef, useState } from "react";
import Image from "next/image";

/** c1 빌라 카드 사진 캐러셀 — 스크롤 스냅 + 하단 dots (디자인: aspect-[4/3], dots bottom-3) */
export function PhotoCarousel({ urls, alt }: { urls: string[]; alt: string }) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

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
          <div key={url} className="relative w-full h-full shrink-0 snap-center">
            <Image
              src={url}
              alt={`${alt} 사진 ${i + 1}`}
              fill
              sizes="(max-width: 448px) 100vw, 448px"
              className="object-cover"
              priority={i === 0}
            />
          </div>
        ))}
      </div>
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
    </div>
  );
}
