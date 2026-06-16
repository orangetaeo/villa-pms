import { beforeEach, describe, expect, it, vi } from "vitest";

// ── mocks ─────────────────────────────────────────────────────────────
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const mockSendBotMessage = vi.fn();
vi.mock("@/lib/zalo-runtime", () => ({
  sendBotMessage: (...a: unknown[]) => mockSendBotMessage(...a),
}));

const mockTranslateText = vi.fn();
vi.mock("@/lib/gemini", () => {
  class FakeGeminiNotConfigured extends Error {
    constructor() {
      super("not configured");
      this.name = "GeminiNotConfiguredError";
    }
  }
  return {
    translateText: (...a: unknown[]) => mockTranslateText(...a),
    GeminiNotConfiguredError: FakeGeminiNotConfigured,
  };
});

interface ZaloMsgCreateArg {
  data: {
    direction: string;
    source: string;
    status: string;
    error: string | null;
    sentBy: string;
    zaloMsgId: string | null;
    text: string;
  };
}
const tx = {
  zaloMessage: {
    create: vi.fn(async (_arg: ZaloMsgCreateArg) => ({
      id: "m1",
      status: "SENT",
      createdAt: new Date("2026-06-16T10:00:00Z"),
    })),
  },
  zaloConversation: { update: vi.fn(async () => ({})) },
};
const mockConvFindUnique = vi.fn();
const mockConvUpdateMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    zaloConversation: {
      findUnique: (...a: unknown[]) => mockConvFindUnique(...a),
      updateMany: (...a: unknown[]) => mockConvUpdateMany(...a),
    },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

import { writeAuditLog } from "@/lib/audit-log";
import { GeminiNotConfiguredError as FakeGeminiNotConfigured } from "@/lib/gemini";
import { POST as sendPost } from "@/app/api/zalo/messages/route";
import { POST as translatePost } from "@/app/api/zalo/translate/route";
import { PATCH as convPatch } from "@/app/api/zalo/conversations/[id]/route";

const ADMIN = { user: { id: "admin1", role: "ADMIN" } };
const SUPPLIER = { user: { id: "s1", role: "SUPPLIER" } };

const sendReq = (body: unknown) =>
  sendPost(
    new Request("http://local/api/zalo/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

const translateReq = (body: unknown) =>
  translatePost(
    new Request("http://local/api/zalo/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

const convReq = (id: string, body: unknown) =>
  convPatch(
    new Request(`http://local/api/zalo/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockConvFindUnique.mockResolvedValue({
    id: "c1",
    zaloUserId: "zu1",
  });
  mockConvUpdateMany.mockResolvedValue({ count: 1 });
  // 기본: 봇 연결됨 + 발송 성공
  mockSendBotMessage.mockResolvedValue({ ok: true, messageId: "zmsg1" });
  tx.zaloMessage.create.mockResolvedValue({
    id: "m1",
    status: "SENT",
    createdAt: new Date("2026-06-16T10:00:00Z"),
  });
});

// ── POST /api/zalo/messages ───────────────────────────────────────────
describe("POST /api/zalo/messages — 발신 (T6.6)", () => {
  it("비로그인 401 / SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await sendReq({ conversationId: "c1", text: "안녕" })).status).toBe(401);
    mockAuth.mockResolvedValue(SUPPLIER);
    expect((await sendReq({ conversationId: "c1", text: "안녕" })).status).toBe(403);
  });

  it("빈 텍스트 400", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    expect((await sendReq({ conversationId: "c1", text: "   " })).status).toBe(400);
    expect((await sendReq({ conversationId: "c1" })).status).toBe(400);
  });

  it("미존재 대화 404", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockConvFindUnique.mockResolvedValue(null);
    expect((await sendReq({ conversationId: "x", text: "안녕" })).status).toBe(404);
  });

  it("48h 가드 제거(D5.5) — 수신 이력과 무관하게 항상 발신 가능(영속됨)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await sendReq({ conversationId: "c1", text: "안녕" });
    expect(res.status).toBe(200);
    expect(tx.zaloMessage.create).toHaveBeenCalled();
  });

  it("성공: 봇 연결 + 발송 OK → OUTBOUND CHAT SENT 적재 + lastMessageAt 갱신 + AuditLog", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockSendBotMessage.mockResolvedValue({ ok: true, messageId: "zmsg1" });
    const res = await sendReq({ conversationId: "c1", text: "확인했습니다" });
    expect(res.status).toBe(200);
    const data = tx.zaloMessage.create.mock.calls[0]![0].data;
    expect(data.direction).toBe("OUTBOUND");
    expect(data.source).toBe("CHAT");
    expect(data.status).toBe("SENT");
    expect(data.sentBy).toBe("admin1");
    expect(data.zaloMsgId).toBe("zmsg1");
    expect(mockSendBotMessage).toHaveBeenCalledWith("zu1", "확인했습니다");
    expect(tx.zaloConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" }, data: { lastMessageAt: expect.any(Date) } })
    );
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalled();
  });

  it("봇 미연결 → FAILED 기록하되 200 (500 금지)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockSendBotMessage.mockResolvedValue({ ok: false, error: "BOT_NOT_CONNECTED" });
    const res = await sendReq({ conversationId: "c1", text: "확인" });
    expect(res.status).toBe(200);
    const data = tx.zaloMessage.create.mock.calls[0]![0].data;
    expect(data.status).toBe("FAILED");
    expect(data.error).toBe("BOT_NOT_CONNECTED");
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalled();
  });

  it("발송 실패(타임아웃 등) → FAILED 기록 + 200", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockSendBotMessage.mockResolvedValue({ ok: false, error: "SEND_ERROR: timeout" });
    const res = await sendReq({ conversationId: "c1", text: "확인" });
    expect(res.status).toBe(200);
    const data = tx.zaloMessage.create.mock.calls[0]![0].data;
    expect(data.status).toBe("FAILED");
    expect(data.error).toBe("SEND_ERROR: timeout");
  });

  it("발신 본문에 마진·판매가 미포함 (text 그대로만 적재)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockSendBotMessage.mockResolvedValue({ ok: true, messageId: null });
    await sendReq({ conversationId: "c1", text: "내일 청소 부탁드립니다" });
    const data = tx.zaloMessage.create.mock.calls[0]![0].data;
    expect(data.text).toBe("내일 청소 부탁드립니다");
    expect(JSON.stringify(data)).not.toMatch(/margin|salePrice|krw/i);
  });
});

// ── POST /api/zalo/translate ──────────────────────────────────────────
describe("POST /api/zalo/translate — 번역 (T6.6)", () => {
  it("비로그인 401 / SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await translateReq({ text: "안녕", target: "vi" })).status).toBe(401);
    mockAuth.mockResolvedValue(SUPPLIER);
    expect((await translateReq({ text: "안녕", target: "vi" })).status).toBe(403);
  });

  it("빈 텍스트/잘못된 target 400", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    expect((await translateReq({ text: "", target: "vi" })).status).toBe(400);
    expect((await translateReq({ text: "안녕", target: "xx" })).status).toBe(400);
  });

  it("정상: vi 반환", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockTranslateText.mockResolvedValue("Xin chào");
    const res = await translateReq({ text: "안녕하세요", target: "vi" });
    expect(res.status).toBe(200);
    expect((await res.json()).translated).toBe("Xin chào");
  });

  it("Gemini 미설정 503", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockTranslateText.mockRejectedValue(new FakeGeminiNotConfigured());
    const res = await translateReq({ text: "안녕", target: "vi" });
    expect(res.status).toBe(503);
  });
});

// ── PATCH /api/zalo/conversations/[id] ────────────────────────────────
describe("PATCH /api/zalo/conversations/[id] — 읽음 처리 (T6.6)", () => {
  it("비로그인 401 / SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await convReq("c1", { action: "MARK_READ" })).status).toBe(401);
    mockAuth.mockResolvedValue(SUPPLIER);
    expect((await convReq("c1", { action: "MARK_READ" })).status).toBe(403);
  });

  it("잘못된 action 400", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    expect((await convReq("c1", { action: "WHATEVER" })).status).toBe(400);
  });

  it("성공: unreadCount=0 + 멱등(재호출도 200)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res1 = await convReq("c1", { action: "MARK_READ" });
    expect(res1.status).toBe(200);
    expect(mockConvUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" }, data: { unreadCount: 0 } })
    );
    const res2 = await convReq("c1", { action: "MARK_READ" });
    expect(res2.status).toBe(200);
  });

  it("미존재 대화 404", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockConvUpdateMany.mockResolvedValue({ count: 0 });
    expect((await convReq("nope", { action: "MARK_READ" })).status).toBe(404);
  });
});
