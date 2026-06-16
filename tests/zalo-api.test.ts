import { beforeEach, describe, expect, it, vi } from "vitest";

// ── mocks ─────────────────────────────────────────────────────────────
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const mockSendChat = vi.fn();
vi.mock("@/lib/zalo-runtime", () => ({
  // ADR-0007: 채팅 발송은 sendChatMessageAsAdmin(본인 계정). 시스템 발송 sendBotMessage와 분리.
  sendChatMessageAsAdmin: (...a: unknown[]) => mockSendChat(...a),
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
    // ADR-0009 D7.4 — 실제 매핑을 그대로 사용(순수 함수, 모킹 불필요)
    previewTargetForMode: (mode: string) =>
      mode === "VI" ? "vi" : mode === "EN" ? "en" : null,
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
const mockConvFindFirst = vi.fn();
const mockConvUpdateMany = vi.fn();
const mockConvUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    zaloConversation: {
      findFirst: (...a: unknown[]) => mockConvFindFirst(...a),
      updateMany: (...a: unknown[]) => mockConvUpdateMany(...a),
      update: (...a: unknown[]) => mockConvUpdate(...a),
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
  mockConvFindFirst.mockResolvedValue({
    id: "c1",
    zaloUserId: "zu1",
  });
  mockConvUpdateMany.mockResolvedValue({ count: 1 });
  mockConvUpdate.mockResolvedValue({});
  // 기본: 봇 연결됨 + 발송 성공
  mockSendChat.mockResolvedValue({ ok: true, messageId: "zmsg1" });
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
    mockConvFindFirst.mockResolvedValue(null);
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
    mockSendChat.mockResolvedValue({ ok: true, messageId: "zmsg1" });
    const res = await sendReq({ conversationId: "c1", text: "확인했습니다" });
    expect(res.status).toBe(200);
    const data = tx.zaloMessage.create.mock.calls[0]![0].data;
    expect(data.direction).toBe("OUTBOUND");
    expect(data.source).toBe("CHAT");
    expect(data.status).toBe("SENT");
    expect(data.sentBy).toBe("admin1");
    expect(data.zaloMsgId).toBe("zmsg1");
    // ADR-0007: 본인 계정으로 발송 (adminUserId, zaloUserId, text)
    expect(mockSendChat).toHaveBeenCalledWith("admin1", "zu1", "확인했습니다");
    // 소유 스코프 — findFirst where에 ownerAdminId 포함 (누수 차단)
    expect(mockConvFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1", ownerAdminId: "admin1" },
      })
    );
    expect(tx.zaloConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" }, data: { lastMessageAt: expect.any(Date) } })
    );
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalled();
  });

  it("봇 미연결 → FAILED 기록하되 200 (500 금지)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockSendChat.mockResolvedValue({ ok: false, error: "BOT_NOT_CONNECTED" });
    const res = await sendReq({ conversationId: "c1", text: "확인" });
    expect(res.status).toBe(200);
    const data = tx.zaloMessage.create.mock.calls[0]![0].data;
    expect(data.status).toBe("FAILED");
    expect(data.error).toBe("BOT_NOT_CONNECTED");
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalled();
  });

  it("발송 실패(타임아웃 등) → FAILED 기록 + 200", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockSendChat.mockResolvedValue({ ok: false, error: "SEND_ERROR: timeout" });
    const res = await sendReq({ conversationId: "c1", text: "확인" });
    expect(res.status).toBe(200);
    const data = tx.zaloMessage.create.mock.calls[0]![0].data;
    expect(data.status).toBe("FAILED");
    expect(data.error).toBe("SEND_ERROR: timeout");
  });

  it("발신 본문에 마진·판매가 미포함 (text 그대로만 적재)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockSendChat.mockResolvedValue({ ok: true, messageId: null });
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

// ── POST /api/zalo/translate — ADR-0009 S5 (대화 모드 기반) ────────────
describe("POST /api/zalo/translate — 대화 translateMode 기반 (ADR-0009 S5)", () => {
  it("conversationId + VI → ko→vi 번역 (target=vi)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockConvFindFirst.mockResolvedValue({ translateMode: "VI" });
    mockTranslateText.mockResolvedValue("Xin chào");
    const res = await translateReq({ text: "안녕하세요", conversationId: "c1" });
    expect(res.status).toBe(200);
    expect((await res.json()).translated).toBe("Xin chào");
    expect(mockTranslateText).toHaveBeenCalledWith("안녕하세요", "vi");
    // 본인 대화 게이트 — ownerAdminId 포함 (누수 차단)
    expect(mockConvFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1", ownerAdminId: "admin1" } })
    );
  });

  it("conversationId + EN → ko→en 번역 (target=en)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockConvFindFirst.mockResolvedValue({ translateMode: "EN" });
    mockTranslateText.mockResolvedValue("Hello");
    const res = await translateReq({ text: "안녕", conversationId: "c1" });
    expect(res.status).toBe(200);
    expect(mockTranslateText).toHaveBeenCalledWith("안녕", "en");
  });

  it("conversationId + OFF → 미리보기 없음(Gemini 호출 0, 빈 응답)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockConvFindFirst.mockResolvedValue({ translateMode: "OFF" });
    const res = await translateReq({ text: "안녕", conversationId: "c1" });
    expect(res.status).toBe(200);
    expect((await res.json()).translated).toBe("");
    expect(mockTranslateText).not.toHaveBeenCalled();
  });

  it("conversationId 타인/미존재 대화 404 (Gemini 호출 0)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockConvFindFirst.mockResolvedValue(null);
    const res = await translateReq({ text: "안녕", conversationId: "x" });
    expect(res.status).toBe(404);
    expect(mockTranslateText).not.toHaveBeenCalled();
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
      expect.objectContaining({
        where: { id: "c1", ownerAdminId: "admin1" },
        data: { unreadCount: 0 },
      })
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

// ── PATCH SET_TRANSLATE_MODE (ADR-0009 S5/D7.5) ───────────────────────
describe("PATCH /api/zalo/conversations/[id] — SET_TRANSLATE_MODE", () => {
  it("비로그인 401 / SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue(null);
    expect(
      (await convReq("c1", { action: "SET_TRANSLATE_MODE", mode: "VI" })).status
    ).toBe(401);
    mockAuth.mockResolvedValue(SUPPLIER);
    expect(
      (await convReq("c1", { action: "SET_TRANSLATE_MODE", mode: "VI" })).status
    ).toBe(403);
  });

  it("잘못된 mode 400", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    expect(
      (await convReq("c1", { action: "SET_TRANSLATE_MODE", mode: "JP" })).status
    ).toBe(400);
  });

  it("성공: 본인 대화만(ownerAdminId 게이트) translateMode 갱신", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await convReq("c1", { action: "SET_TRANSLATE_MODE", mode: "EN" });
    expect(res.status).toBe(200);
    expect((await res.json()).translateMode).toBe("EN");
    expect(mockConvUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1", ownerAdminId: "admin1" },
        data: { translateMode: "EN" },
      })
    );
  });

  it("타인/미존재 대화 404 (count 0)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockConvUpdateMany.mockResolvedValue({ count: 0 });
    expect(
      (await convReq("other", { action: "SET_TRANSLATE_MODE", mode: "VI" })).status
    ).toBe(404);
  });
});

// ── PATCH SET_NICKNAME (ADR-0009 S7/D9.3) ─────────────────────────────
describe("PATCH /api/zalo/conversations/[id] — SET_NICKNAME", () => {
  it("비로그인 401 / SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue(null);
    expect(
      (await convReq("c1", { action: "SET_NICKNAME", nickname: "테오" })).status
    ).toBe(401);
    mockAuth.mockResolvedValue(SUPPLIER);
    expect(
      (await convReq("c1", { action: "SET_NICKNAME", nickname: "테오" })).status
    ).toBe(403);
  });

  it("길이 초과(40자 초과) 400", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const long = "가".repeat(41);
    expect((await convReq("c1", { action: "SET_NICKNAME", nickname: long })).status).toBe(400);
  });

  it("성공: 본인 대화만 별명 저장 + AuditLog 기록(old/new)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockConvFindFirst.mockResolvedValue({ id: "c1", nickname: "옛별명" });
    const res = await convReq("c1", { action: "SET_NICKNAME", nickname: "  새별명  " });
    expect(res.status).toBe(200);
    expect((await res.json()).nickname).toBe("새별명"); // trim
    // 본인 대화 게이트 — findFirst where에 ownerAdminId
    expect(mockConvFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1", ownerAdminId: "admin1" } })
    );
    expect(mockConvUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" }, data: { nickname: "새별명" } })
    );
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "ZaloConversation",
        entityId: "c1",
        changes: { nickname: { old: "옛별명", new: "새별명" } },
      })
    );
  });

  it("빈 문자열/공백 → 별명 해제(null)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockConvFindFirst.mockResolvedValue({ id: "c1", nickname: "옛별명" });
    const res = await convReq("c1", { action: "SET_NICKNAME", nickname: "   " });
    expect(res.status).toBe(200);
    expect((await res.json()).nickname).toBeNull();
    expect(mockConvUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { nickname: null } })
    );
  });

  it("null nickname → 해제", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockConvFindFirst.mockResolvedValue({ id: "c1", nickname: "옛별명" });
    const res = await convReq("c1", { action: "SET_NICKNAME", nickname: null });
    expect(res.status).toBe(200);
    expect((await res.json()).nickname).toBeNull();
  });

  it("타인/미존재 대화 404 (findFirst null → update·AuditLog 미호출)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockConvFindFirst.mockResolvedValue(null);
    const res = await convReq("other", { action: "SET_NICKNAME", nickname: "x" });
    expect(res.status).toBe(404);
    expect(mockConvUpdate).not.toHaveBeenCalled();
    expect(vi.mocked(writeAuditLog)).not.toHaveBeenCalled();
  });
});
