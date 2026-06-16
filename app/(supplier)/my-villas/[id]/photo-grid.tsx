"use client";

// 상세 사진 그리드 (클라) — 썸네일 탭 시 PhotoLightbox 오픈.
// 캡션·아이콘은 서버에서 계산해 prop으로 받는다(i18n은 서버 page에서 처리).
import { useState } from "react";
import Image from "next/image";
import PhotoLightbox, { type LightboxPhoto } from "./photo-lightbox";

interface Props {
  photos: LightboxPhoto[];
}

export default function PhotoGrid({ photos }: Props) {
  const [openAt, setOpenAt] = useState<number | null>(null);

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((photo, i) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => setOpenAt(i)}
            className="relative aspect-square overflow-hidden rounded-lg bg-neutral-200 transition-transform active:scale-95"
          >
            <Image
              src={photo.url}
              alt={photo.caption}
              fill
              unoptimized
              sizes="(max-width: 420px) 33vw, 140px"
              className="object-cover"
            />
            {photo.caption && (
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/40 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {photo.caption}
              </span>
            )}
          </button>
        ))}
      </div>

      {openAt !== null && (
        <PhotoLightbox
          photos={photos}
          startIndex={openAt}
          onClose={() => setOpenAt(null)}
        />
      )}
    </>
  );
}
