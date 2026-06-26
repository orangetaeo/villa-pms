// 채팅 링크/구글지도 미리보기 추출 — extractLinkPreview(순수).
// 실데이터 회귀 가드: 구글지도 장소 공유는 chat.photo(사진)+캡션=URL로 와서 msgType "photo"다.
import { describe, expect, it } from "vitest";
import { extractLinkPreview, isGoogleMapsUrl, getSoleMapsUrl } from "@/lib/chat-link-preview";

const IMG = "https://photo-stal-24.zdn.vn/no/abc.jpg";
const MAP = "https://maps.app.goo.gl/BAgmL37AV9o3v32NA";

describe("isGoogleMapsUrl", () => {
  it("구글지도 단축·정식 링크 인식", () => {
    expect(isGoogleMapsUrl(MAP)).toBe(true);
    expect(isGoogleMapsUrl("https://www.google.com/maps/place/x")).toBe(true);
    expect(isGoogleMapsUrl("https://goo.gl/maps/x")).toBe(true);
    expect(isGoogleMapsUrl("https://example.com")).toBe(false);
  });
});

describe("extractLinkPreview — photo + URL 캡션(구글지도 장소 공유)", () => {
  it("사진+지도URL 캡션 → 이미지=사진, url=지도, 제목 비움(도메인 폴백은 렌더)", () => {
    const r = extractLinkPreview("photo", MAP, [IMG]);
    expect(r).toEqual({ url: MAP, imageUrl: IMG, title: "", description: "" });
  });

  it("중복 URL 캡션('url\\nurl')도 1개 url·빈 제목", () => {
    const r = extractLinkPreview("photo", `${MAP}\n${MAP}`, [IMG]);
    expect(r?.url).toBe(MAP);
    expect(r?.title).toBe("");
  });

  it("지도 링크 + 설명 텍스트 → 제목에 설명 보존", () => {
    const r = extractLinkPreview("photo", `JUSTSHOES 가게\n${MAP}`, [IMG]);
    expect(r?.url).toBe(MAP);
    expect(r?.title).toBe("JUSTSHOES 가게");
    expect(r?.imageUrl).toBe(IMG);
  });

  it("일반 사진 + 잡담 캡션(지도 아닌 URL) → null(사진 그대로)", () => {
    const r = extractLinkPreview("photo", "이거 봐 https://example.com 좋지?", [IMG]);
    expect(r).toBeNull();
  });

  it("URL 없는 일반 사진 → null", () => {
    expect(extractLinkPreview("photo", "그냥 사진", [IMG])).toBeNull();
  });

  it("사진 여러 장(앨범)은 링크 카드로 안 봄 → null", () => {
    expect(extractLinkPreview("photo", MAP, [IMG, IMG])).toBeNull();
  });
});

describe("extractLinkPreview — msgType 'link'(recommended 공유)", () => {
  it("attachmentUrls[0]=url·[1]=썸네일, text='제목\\n설명'", () => {
    const r = extractLinkPreview("link", "JUSTSHOES\n★★★★☆ · 신발가게", [MAP, IMG]);
    expect(r).toEqual({ url: MAP, imageUrl: IMG, title: "JUSTSHOES", description: "★★★★☆ · 신발가게" });
  });
  it("썸네일 없으면 imageUrl=null", () => {
    const r = extractLinkPreview("link", "제목", [MAP]);
    expect(r?.imageUrl).toBeNull();
  });
  it("url 없으면 null", () => {
    expect(extractLinkPreview("link", "제목", [])).toBeNull();
  });
});

describe("extractLinkPreview — 그 외 타입", () => {
  it("text 타입은 null(인라인 URL은 RichText/MapsLinkPreview가 처리)", () => {
    expect(extractLinkPreview("text", MAP, [])).toBeNull();
  });
});

describe("getSoleMapsUrl — 글자만 보낸 지도 링크 판별(unfurl 카드 대상)", () => {
  it("지도 URL 하나뿐이면 그 URL", () => {
    expect(getSoleMapsUrl(MAP)).toBe(MAP);
    expect(getSoleMapsUrl(`  ${MAP}  `)).toBe(MAP);
  });
  it("중복으로 두 번 붙어도 URL(나머지 텍스트 없음)", () => {
    expect(getSoleMapsUrl(`${MAP} ${MAP}`)).toBe(MAP);
  });
  it("지도 URL + 다른 텍스트 → null(일반 메시지, RichText가 칩 처리)", () => {
    expect(getSoleMapsUrl(`여기야 ${MAP}`)).toBeNull();
  });
  it("지도 아닌 URL → null", () => {
    expect(getSoleMapsUrl("https://example.com")).toBeNull();
  });
  it("URL 없음 → null", () => {
    expect(getSoleMapsUrl("그냥 텍스트")).toBeNull();
    expect(getSoleMapsUrl("")).toBeNull();
  });
});
