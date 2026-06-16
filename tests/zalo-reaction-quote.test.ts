// [INTEG — ADR-0009 R3] 답글(인용)·리액션 — 수신 파싱·집계·발송 라우트.
//
// 검증:
//  - extractQuote: TQuote 타입별(본문/첨부/발신자/원본id) 파싱, 인용 아님(null)
//  - buildCliMsgId: 문자열/숫자/없음 정규화
//  - applyReaction: 아이콘별 카운트 +1/-1, 0 이하 삭제, 빈 객체 → null
//  - REACT action: 본인 대화 게이트, cliMsgId 없으면 거부, 발송 성공 시 자기 집계 +1
//  - 답글(quotedMessageId): 원본 cliMsgId 없으면 거부, 인용 스냅샷 저장, OUTBOUND/INBOUND uidFrom 분기
import { beforeEach, describe, expect, it, vi } from "vitest";

// ===================== 순수 함수 (DB·zca-js 무의존) =====================
import { buildCliMsgId, extractQuote } from "@/lib/zalo-inbound";

describe("buildCliMsgId — cliMsgId 정규화 (R3-1)", () => {
  it("문자열은 그대로", () => {
    expect(buildCliMsgId({ cliMsgId: "c-123" })).toBe("c-123");
  });
  it("숫자는 문자열화", () => {
    expect(buildCliMsgId({ cliMsgId: 987654321 })).toBe("987654321");
  });
  it("없거나 0·빈문자열은 null(멱등/리액션 불가)", () => {
    expect(buildCliMsgId({})).toBeNull();
    expect(buildCliMsgId({ cliMsgId: "" })).toBeNull();
    expect(buildCliMsgId({ cliMsgId: 0 })).toBeNull();
  });
});

describe("extractQuote — 수신 인용(답글) 파싱 (R3-1, Nike extractQuote 패턴)", () => {
  it("본문·발신자·원본id 모두 있는 인용", () => {
    const q = extractQuote({
      quote: { msg: "원본 메시지", fromD: "Nguyen", globalMsgId: 555 },
    });
    expect(q).toEqual({
      quotedMsgId: "555",
      quotedText: "원본 메시지",
      quotedSender: "Nguyen",
    });
  });
  it("본문 없고 첨부만 있으면 [첨부] 표기", () => {
    const q = extractQuote({ quote: { attach: "file://x", fromD: "Nguyen" } });
    expect(q?.quotedText).toBe("[첨부]");
    expect(q?.quotedSender).toBe("Nguyen");
  });
  it("globalMsgId가 문자열이어도 정규화", () => {
    const q = extractQuote({ quote: { msg: "x", globalMsgId: "abc-1" } });
    expect(q?.quotedMsgId).toBe("abc-1");
  });
  it("quote 없으면(일반 메시지) null", () => {
    expect(extractQuote({})).toBeNull();
    expect(extractQuote({ quote: undefined })).toBeNull();
    expect(extractQuote({ quote: null })).toBeNull();
  });
  it("본문·발신자·원본id 전부 비면 인용 아님(null)", () => {
    expect(extractQuote({ quote: { msg: "", fromD: "  " } })).toBeNull();
  });
});

// ===================== applyReaction (DB·zca-js 무의존) =====================
// zalo-runtime은 zca-js를 import하므로, 순수 헬퍼만 분리 테스트하기 위해 모듈을 모킹 없이 import.
// (applyReaction은 부수효과 없는 순수 함수 — Reactions enum 상수 평가만 동반)
import { applyReaction } from "@/lib/zalo-runtime";

describe("applyReaction — 리액션 집계 갱신 (R3-4)", () => {
  it("빈 상태에서 +1", () => {
    expect(applyReaction(null, "HEART", true)).toEqual({ HEART: 1 });
  });
  it("기존 카운트에 +1 (다른 아이콘 보존)", () => {
    expect(applyReaction({ HEART: 1, LIKE: 2 }, "HEART", true)).toEqual({ HEART: 2, LIKE: 2 });
  });
  it("제거(-1) 시 1→0이면 키 삭제", () => {
    expect(applyReaction({ HEART: 1 }, "HEART", false)).toBeNull();
  });
  it("제거 후 다른 아이콘 남으면 그 객체 유지", () => {
    expect(applyReaction({ HEART: 1, LIKE: 1 }, "HEART", false)).toEqual({ LIKE: 1 });
  });
  it("없는 키 제거는 0 이하 → 무변경(키 미생성)", () => {
    expect(applyReaction(null, "HEART", false)).toBeNull();
  });
  it("배열·비객체 입력은 빈 상태로 취급(방어)", () => {
    expect(applyReaction([1, 2] as unknown, "HEART", true)).toEqual({ HEART: 1 });
    expect(applyReaction("garbage" as unknown, "HEART", true)).toEqual({ HEART: 1 });
  });
});

// ===================== REACT action + 답글 라우트 =====================
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

type SendResult = { ok: true; messageId: string | null } | { ok: false; error: string };
const mockAddReaction = vi.fn<(...a: unknown[]) => Promise<{ ok: boolean; error?: string }>>(
  async () => ({ ok: true })
);
const mockSendText = vi.fn<(...a: unknown[]) => Promise<SendResult>>(async () => ({
  ok: true,
  messageId: "z-1",
}));
const mockSendReply = vi.fn<(...a: unknown[]) => Promise<SendResult>>(async () => ({
  ok: true,
  messageId: "z-reply-1",
}));
const mockGetOwnId = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => "bot-own-id");

vi.mock("@/lib/zalo-runtime", async () => {
  // applyReaction·REACTION_KEYS는 실제 구현 사용(순수). 발송 함수만 모킹.
  const actual = await vi.importActual<typeof import("@/lib/zalo-runtime")>(
    "@/lib/zalo-runtime"
  );
  return {
    ...actual,
    addReactionAsAdmin: (...a: unknown[]) => mockAddReaction(...a),
    sendChatMessageAsAdmin: (...a: unknown[]) => mockSendText(...a),
    sendChatReplyAsAdmin: (...a: unknown[]) => mockSendReply(...a),
    getOwnIdForAdmin: (...a: unknown[]) => mockGetOwnId(...a),
  };
});

// stateful prisma mock
const db = {
  conv: null as Record<string, unknown> | null,
  msg: null as Record<string, unknown> | null,
  msgUpdate: vi.fn(async (..._a: unknown[]) => ({})),
};
const mockConvFindFirst = vi.fn(async (..._a: unknown[]) => db.conv);
const mockMsgFindFirst = vi.fn(async (..._a: unknown[]) => db.msg);
const mockMsgCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
  id: "new-msg",
  status: args.data.status,
  createdAt: new Date(),
  quotedText: args.data.quotedText ?? null,
  quotedSender: args.data.quotedSender ?? null,
}));
const mockConvUpdate = vi.fn(async (..._a: unknown[]) => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    zaloConversation: {
      findFirst: (...a: unknown[]) => mockConvFindFirst(...a),
      update: (...a: unknown[]) => mockConvUpdate(...a),
    },
    zaloMessage: {
      findFirst: (...a: unknown[]) => mockMsgFindFirst(...a),
      update: (...a: unknown[]) => db.msgUpdate(...a),
      create: (...a: unknown[]) => mockMsgCreate(...(a as [{ data: Record<string, unknown> }])),
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        zaloMessage: { create: (...a: unknown[]) => mockMsgCreate(...(a as [{ data: Record<string, unknown> }])) },
        zaloConversation: { update: (...a: unknown[]) => mockConvUpdate(...a) },
      }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "admin-theo", role: "ADMIN" } });
  db.conv = { id: "conv-1", zaloUserId: "sup-zalo", userId: null, counterpartyType: "SUPPLIER" };
  db.msg = null;
  db.msgUpdate.mockResolvedValue({});
});

describe("REACT action — 리액션 발송 + 자기 집계 (R3-3)", () => {
  async function patch(body: unknown) {
    const { PATCH } = await import("@/app/api/zalo/conversations/[id]/route");
    return PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: "conv-1" }) }
    );
  }

  it("미인증 401", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await patch({ action: "REACT", messageId: "m1", icon: "HEART" });
    expect(res.status).toBe(401);
  });

  it("비ADMIN 403", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "u", role: "SUPPLIER" } });
    const res = await patch({ action: "REACT", messageId: "m1", icon: "HEART" });
    expect(res.status).toBe(403);
  });

  it("타 관리자/미존재 대화의 메시지는 404 (대화 스코프 게이트)", async () => {
    db.msg = null; // findFirst가 conversation.ownerAdminId 스코프로 0건
    const res = await patch({ action: "REACT", messageId: "m1", icon: "HEART" });
    expect(res.status).toBe(404);
    // 대화 스코프 where에 ownerAdminId 포함 확인
    const where = mockMsgFindFirst.mock.calls.at(-1)![0] as { where: { conversation: Record<string, unknown> } };
    expect(where.where.conversation).toMatchObject({ id: "conv-1", ownerAdminId: "admin-theo" });
  });

  it("cliMsgId 없는 과거 메시지는 400 (REACTION_NOT_SUPPORTED)", async () => {
    db.msg = {
      id: "m1",
      zaloMsgId: "z1",
      cliMsgId: null,
      reactions: null,
      conversation: { zaloUserId: "sup-zalo" },
    };
    const res = await patch({ action: "REACT", messageId: "m1", icon: "HEART" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("REACTION_NOT_SUPPORTED");
    expect(mockAddReaction).not.toHaveBeenCalled();
  });

  it("정상 — addReaction(msgId+cliMsgId) 호출 + 자기 reactions +1", async () => {
    db.msg = {
      id: "m1",
      zaloMsgId: "z1",
      cliMsgId: "c1",
      reactions: { HEART: 1 },
      conversation: { zaloUserId: "sup-zalo" },
    };
    const res = await patch({ action: "REACT", messageId: "m1", icon: "HEART" });
    expect(res.status).toBe(200);
    // 발송 인자: target {zaloMsgId, cliMsgId} + icon key
    const call = mockAddReaction.mock.calls[0]!;
    expect(call[2]).toEqual({ zaloMsgId: "z1", cliMsgId: "c1" });
    expect(call[3]).toBe("HEART");
    // 집계 +1 영속
    const upd = db.msgUpdate.mock.calls[0]![0] as { data: { reactions: unknown } };
    expect(upd.data.reactions).toEqual({ HEART: 2 });
  });

  it("발송 실패(봇 미연결) → 502, 집계 미갱신", async () => {
    db.msg = {
      id: "m1",
      zaloMsgId: "z1",
      cliMsgId: "c1",
      reactions: null,
      conversation: { zaloUserId: "sup-zalo" },
    };
    mockAddReaction.mockResolvedValueOnce({ ok: false, error: "BOT_NOT_CONNECTED" });
    const res = await patch({ action: "REACT", messageId: "m1", icon: "HEART" });
    expect(res.status).toBe(502);
    expect(db.msgUpdate).not.toHaveBeenCalled();
  });

  it("미지원 아이콘 키는 검증 단계에서 400", async () => {
    const res = await patch({ action: "REACT", messageId: "m1", icon: "NOT_A_REAL_ICON" });
    expect(res.status).toBe(400);
  });
});

describe("답글(quotedMessageId) — 인용 발송 (R3-2)", () => {
  async function post(body: unknown) {
    const { POST } = await import("@/app/api/zalo/messages/route");
    return POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
  }

  it("원본 cliMsgId 없으면 400 (QUOTE_NOT_SUPPORTED)", async () => {
    db.conv = { id: "conv-1", zaloUserId: "sup-zalo" };
    db.msg = {
      zaloMsgId: "z1",
      cliMsgId: null,
      text: "원본",
      direction: "INBOUND",
      conversation: { displayName: "Nguyen", nickname: null },
    };
    const res = await post({ conversationId: "conv-1", text: "답글", quotedMessageId: "m1" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("QUOTE_NOT_SUPPORTED");
    expect(mockSendReply).not.toHaveBeenCalled();
  });

  it("상대(INBOUND) 인용 — sendChatReplyAsAdmin 호출, uidFrom=상대, 스냅샷 저장", async () => {
    db.conv = { id: "conv-1", zaloUserId: "sup-zalo" };
    db.msg = {
      zaloMsgId: "z1",
      cliMsgId: "c1",
      text: "원본 본문",
      direction: "INBOUND",
      conversation: { displayName: "Nguyen", nickname: null },
    };
    const res = await post({ conversationId: "conv-1", text: "답글", quotedMessageId: "m1" });
    expect(res.status).toBe(200);
    const qs = mockSendReply.mock.calls[0]![3] as {
      zaloMsgId: string;
      cliMsgId: string;
      content: string;
      uidFrom: string;
    };
    expect(qs).toEqual({ zaloMsgId: "z1", cliMsgId: "c1", content: "원본 본문", uidFrom: "sup-zalo" });
    // 발신 행에 인용 스냅샷 저장
    const created = mockMsgCreate.mock.calls.at(-1)![0].data;
    expect(created.quotedMsgId).toBe("z1");
    expect(created.quotedText).toBe("원본 본문");
    expect(created.quotedSender).toBe("Nguyen");
  });

  it("내 발신(OUTBOUND) 인용 — uidFrom=내 ownId, quotedSender=null", async () => {
    db.conv = { id: "conv-1", zaloUserId: "sup-zalo" };
    db.msg = {
      zaloMsgId: "z2",
      cliMsgId: "c2",
      text: "내가 보낸 원본",
      direction: "OUTBOUND",
      conversation: { displayName: "Nguyen", nickname: null },
    };
    const res = await post({ conversationId: "conv-1", text: "답글", quotedMessageId: "m2" });
    expect(res.status).toBe(200);
    const qs = mockSendReply.mock.calls[0]![3] as { uidFrom: string };
    expect(qs.uidFrom).toBe("bot-own-id");
    const created = mockMsgCreate.mock.calls.at(-1)![0].data;
    expect(created.quotedSender).toBeNull();
  });

  it("quotedMessageId 없으면 일반 발송(sendChatMessageAsAdmin)", async () => {
    db.conv = { id: "conv-1", zaloUserId: "sup-zalo" };
    const res = await post({ conversationId: "conv-1", text: "그냥 메시지" });
    expect(res.status).toBe(200);
    expect(mockSendText).toHaveBeenCalled();
    expect(mockSendReply).not.toHaveBeenCalled();
  });
});
