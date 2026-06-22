"use client";

// A 사진 확대 라이트박스 (a11-photo-lightbox) — 상세 사진 그리드 탭 시 풀스크린 갤러리.
// 좌우 스와이프(터치)·chevron·캡션·닫기. near-black 배경에 teal 액센트.
// QA 교정: 카운터 {current}/{total} 단일화, 거실 아이콘 chair, 하단 5버튼 네비 제거(1화면 1작업).
// 누수 0: 사진 url·캡션만. 금액·고객 정보 없음.
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";

export interface LightboxPhoto {
  id: string;
  url: string;
  caption: string;
  /** 공간별 아이콘 (Material Symbols) — 캡션 칩에 표시 */
  icon: string;
}

interface Props {
  photos: LightboxPhoto[];
  startIndex: number;
  onClose: () => void;
}

export default function PhotoLightbox({ photos, startIndex, onClose }: Props) {
  const t = useTranslations("photoLightbox");
  const [index, setIndex] = useState(startIndex);
  const touchStartX = useRef<number | null>(null);

  const total = photos.length;
  const clamp = useCallback(
    (n: number) => Math.max(0, Math.min(total - 1, n)),
    [total]
  );
  const goPrev = useCallback(() => setIndex((i) => clamp(i - 1)), [clamp]);
  const goNext = useCallback(() => setIndex((i) => clamp(i + 1)), [clamp]);

  // 키보드 — 데스크톱 검증·접근성 (ESC 닫기, 좌우 이동)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  if (total === 0) return null;
  const current = photos[index];

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx > 50) goPrev();
    else if (dx < -50) goNext();
    touchStartX.current = null;
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex flex-col bg-[#0F0F0F] text-white select-none"
    >
      {/* 상단 바 — 닫기 + 카운터(단일 진실원천) 만 (삭제는 사진관리에서, 1화면 1작업) */}
      <header className="absolute top-0 z-10 flex h-14 w-full items-center justify-between px-4">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md transition-transform active:scale-95"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
        <div className="rounded-full border border-white/10 bg-black/60 px-4 py-1 backdrop-blur-md">
          <span className="text-sm font-semibold tracking-wide tabular-nums">
            {t("counter", { current: index + 1, total })}
          </span>
        </div>
        <div className="h-10 w-10" />
      </header>

      {/* 메인 사진 캔버스 */}
      <main
        className="relative flex flex-grow items-center justify-center overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="relative aspect-[4/3] w-full">
          <Image
            key={current.id}
            src={current.url}
            alt={current.caption}
            fill
            unoptimized
            sizes="100vw"
            className="object-contain"
          />
        </div>

        {/* 좌우 이동 — 양 끝에서 숨김 (어포던스 명확) */}
        {index > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            aria-label={t("prev")}
            className="absolute left-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm transition-transform active:scale-90"
          >
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
        )}
        {index < total - 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            aria-label={t("next")}
            className="absolute right-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm transition-transform active:scale-90"
          >
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
        )}

        {/* 공간 라벨 칩 — 아이콘은 공간별 매핑(거실 chair 등) */}
        {current.caption && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2">
            <div className="flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-900/40 px-4 py-2 backdrop-blur-xl">
              <span
                className="material-symbols-outlined text-sm text-teal-400"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {current.icon}
              </span>
              <span className="text-xs font-semibold tracking-wide text-white">
                {current.caption}
              </span>
            </div>
          </div>
        )}
      </main>

      {/* 하단 필름스트립 — 활성 썸네일 teal 보더. 진행 도트는 카운터와 중복이라 제거 */}
      <footer className="bg-gradient-to-t from-black to-transparent px-4 pb-10 pt-4">
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {photos.map((photo, i) => (
            <button
              key={photo.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIndex(i);
              }}
              aria-label={photo.caption}
              aria-current={i === index}
              className={`relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg transition-opacity ${
                i === index ? "opacity-100 ring-2 ring-teal-500" : "opacity-40"
              }`}
            >
              <Image
                src={photo.url}
                alt={photo.caption}
                fill
                unoptimized
                sizes="64px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}
