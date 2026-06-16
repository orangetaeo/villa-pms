"use client";

// 채팅 이미지 라이트박스 (b14 RIGHT pane 전용) — 채팅 PhotoCard 클릭 시 풀스크린 원본 뷰어.
// my-villas/[id]/photo-lightbox와 별개(채팅용): 공간 칩·필름스트립 없이 원본 크기 우선.
// 규칙: 원본 비율·크기 유지(object-contain), 모바일 넘침 방지(max-w 100vw / max-h 100dvh).
//   배경(이미지 외) 클릭·X·ESC로 닫기. body 스크롤 잠금. z-index 최상위. 여러 장이면 좌우 이동.
// 누수 0: 첨부 이미지 url만 사용(금액·고객정보 없음).
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

interface Props {
  urls: string[];
  startIndex: number;
  onClose: () => void;
}

export default function ChatPhotoLightbox({ urls, startIndex, onClose }: Props) {
  const t = useTranslations("adminMessages");
  const [index, setIndex] = useState(startIndex);
  const touchStartX = useRef<number | null>(null);

  const total = urls.length;
  const clamp = useCallback((n: number) => Math.max(0, Math.min(total - 1, n)), [total]);
  const goPrev = useCallback(() => setIndex((i) => clamp(i - 1)), [clamp]);
  const goNext = useCallback(() => setIndex((i) => clamp(i + 1)), [clamp]);

  // 키보드 — ESC 닫기 + 좌우 이동(접근성·데스크톱)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  // body 스크롤 잠금 — 라이트박스 떠 있는 동안 배경 스크롤 방지
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (total === 0) return null;
  const current = urls[index];

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
      // 배경(이미지 외) 클릭 시 닫기 — 이미지/버튼은 stopPropagation으로 보호
      onClick={onClose}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 backdrop-blur-sm select-none"
      role="dialog"
      aria-modal="true"
    >
      {/* 닫기(X) — 우상단 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={t("lightbox.close")}
        title={t("lightbox.close")}
        className="absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-transform hover:bg-white/20 active:scale-95"
      >
        <span className="material-symbols-outlined">close</span>
      </button>

      {/* 카운터 — 여러 장일 때만 */}
      {total > 1 && (
        <div className="absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-4 py-1 backdrop-blur-md">
          <span className="text-sm font-semibold tabular-nums text-white">
            {t("lightbox.counter", { current: index + 1, total })}
          </span>
        </div>
      )}

      {/* 원본 이미지 — object-contain, 최대 100vw/100dvh 내에서 비율 유지(잘림 없음) */}
      <div
        className="flex h-full w-full items-center justify-center p-4"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current}
          src={current}
          alt=""
          onClick={(e) => e.stopPropagation()}
          className="max-h-[100dvh] max-w-[100vw] object-contain"
        />
      </div>

      {/* 좌우 이동 — 여러 장이고 양 끝이 아닐 때만 */}
      {total > 1 && index > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          aria-label={t("lightbox.prev")}
          className="absolute left-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-transform hover:bg-black/60 active:scale-90"
        >
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
      )}
      {total > 1 && index < total - 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          aria-label={t("lightbox.next")}
          className="absolute right-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-transform hover:bg-black/60 active:scale-90"
        >
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      )}
    </div>
  );
}
