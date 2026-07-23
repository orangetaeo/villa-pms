// components/villa/map-embed-url.ts — 지도 임베드 URL 변환 (순수 함수 층, "use client" 없음)
//
// map-embed.tsx(클라이언트 컴포넌트)에서 분리했다: JSX 없는 순수 로직이라 서버·테스트에서 직접 import.
// 보안(SSRF/오용 방지): 호스트 화이트리스트 + https:// 만 허용. 그 외/파싱 실패 → null.
// short URL(goo.gl / maps.app.goo.gl)은 리다이렉트 전이라 좌표 추출 불가 → null(부모의 외부 링크만 유지).

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

/** toEmbedUrl 옵션 — approximate=true면 좌표를 뭉개고 줌을 낮춰 "대략 위치"만 노출(제안 링크용). */
export interface ToEmbedOptions {
  /**
   * 대략 위치 모드. 비로그인 제안 열람자에게 건물 단위 핀을 주면 공급자 특정 → 우회예약 위험(원칙1).
   * 좌표를 소수 2자리(≈1km 격자)로 반올림하고 줌을 낮춰 "이 동네"까지만 보여준다. 검색어(장소명)는
   * 이미 넓은 범위라 그대로 두되 줌만 낮춘다.
   */
  approximate?: boolean;
}

/**
 * googleMapUrl → 임베드 가능한 URL(`https://maps.google.com/maps?q=...&z=15&output=embed`).
 * 변환 불가(비허용 호스트·비-https·좌표/검색어 추출 실패·short URL)면 null.
 * opts.approximate=true면 좌표를 뭉개고 줌을 낮춘다(대략 위치).
 */
export function toEmbedUrl(
  googleMapUrl: string | null | undefined,
  opts: ToEmbedOptions = {}
): string | null {
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

  const approx = opts.approximate === true;

  // 1) path 의 @lat,lng (예: /maps/place/.../@10.123,103.456,15z)
  const atMatch = /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/.exec(url.pathname + url.search);
  if (atMatch) {
    const coord = parseLatLng(`${atMatch[1]},${atMatch[2]}`);
    if (coord) return buildEmbed(coordForMode(coord, approx), approx);
  }

  // 2) data 파라미터 !3d<lat>!4d<lng> (place URL 의 핀 좌표)
  const dMatch = /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/.exec(url.href);
  if (dMatch) {
    const coord = parseLatLng(`${dMatch[1]},${dMatch[2]}`);
    if (coord) return buildEmbed(coordForMode(coord, approx), approx);
  }

  // 3) 쿼리 파라미터 q / query / ll — 좌표면 그대로, 검색어면 텍스트로 재구성
  for (const key of ["q", "query", "ll", "center"]) {
    const v = url.searchParams.get(key);
    if (!v) continue;
    const coord = parseLatLng(v);
    if (coord) return buildEmbed(coordForMode(coord, approx), approx);
    // 좌표 형태("숫자,숫자")인데 범위를 벗어났으면(parseLatLng null) 잘못된 위치 → 검색어 fallback 금지.
    if (/^\s*-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?\s*$/.test(v)) return null;
    // 검색어 텍스트(좌표 아님) — q 로만 재구성(주소·장소명). 빈/과도하게 긴 값은 스킵.
    if (key === "q" || key === "query") {
      const text = v.trim();
      if (text.length > 0 && text.length <= 200) return buildEmbed(text, approx);
    }
  }

  // 4) /maps/place/<장소명>/ 형태 — 장소명 텍스트 추출
  const placeMatch = /\/maps\/place\/([^/@]+)/.exec(url.pathname);
  if (placeMatch) {
    const text = decodeSafe(placeMatch[1]).replace(/\+/g, " ").trim();
    if (text.length > 0 && text.length <= 200) return buildEmbed(text, approx);
  }

  return null; // 추출 실패 → 임베드 생략(링크만)
}

/**
 * 대략 위치 모드면 "lat,lng" 좌표를 소수 2자리로 반올림(≈1.1km 격자)해 건물 특정 불가하게 만든다.
 * 정밀 모드면 원본 그대로. 좌표가 아니면(검색어) 호출되지 않는다.
 */
function coordForMode(coord: string, approximate: boolean): string {
  if (!approximate) return coord;
  const [lat, lng] = coord.split(",").map(Number);
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 좌표/검색어 → 임베드 URL. q 는 encodeURIComponent 로 안전 인코딩. 대략 모드는 줌을 낮춘다. */
function buildEmbed(q: string, approximate = false): string {
  const z = approximate ? 13 : 15; // 13=동네 단위, 15=건물 단위
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=${z}&output=embed`;
}
