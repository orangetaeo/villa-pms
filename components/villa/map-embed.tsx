"use client";

// 빌라 위치 지도 임베드 (계약 villa-map-embed) — 좌표 필드/지도 라이브러리 없이
// 기존 Villa.googleMapUrl을 안전하게 임베드 가능한 URL로 변환해 iframe 렌더.
//
// 보안(SSRF/오용 방지): 호스트 화이트리스트 + https:// 만 허용. 그 외/파싱 실패 → null(렌더 안 함).
// short URL(goo.gl / maps.app.goo.gl)은 리다이렉트 전이라 좌표 추출 불가 → 임베드 생략(부모의 외부 링크만 유지).
// 재고 비공개·마진 비공개와 무관(위치만 표시). 부모는 "구글지도에서 열기" 외부 링크를 별도로 유지한다.

import { useMemo } from "react";

/** 임베드 허용 호스트 — google 지도 도메인만. SSRF/임의 iframe 주입 차단. */
function isAllowedMapHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "google.com" ||
    h.endsWith(".google.com") || // www.google.com·maps.google.com 허용. google.com.evil.com 은 ".evil.com"으로 끝나 자동 차단.
    h === "goo.gl" ||
    h === "maps.app.goo.gl"
  );
}

/** "lat,lng" 형태 좌표 문자열인지 검증하고 정규화. 위도 ±90 / 경도 ±180 범위 검사. */
function parseLatLng(raw: string): string | null {
  const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(raw);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return `${lat},${lng}`;
}

/**
 * googleMapUrl → 임베드 가능한 URL(`https://maps.google.com/maps?q=...&z=15&output=embed`).
 * 변환 불가(비허용 호스트·비-https·좌표/검색어 추출 실패·short URL)면 null.
 */
export function toEmbedUrl(googleMapUrl: string | null | undefined): string | null {
  if (!googleMapUrl) return null;
  let url: URL;
  try {
    url = new URL(googleMapUrl.trim());
  } catch {
    return null; // 파싱 실패
  }

  if (url.protocol !== "https:") return null; // https 만
  if (!isAllowedMapHost(url.hostname)) return null; // 화이트리스트 외 거부

  // short URL(goo.gl / maps.app.goo.gl)은 좌표가 경로 해시에만 있어 추출 불가 → 임베드 생략.
  if (url.hostname === "goo.gl" || url.hostname === "maps.app.goo.gl") return null;

  // 1) path 의 @lat,lng (예: /maps/place/.../@10.123,103.456,15z)
  const atMatch = /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/.exec(url.pathname + url.search);
  if (atMatch) {
    const coord = parseLatLng(`${atMatch[1]},${atMatch[2]}`);
    if (coord) return buildEmbed(coord);
  }

  // 2) data 파라미터 !3d<lat>!4d<lng> (place URL 의 핀 좌표)
  const dMatch = /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/.exec(url.href);
  if (dMatch) {
    const coord = parseLatLng(`${dMatch[1]},${dMatch[2]}`);
    if (coord) return buildEmbed(coord);
  }

  // 3) 쿼리 파라미터 q / query / ll — 좌표면 그대로, 검색어면 텍스트로 재구성
  for (const key of ["q", "query", "ll", "center"]) {
    const v = url.searchParams.get(key);
    if (!v) continue;
    const coord = parseLatLng(v);
    if (coord) return buildEmbed(coord);
    // 좌표 형태("숫자,숫자")인데 범위를 벗어났으면(parseLatLng null) 잘못된 위치 → 검색어 fallback 금지.
    if (/^\s*-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?\s*$/.test(v)) return null;
    // 검색어 텍스트(좌표 아님) — q 로만 재구성(주소·장소명). 빈/과도하게 긴 값은 스킵.
    if (key === "q" || key === "query") {
      const text = v.trim();
      if (text.length > 0 && text.length <= 200) return buildEmbed(text);
    }
  }

  // 4) /maps/place/<장소명>/ 형태 — 장소명 텍스트 추출
  const placeMatch = /\/maps\/place\/([^/@]+)/.exec(url.pathname);
  if (placeMatch) {
    const text = decodeSafe(placeMatch[1]).replace(/\+/g, " ").trim();
    if (text.length > 0 && text.length <= 200) return buildEmbed(text);
  }

  return null; // 추출 실패 → 임베드 생략(링크만)
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 좌표/검색어 → 임베드 URL. q 는 encodeURIComponent 로 안전 인코딩. */
function buildEmbed(q: string): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=15&output=embed`;
}

export interface MapEmbedProps {
  googleMapUrl: string | null | undefined;
  /** 외곽 래퍼 클래스(종횡비/여백은 호출부에서 조절) */
  className?: string;
  /** iframe title — 접근성. 부모가 i18n 라벨 주입(미주입 시 영문 기본). */
  title?: string;
}

/**
 * 변환 성공 시 16:9 반응형 박스 안 iframe 렌더. 실패 시 아무것도 렌더하지 않음(null).
 * 부모는 기존 "구글지도에서 열기" 외부 링크를 별도로 유지한다.
 */
export default function MapEmbed({ googleMapUrl, className, title }: MapEmbedProps) {
  const embedUrl = useMemo(() => toEmbedUrl(googleMapUrl), [googleMapUrl]);
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
