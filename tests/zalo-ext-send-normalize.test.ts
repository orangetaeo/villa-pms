// [QA — Nike→villa 발송 500 버그 수정 / ADR-0010] ext/send threadId 정규화 검증.
//
// 버그: Nike가 A2 threads DTO의 `id`(villa 내부 cuid)를 threadId로 보냄 → zca-js가 Zalo uid로
//       해석 → cuid는 유효 uid 아님 → SEND_ERROR → 502 → Nike POST 500.
// 수정: 발송 직전 threadId를 테오 스코프 conversation의 실제 zaloUserId로 정규화.
//
// 본 테스트는 stateful prisma mock으로 다음을 실증한다:
//   1. cuid(=conversation.id)로 들어오면 zaloUserId로 정규화되어 발송.
//   2. 진짜 zaloUserId로 들어와도 zaloUserId로(동일 주소) 발송.
//   3. 매칭 실패(미존재 threadId)는 하위호환으로 threadId 그대로 발송(방어).
//   4. 타 관리자 conversation의 cuid는 테오 스코프에서 매칭 안 됨 → 정규화 안 됨(누수 0).
//   5. 정규화는 전 kind(TEXT/IMAGE/REPLY/FORWARD/REACTION)에 적용.
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── 시크릿 게이트·테오 ownerAdminId 결정은 통과로 고정(정규화 로직에 집중) ──
vi.mock("@/lib/zalo-ext-auth", () => ({
  isExtSecretValid: () => true,
  resolveSystemOwnerId: async () => "theo", // 테오(시스템봇 소유자)
}));

// ── 발송 런타임 mock — 호출 인자(특히 threadId)를 캡처 ──
const mockSendText = vi.fn(async (..._a: unknown[]) => ({ ok: true, messageId: "z-text" }));
const mockSendImage = vi.fn(async (..._a: unknown[]) => ({ ok: true, messageId: "z-img" }));
const mockSendReply = vi.fn(async (..._a: unknown[]) => ({ ok: true, messageId: "z-reply" }));
const mockSendForward = vi.fn(async (..._a: unknown[]) => ({ ok: true, messageId: "z-fwd" }));
const mockReaction = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/lib/zalo-runtime", () => ({
  sendChatMessageAsAdmin: (...a: unknown[]) => mockSendText(...a),
  sendChatImageAsAdmin: (...a: unknown[]) => mockSendImage(...a),
  sendChatReplyAsAdmin: (...a: unknown[]) => mockSendReply(...a),
  sendChatForwardAsAdmin: (...a: unknown[]) => mockSendForward(...a),
  addReactionAsAdmin: (...a: unknown[]) => mockReaction(...a),
  REACTION_KEYS: ["HEART", "LIKE"],
}));

// ── stateful 대화 저장소: {ownerAdminId, id, zaloUserId} ──
const CONVS = [
  { ownerAdminId: "theo", id: "cuid-theo-1", zaloUserId: "3405637163672158317" },
  { ownerAdminId: "adminB", id: "cuid-other-1", zaloUserId: "zu-otherB" },
];

// findFirst({ where: { ownerAdminId, OR: [{id},{zaloUserId}] } }) 를 실제로 평가
function matchConv(where: {
  ownerAdminId?: string;
  OR?: Array<{ id?: string; zaloUserId?: string }>;
}) {
  const c = CONVS.find((row) => {
    if (where.ownerAdminId && row.ownerAdminId !== where.ownerAdminId) return false;
    if (where.OR) {
      return where.OR.some(
        (o) =>
          (o.id !== undefined && o.id === row.id) ||
          (o.zaloUserId !== undefined && o.zaloUserId === row.zaloUserId)
      );
    }
    return true;
  });
  return c ? { zaloUserId: c.zaloUserId } : null;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    zaloConversation: {
      findFirst: vi.fn(async (arg: { where: Parameters<typeof matchConv>[0] }) =>
        matchConv(arg.where)
      ),
    },
  },
}));

import { POST as sendPost } from "@/app/api/zalo/ext/send/route";

const sendReq = (body: unknown) =>
  sendPost(
    new Request("http://local/api/zalo/ext/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-zalo-ext-secret": "x" },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ext/send threadId 정규화 (Nike→villa 발송 500 버그 수정)", () => {
  it("cuid → zaloUserId 정규화: TEXT 발송이 실제 zaloUserId로 나간다", async () => {
    const res = await sendReq({ kind: "TEXT", threadId: "cuid-theo-1", text: "안녕" });
    expect(res.status).toBe(200);
    expect(mockSendText).toHaveBeenCalledWith("theo", "3405637163672158317", "안녕");
  });

  it("zaloUserId → 그대로: 진짜 uid로 들어오면 동일 uid로 발송", async () => {
    const res = await sendReq({
      kind: "TEXT",
      threadId: "3405637163672158317",
      text: "hi",
    });
    expect(res.status).toBe(200);
    expect(mockSendText).toHaveBeenCalledWith("theo", "3405637163672158317", "hi");
  });

  it("미존재 threadId → 하위호환: threadId 그대로 발송(방어)", async () => {
    const res = await sendReq({ kind: "TEXT", threadId: "unknown-xyz", text: "y" });
    expect(res.status).toBe(200);
    expect(mockSendText).toHaveBeenCalledWith("theo", "unknown-xyz", "y");
  });

  it("타 관리자 cuid → 테오 스코프 매칭 안 됨, 정규화 안 됨(누수 0)", async () => {
    // adminB의 cuid를 보내도 ownerAdminId=theo 조건으로 매칭 실패 → threadId 그대로(타인 uid 미해석)
    const res = await sendReq({ kind: "TEXT", threadId: "cuid-other-1", text: "엿보기" });
    expect(res.status).toBe(200);
    // adminB의 zaloUserId(zu-otherB)로 정규화되지 않음 — 들어온 값 그대로
    expect(mockSendText).toHaveBeenCalledWith("theo", "cuid-other-1", "엿보기");
    expect(mockSendText).not.toHaveBeenCalledWith("theo", "zu-otherB", "엿보기");
  });

  it("IMAGE 발송도 정규화 적용", async () => {
    const res = await sendReq({
      kind: "IMAGE",
      threadId: "cuid-theo-1",
      imageBase64: Buffer.from("png").toString("base64"),
      fileName: "a.png",
    });
    expect(res.status).toBe(200);
    expect(mockSendImage.mock.calls[0][1]).toBe("3405637163672158317");
  });

  it("REPLY 발송도 정규화 적용", async () => {
    const res = await sendReq({
      kind: "REPLY",
      threadId: "cuid-theo-1",
      text: "답글",
      quote: { zaloMsgId: "m1", cliMsgId: "c1", content: "원문", uidFrom: "u1" },
    });
    expect(res.status).toBe(200);
    expect(mockSendReply.mock.calls[0][1]).toBe("3405637163672158317");
  });

  it("FORWARD 발송도 정규화 적용", async () => {
    const res = await sendReq({
      kind: "FORWARD",
      threadId: "cuid-theo-1",
      message: "전달본문",
    });
    expect(res.status).toBe(200);
    expect(mockSendForward.mock.calls[0][1]).toBe("3405637163672158317");
  });

  it("REACTION 발송도 정규화 적용", async () => {
    const res = await sendReq({
      kind: "REACTION",
      threadId: "cuid-theo-1",
      target: { zaloMsgId: "m1", cliMsgId: "c1" },
      iconKey: "HEART",
    });
    expect(res.status).toBe(200);
    expect(mockReaction.mock.calls[0][1]).toBe("3405637163672158317");
  });
});
