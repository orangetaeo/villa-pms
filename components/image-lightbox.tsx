"use client";

// 공용 이미지 라이트박스 — 클릭 확대, 좌우 이동(키보드 ←→·버튼), Esc·배경·X 닫기.
// 원본 직접 로드(unoptimized) + 인접 이미지 프리로드로 모바일에서도 빠르게.
// index/onIndexChange로 부모가 열림 상태를 제어(controlled).
import { useCallback, useEffect } from "react";
import Image from "next/image";

export interface LightboxImage {
  url: string;
  label?: string;
}

interface Props {
  images: LightboxImage[];
  index: number | null;
  onIndexChange: (i: number | null) => void;
  labels?: { close?: string; prev?: string; next?: string };
}

export default function ImageLightbox({ images, index, onIndexChange, labels }: Props) {
  const count = images.length;

  const close = useCallback(() => onIndexChange(null), [onIndexChange]);
  const prev = useCallback(
    () => onIndexChange(index === null ? null : (index - 1 + count) % count),
    [index, count, onIndexChange]
  );
  const next = useCallback(
    () => onIndexChange(index === null ? null : (index + 1) % count),
    [index, count, onIndexChange]
  );

  // 키보드(←→·Esc) + 배경 스크롤 잠금
  useEffect(() => {
    if (index === null) return;
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
  }, [index, close, prev, next]);

  // 인접 이미지 미리 로드 — 화살표 누르면 즉시 뜨도록
  useEffect(() => {
    if (index === null || count < 2) return;
    for (const im of [images[(index + 1) % count], images[(index - 1 + count) % count]]) {
      if (!im) continue;
      const img = new window.Image();
      img.src = im.url;
    }
  }, [index, images, count]);

  if (index === null) return null;
  const current = images[index];
  if (!current) return null;

  // 라벨은 호출부(RSC)가 로케일에 맞게 주입한다. 폴백은 공개/공급자 화면에 한글이 새지
  // 않도록 중립적인 영문 기본값(호출부가 항상 주입하므로 실제로는 렌더되지 않음).
  const l = {
    close: labels?.close ?? "Close",
    prev: labels?.prev ?? "Previous",
    next: labels?.next ?? "Next",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.label ?? l.close}
      onClick={close}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
    >
      <button
        type="button"
        onClick={close}
        aria-label={l.close}
        className="absolute top-4 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <span className="material-symbols-outlined">close</span>
      </button>

      {count > 1 && (
        <>
          <button
            type="button"
            aria-label={l.prev}
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
            aria-label={l.next}
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

      {/* 배경·이미지 어디를 눌러도 닫힘 — 컨트롤 버튼만 stopPropagation. 이미지는 클릭 흡수 없이 통과 */}
      <div className="relative h-[82vh] w-[92vw]">
        <Image
          src={current.url}
          alt={current.label ?? ""}
          fill
          sizes="92vw"
          className="object-contain"
          priority
          unoptimized
        />
      </div>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white">
        {current.label ? `${current.label} · ${index + 1}/${count}` : `${index + 1}/${count}`}
      </div>
    </div>
  );
}
