// lib/seo/resolve-map-url.ts — 구글맵 short URL(maps.app.goo.gl) → 좌표가 든 풀 URL 해석 (서버 전용)
//
// ★ 왜 필요한가: 운영자가 모바일 "공유"로 저장한 지도 링크는 항상 short URL이라 경로 해시에만 좌표가
//   있어 toEmbedUrl이 임베드를 만들지 못한다(임베드 생략 → 지도 안 뜸). 리다이렉트를 한 번 따라가면
//   `https://www.google.com/maps?q=<lat>,<lng>&...` 형태로 좌표가 드러나므로 그걸 받아 반환한다.
// ★ 보안: 구글 short 호스트만 fetch한다(임의 URL 추적 = SSRF 위험). 결과 호스트 검증은 toEmbedUrl의
//   화이트리스트가 최종 담당한다. 실패 시 원본을 그대로 반환(호출부에서 결국 임베드 null).
// ★ 캐시: 위치는 거의 안 바뀌므로 fetch를 7일 캐시(Next 데이터 캐시)로 중복 호출을 막는다.

const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);

function isGoogleShortUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && SHORT_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * short URL이면 리다이렉트를 따라가 좌표가 든 풀 URL을 반환한다. short URL이 아니면 원본 그대로.
 * 네트워크 실패·비-short는 원본 반환(멱등·안전).
 */
export async function resolveShortMapUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (!isGoogleShortUrl(url)) return url; // 이미 풀 URL이거나 비허용 → 그대로(toEmbedUrl이 판단)
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VillaGoBot/1.0)" },
      // 위치는 거의 불변 — 7일 캐시로 렌더마다 외부 호출하지 않는다.
      next: { revalidate: 604800 },
    });
    return res.url || url;
  } catch {
    return url;
  }
}
