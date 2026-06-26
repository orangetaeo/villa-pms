// lib/chat-link-preview.ts — 채팅 링크/구글지도 미리보기 추출 (순수 함수, 단위 테스트 대상).
//
// 구글지도 장소 공유는 Zalo가 두 가지로 보낸다:
//   1) recommended/chat.link → msgType "link"(zalo-inbound makeLinkCard: attachmentUrls[0]=URL·[1]=썸네일).
//   2) chat.photo(장소 사진) + 캡션=URL → msgType "photo". ★실데이터 대부분이 이 형태(2026-06-26 관측).
// 둘 다 "이미지+제목+URL" 카드로 렌더하기 위해, 메시지에서 미리보기 필드를 한 곳에서 추출한다.

/** 본문 내 http(s) URL 탐지. 끝의 문장부호는 URL_TRAILING_RE로 따로 다듬는다. */
export const URL_RE = /(https?:\/\/[^\s]+)/g;
/** URL 끝에 붙은 문장부호 — 링크에서 제외(괄호로 감싼 링크·문장 끝 마침표 대응). */
export const URL_TRAILING_RE = /[.,;:!?)\]}"'»]+$/;

/** 구글지도 공유 링크인지(지도 앱으로 바로 열리는 URL). 짧은 링크(goo.gl/maps·maps.app.goo.gl) 포함. */
export function isGoogleMapsUrl(url: string): boolean {
  return /(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|goo\.gl\/maps|maps\.app\.goo\.gl|g\.co\/maps)/i.test(
    url
  );
}

/** 링크 미리보기 카드 입력 — url(필수)·이미지·제목·설명. */
export interface LinkPreview {
  url: string;
  imageUrl: string | null;
  title: string;
  description: string;
}

const stripTrailing = (u: string) => u.replace(URL_TRAILING_RE, "");

/**
 * 메시지(타입·본문·첨부)에서 링크 미리보기를 추출. 링크 카드로 볼 게 아니면 null.
 *  - "link": attachmentUrls[0]=URL·[1]=썸네일, text="제목\n설명".
 *  - "photo" + 캡션 URL: 이미지=첨부 사진, URL=캡션 링크, 제목=캡션에서 URL 제거분.
 *    지도 링크이거나 캡션이 사실상 URL뿐일 때만(일반 사진의 잡담 캡션은 사진 그대로 두려고 null).
 *  - 캡션의 중복 URL("url url")은 1개로. 끝 문장부호는 링크에서 제외.
 */
export function extractLinkPreview(
  msgType: string,
  text: string | null | undefined,
  attachmentUrls: string[]
): LinkPreview | null {
  const body = text ?? "";
  if (msgType === "link") {
    const url = stripTrailing(attachmentUrls[0] ?? "");
    if (!url) return null;
    const lines = body
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      url,
      imageUrl: attachmentUrls[1] ?? null,
      title: lines[0] ?? "",
      description: lines.slice(1).join(" "),
    };
  }
  if (msgType === "photo" && attachmentUrls.length === 1) {
    const matches = body.match(URL_RE);
    if (!matches || matches.length === 0) return null;
    const url = stripTrailing(matches.find((u) => isGoogleMapsUrl(u)) ?? matches[0]);
    const cleaned = body.replace(URL_RE, " ").replace(/\s+/g, " ").trim();
    // 지도 링크가 아니고 캡션에 실제 텍스트가 남으면 일반 사진으로 둔다(잡담 캡션 보호).
    if (!isGoogleMapsUrl(url) && cleaned.length > 0) return null;
    return { url, imageUrl: attachmentUrls[0], title: cleaned, description: "" };
  }
  return null;
}
