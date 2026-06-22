"use client";

// 빌라 상세 사진 갤러리 + 클릭 확대 라이트박스 (b10) — 클릭 시 전체화면 확대,
// 좌우 이동(키보드 ←→), Esc·배경·X 닫기. 마진·판매가 등 민감 정보 없음(사진 URL·공간 라벨만).
import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";

interface GalleryPhoto {
  id: string;
  space: string;
  spaceLabel: string | null;
  url: string;
}

interface GalleryGroup {
  space: string;
  photos: GalleryPhoto[];
}

export default function PhotoGallery({ groups }: { groups: GalleryGroup[] }) {
  const t = useTranslations("adminVillas.detail");
  const flat = useMemo(() => groups.flatMap((g) => g.photos), [groups]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);
  const prev = useCallback(
    () => setOpenIndex((i) => (i === null ? null : (i - 1 + flat.length) % flat.length)),
    [flat.length]
  );
  const next = useCallback(
    () => setOpenIndex((i) => (i === null ? null : (i + 1) % flat.length)),
    [flat.length]
  );

  useEffect(() => {
    if (openIndex === null) return;
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
  }, [openIndex, close, prev, next]);

  // 인접 이미지(다음·이전) 브라우저 캐시 워밍 — 화살표 누르면 즉시 뜨도록 미리 로드
  useEffect(() => {
    if (openIndex === null || flat.length < 2) return;
    const neighbors = [
      flat[(openIndex + 1) % flat.length]?.url,
      flat[(openIndex - 1 + flat.length) % flat.length]?.url,
    ];
    for (const url of neighbors) {
      if (!url) continue;
      const img = new window.Image();
      img.src = url;
    }
  }, [openIndex, flat]);

  const labelFor = (p: GalleryPhoto) => p.spaceLabel ?? t(`spaces.${p.space}`);
  const current = openIndex === null ? null : flat[openIndex];

  return (
    <>
      <div className="space-y-8">
        {groups.map((group) => (
          <div key={group.space}>
            <p className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider whitespace-nowrap">
              {t(`spaces.${group.space}`)}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {group.photos.map((photo) => {
                const index = flat.findIndex((p) => p.id === photo.id);
                return (
                  <button
                    type="button"
                    key={photo.id}
                    onClick={() => setOpenIndex(index)}
                    aria-label={labelFor(photo)}
                    className="aspect-video rounded-lg overflow-hidden bg-slate-800 group relative cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-admin-primary"
                  >
                    <Image
                      src={photo.url}
                      alt={labelFor(photo)}
                      fill
                      sizes="(max-width: 1024px) 50vw, 20vw"
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/25 transition-colors">
                      <span className="material-symbols-outlined text-white opacity-0 group-hover:opacity-90 transition-opacity">
                        zoom_in
                      </span>
                    </span>
                    {photo.spaceLabel && (
                      <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[10px] font-bold text-white">
                        {photo.spaceLabel}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {current && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={labelFor(current)}
          onClick={close}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
        >
          <button
            type="button"
            onClick={close}
            aria-label={t("photos.close")}
            className="absolute top-4 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <span className="material-symbols-outlined">close</span>
          </button>

          {flat.length > 1 && (
            <>
              <button
                type="button"
                aria-label={t("photos.prev")}
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
                aria-label={t("photos.next")}
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

          <div className="relative h-[82vh] w-[92vw]" onClick={(e) => e.stopPropagation()}>
            <Image
              src={current.url}
              alt={labelFor(current)}
              fill
              sizes="92vw"
              className="object-contain"
              priority
              unoptimized
            />
          </div>

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white">
            {labelFor(current)} · {openIndex! + 1}/{flat.length}
          </div>
        </div>
      )}
    </>
  );
}
