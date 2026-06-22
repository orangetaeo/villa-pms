"use client";

// 제출 완료(PHOTOS_SUBMITTED·APPROVED) 사진 읽기 전용 그리드 (T3.8 확대 추가)
// 썸네일 탭 → 공용 ImageLightbox 확대(좌우 이동·Esc·배경 닫기). 라벨은 RSC에서 props.
import { useState } from "react";
import Image from "next/image";
import ImageLightbox, { type LightboxImage } from "@/components/image-lightbox";

interface Props {
  photos: LightboxImage[];
  // 슬롯 개수와 일치할 때만 공간 라벨 표시 (page.tsx의 labelsMatch와 동일 의미)
  showLabels: boolean;
  lightboxLabels: { close: string; prev: string; next: string };
}

export default function CleaningPhotosView({ photos, showLabels, lightboxLabels }: Props) {
  const [openAt, setOpenAt] = useState<number | null>(null);

  return (
    <main className="mx-auto w-full max-w-md p-4">
      <div className="grid grid-cols-2 gap-4">
        {photos.map((photo, i) => (
          <div key={photo.url} className="relative">
            <button
              type="button"
              onClick={() => setOpenAt(i)}
              aria-label={photo.label || lightboxLabels.close}
              className="relative block aspect-square w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-200 shadow-sm transition-transform active:scale-95"
            >
              <Image
                src={photo.url}
                alt={photo.label ?? ""}
                fill
                unoptimized
                sizes="(max-width: 768px) 50vw, 200px"
                className="object-cover"
              />
              {/* 확대 가능 힌트 — 우하단 돋보기 */}
              <span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white">
                <span className="material-symbols-outlined text-base">zoom_in</span>
              </span>
            </button>
            {showLabels && photo.label && (
              <p className="mt-2 text-center text-sm font-medium text-neutral-700">
                {photo.label}
              </p>
            )}
          </div>
        ))}
      </div>

      <ImageLightbox
        images={photos}
        index={openAt}
        onIndexChange={setOpenAt}
        labels={lightboxLabels}
      />
    </main>
  );
}
