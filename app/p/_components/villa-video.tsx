"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PUBLIC_LABELS, type PublicLang } from "@/lib/public-i18n";

/**
 * 제안 링크 빌라 카드의 소개 영상 — 자동 발행된 유튜브 쇼츠 1건을 임베드한다.
 * ★ youtube-nocookie 도메인: 재생 전 추적 쿠키를 심지 않는 임베드(블로그 빌라 페이지와 동일 규칙).
 *   CSP frame-src에 이미 등록돼 있다(next.config.ts) — 다른 출처를 쓰면 즉시 차단된다.
 * ★ loading="lazy": 제안서는 빌라 2~3개가 한 화면이라 iframe을 즉시 로드하면 첫 화면이 무거워진다.
 * ★ 확대 보기: 카드 안 9:16 플레이어는 작아 내부가 잘 안 보인다 → 전체화면 오버레이로 크게 재생.
 *   오버레이는 createPortal(body) — 카드 조상에 transform/overflow 가 걸리면 fixed 가 갇힌다(기존 교훈).
 */
export function VillaVideo({
  videoId,
  title,
  lang,
}: {
  videoId: string;
  title: string;
  lang: PublicLang;
}) {
  const t = PUBLIC_LABELS[lang];
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // 오버레이가 열린 동안 배경 스크롤 잠금 + ESC 닫기
  useEffect(() => {
    if (!expanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  const src = `https://www.youtube-nocookie.com/embed/${videoId}`;

  return (
    <div className="space-y-2">
      {/* 영상은 9:16이라 카드 폭보다 좁다 — 라벨·플레이어 모두 가운데 정렬(좌측 치우침 방지) */}
      <p className="text-xs font-bold text-teal-600 tracking-wider flex items-center justify-center gap-1">
        <span className="material-symbols-outlined text-[16px]">play_circle</span>
        {t.videoTitle}
      </p>
      <div className="relative mx-auto aspect-[9/16] w-full max-w-[220px] overflow-hidden rounded-xl bg-neutral-100">
        <iframe
          src={src}
          title={title}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      </div>
      {/* 확대 버튼 — 플레이어 위에 겹치면 재생 조작을 가리므로 아래에 둔다 */}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mx-auto flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-bold text-neutral-600 transition hover:border-teal-300 hover:text-teal-600 active:scale-95"
      >
        <span className="material-symbols-outlined text-[16px]">fullscreen</span>
        {t.videoExpand}
      </button>

      {mounted &&
        expanded &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
            onClick={() => setExpanded(false)}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label={t.videoClose}
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 active:scale-95"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
            {/* 세로 영상 — 화면 높이에 맞춰 최대한 크게. 배경 클릭은 닫기, 플레이어 클릭은 통과시키지 않는다 */}
            <div
              className="relative aspect-[9/16] max-h-[88vh] w-full max-w-[calc(88vh*9/16)] overflow-hidden rounded-2xl bg-black"
              onClick={(e) => e.stopPropagation()}
            >
              <iframe
                src={`${src}?autoplay=1&playsinline=1`}
                title={title}
                allow="autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
