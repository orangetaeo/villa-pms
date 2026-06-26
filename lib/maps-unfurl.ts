// lib/maps-unfurl.ts — 구글지도 링크 미리보기 추출(서버 전용, 링크 펼치기/unfurl).
//
// 배경: 글자(URL 텍스트)만 붙여넣어 보낸 지도 링크는 이미지가 없어 칩만 보인다(사용자 재요청).
//   장소 사진은 Zalo "장소 공유"에만 들어오고, 붙여넣은 링크엔 없다. 대신 서버가 링크를 열면
//   og:image(정적 지도 이미지)와 resolved URL의 장소명을 안정적으로 얻을 수 있다(2026-06-26 검증 3/3).
//   ※ 매장 실사진이 아니라 "위치 지도 이미지"다(og:image=maps staticmap, 서명 포함 공개 URL).
//
// SSRF 가드: isGoogleMapsUrl()인 입력만 fetch + 최종 호스트가 google/goo.gl일 때만 파싱. 12s 타임아웃·본문 크기 캡.
import { isGoogleMapsUrl } from "@/lib/chat-link-preview";

const FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const MAX_HTML_BYTES = 600_000;

export interface MapsUnfurl {
  /** og:image — 정적 지도 이미지 URL(서명 포함, 공개). 없으면 null. */
  image: string | null;
  /** resolved URL의 /place/<이름>에서 추출한 장소명. 없으면 null. */
  title: string | null;
}

/** HTML 엔티티 일부 디코드(og:image의 &amp; → &). 미리보기 URL 용도라 최소만. */
function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

/** <meta property="og:NAME" content="..."> 양방향(속성 순서 무관) 추출. 없으면 null. */
function matchMeta(html: string, prop: string): string | null {
  const a = html.match(
    new RegExp(`<meta[^>]+property=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i")
  );
  if (a) return a[1];
  const b = html.match(
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*property=["']${prop}["']`, "i")
  );
  return b ? b[1] : null;
}

/** resolved 구글지도 URL `/maps/place/<이름>/@...`에서 장소명 추출. 없으면 null. */
function placeNameFromUrl(resolvedUrl: string): string | null {
  const m = resolvedUrl.match(/\/place\/([^/@?]+)/);
  if (!m) return null;
  try {
    const name = decodeURIComponent(m[1]).replace(/\+/g, " ").trim();
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/** 최종 호스트가 google/goo.gl 계열인지 — 리다이렉트 후 외부 호스트로 새지 않았는지 확인(SSRF). */
function isTrustedFinalHost(finalUrl: string): boolean {
  try {
    const h = new URL(finalUrl).hostname.toLowerCase();
    return /(^|\.)google\.[a-z.]+$/.test(h) || /(^|\.)goo\.gl$/.test(h) || /(^|\.)google\.com$/.test(h);
  } catch {
    return false;
  }
}

/**
 * 구글지도 링크를 펼쳐 {image(정적 지도), title(장소명)} 추출. 지도 링크가 아니거나 실패하면 null.
 * image/title 둘 다 없을 수 있다(그땐 호출부가 칩 폴백). 네트워크 실패는 조용히 null.
 */
export async function unfurlMapsLink(url: string): Promise<MapsUnfurl | null> {
  if (!isGoogleMapsUrl(url)) return null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": FETCH_UA, "Accept-Language": "ko", Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    if (!isTrustedFinalHost(res.url)) return { image: null, title: null };
    const html = (await res.text()).slice(0, MAX_HTML_BYTES);
    const ogImage = matchMeta(html, "og:image");
    return {
      image: ogImage ? decodeEntities(ogImage) : null,
      title: placeNameFromUrl(res.url),
    };
  } catch {
    return null; // 타임아웃·네트워크 실패 — 칩 폴백
  }
}
