// 링크/구글지도 공유 → "link" 카드 분류 + 답글·리액션 가능(canInteract) 매핑.
import { describe, expect, it } from "vitest";
import { classifyInbound } from "@/lib/zalo-inbound";
import { toChatMessages, type ChatMessageRow } from "@/lib/zalo-chat-message";
import { ZaloMessageDirection, ZaloMessageSource } from "@prisma/client";

describe("classifyInbound — 링크/지도 공유 → link 카드", () => {
  it("chat.link + URL + 썸네일 → link, attachmentUrls=[url, thumb], text='제목\\n설명'", () => {
    const r = classifyInbound(
      {
        title: "JUSTSHOES · SONASEA",
        description: "★★★★☆ · Cửa hàng giày dép",
        href: "https://maps.app.goo.gl/BAgmL37AV9o3v32NA",
        thumb: "https://cdn.example/thumb.jpg",
      },
      "chat.link"
    );
    expect(r.msgType).toBe("link");
    expect(r.attachmentUrls).toEqual([
      "https://maps.app.goo.gl/BAgmL37AV9o3v32NA",
      "https://cdn.example/thumb.jpg",
    ]);
    expect(r.text).toBe("JUSTSHOES · SONASEA\n★★★★☆ · Cửa hàng giày dép");
  });

  it("recommended(구글지도) + http URL + 연락처식별자 없음 → link", () => {
    const r = classifyInbound(
      { name: "어떤 카페", href: "https://goo.gl/maps/abc", thumb: "https://cdn/x.jpg" },
      "chat.recommended"
    );
    expect(r.msgType).toBe("link");
    expect(r.attachmentUrls[0]).toBe("https://goo.gl/maps/abc");
  });

  it("썸네일 없으면 attachmentUrls=[url]만", () => {
    const r = classifyInbound({ title: "사이트", href: "https://example.com" }, "chat.link");
    expect(r.msgType).toBe("link");
    expect(r.attachmentUrls).toEqual(["https://example.com"]);
  });

  it("URL 없는 chat.link는 텍스트 폴백(link 아님)", () => {
    const r = classifyInbound({ title: "제목만" }, "chat.link");
    expect(r.msgType).toBe("text");
  });

  it("연락처 식별자(phone) 있으면 네임카드(contact) — link 아님", () => {
    const r = classifyInbound(
      { name: "홍길동", phone: "0901234567", href: "https://zalo.me/x" },
      "chat.recommended"
    );
    expect(r.msgType).toBe("contact");
  });

  it("제목과 설명이 같으면 설명 줄 생략(중복 방지)", () => {
    const r = classifyInbound(
      { title: "같은값", description: "같은값", href: "https://a.b/c" },
      "chat.link"
    );
    expect(r.text).toBe("같은값");
  });
});

describe("toChatMessages — canInteract(답글·리액션 가능)", () => {
  function row(over: Partial<ChatMessageRow>): ChatMessageRow {
    return {
      id: "m1",
      direction: ZaloMessageDirection.INBOUND,
      source: ZaloMessageSource.USER,
      msgType: "text",
      senderUid: null,
      text: "hi",
      translatedText: null,
      attachmentUrls: [],
      status: "SENT",
      createdAt: new Date("2026-06-26T10:00:00Z"),
      zaloMsgId: "z1",
      quotedMsgId: null,
      quotedText: null,
      quotedSender: null,
      reactions: null,
      ...over,
    };
  }
  const opts = {
    isGroup: false,
    memberMap: new Map(),
    headerAvatarUrl: null,
    headerInitials: "?",
  };

  it("cliMsgId + zaloMsgId 둘 다 있으면 canInteract=true", () => {
    const [dto] = toChatMessages([row({ cliMsgId: "c1", zaloMsgId: "z1" })], opts);
    expect(dto.canInteract).toBe(true);
  });
  it("cliMsgId 없으면 false(옛 메시지 — 답글·리액션 버튼 숨김)", () => {
    const [dto] = toChatMessages([row({ cliMsgId: null, zaloMsgId: "z1" })], opts);
    expect(dto.canInteract).toBe(false);
  });
  it("zaloMsgId 없으면 false", () => {
    const [dto] = toChatMessages([row({ cliMsgId: "c1", zaloMsgId: null })], opts);
    expect(dto.canInteract).toBe(false);
  });
});
