"use client";

// 빌라 위치 지도 임베드 (계약 villa-map-embed) — 좌표 필드/지도 라이브러리 없이
// 기존 Villa.googleMapUrl을 안전하게 임베드 가능한 URL로 변환해 iframe 렌더.
//
// URL 변환·검증 로직은 map-embed-url.ts(순수, JSX 없음)로 분리했다 — 서버·테스트에서 직접 import 가능.
// 재고 비공개·마진 비공개와 무관(위치만 표시). 부모는 필요 시 외부 링크를 별도로 유지한다.

import { useMemo } from "react";
import { toEmbedUrl } from "./map-embed-url";

// 하위호환 re-export — 기존 import 경로(@/components/villa/map-embed) 유지
export { toEmbedUrl } from "./map-embed-url";
export type { ToEmbedOptions } from "./map-embed-url";

export interface MapEmbedProps {
  googleMapUrl: string | null | undefined;
  /** 외곽 래퍼 클래스(종횡비/여백은 호출부에서 조절) */
  className?: string;
  /** iframe title — 접근성. 부모가 i18n 라벨 주입(미주입 시 영문 기본). */
  title?: string;
  /** 대략 위치 모드 — 좌표를 뭉개고 줌을 낮춘다(비로그인 제안 링크 전용). 기본 false=정밀. */
  approximate?: boolean;
}

/**
 * 변환 성공 시 16:9 반응형 박스 안 iframe 렌더. 실패 시 아무것도 렌더하지 않음(null).
 * 부모는 기존 "구글지도에서 열기" 외부 링크를 별도로 유지한다.
 */
export default function MapEmbed({ googleMapUrl, className, title, approximate }: MapEmbedProps) {
  const embedUrl = useMemo(
    () => toEmbedUrl(googleMapUrl, { approximate }),
    [googleMapUrl, approximate]
  );
  if (!embedUrl) return null;

  return (
    <div
      className={
        className ??
        "relative w-full overflow-hidden rounded-lg border border-neutral-200 aspect-video"
      }
    >
      <iframe
        src={embedUrl}
        title={title ?? "Map"}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  );
}
