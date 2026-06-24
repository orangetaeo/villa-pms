// [QA — ADR-0007 독립 검증] 라우트 단위 교차 관리자 누수 강제 검증 (검증 요청 B).
// 기존 zalo-api.test.ts는 where 객체 "모양"만 단언 → 실제 필터 동작은 미검증.
// 여기서는 ownerAdminId로 키된 stateful prisma mock으로 "필터가 실제로 거른다"를 실증한다:
//   - 관리자 A 대화(convA)는 ownerAdminId=adminA 소유.
//   - 관리자 B 세션이 convA에 발신·읽음처리 시도 → DB 필터가 0건 반환 → 404 (누수 0).
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const mockSendChat = vi.fn();
vi.mock("@/lib/zalo-runtime", () => ({
  sendChatMessageAsAdmin: (...a: unknown[]) => mockSendChat(...a),
  // ADR-0009 R3 — 라우트 모듈 평가 시 참조 심볼(REACTION_KEYS) + 발송/집계 헬퍼.
  sendChatReplyAsAdmin: vi.fn(async () => ({ ok: true, messageId: "z-reply" })),
  getOwnIdForAdmin: vi.fn(async () => "bot-own-id"),
  addReactionAsAdmin: vi.fn(async () => ({ ok: true })),
  REACTION_KEYS: ["HEART", "LIKE"],
  applyReaction: () => ({ HEART: 1 }),
}));

// ── stateful 대화 저장소: id → { ownerAdminId, zaloUserId } ──
const CONVS: Record<string, { ownerAdminId: string; zaloUserId: string }> = {
  convA: { ownerAdminId: "adminA", zaloUserId: "zu-A" },
  convB: { ownerAdminId: "adminB", zaloUserId: "zu-B" },
};

// where { id, ownerAdminId } 를 실제로 평가 (필터 실증)
function matchConv(where: { id?: string; ownerAdminId?: string }) {
  const c = where.id ? CONVS[where.id] : undefined;
  if (!c) return null;
  if (where.ownerAdminId && c.ownerAdminId !== where.ownerAdminId) return null;
  // ADR-0010 S4 — 라우트가 threadType을 읽어 발송 ThreadType 결정. 1:1 기본 USER.
  return { id: where.id, zaloUserId: c.zaloUserId, threadType: "USER" };
}

const txMsgCreate = vi.fn();
const tx = {
  zaloMessage: { create: txMsgCreate },
  zaloConversation: { update: vi.fn(async () => ({})) },
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    zaloConversation: {
      findFirst: vi.fn(async (arg: { where: { id?: string; ownerAdminId?: string } }) =>
        matchConv(arg.where)
      ),
      updateMany: vi.fn(async (arg: { where: { id?: string; ownerAdminId?: string } }) => ({
        count: matchConv(arg.where) ? 1 : 0,
      })),
    },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

import { POST as sendPost } from "@/app/api/zalo/messages/route";
import { PATCH as convPatch } from "@/app/api/zalo/conversations/[id]/route";

const sendReq = (body: unknown) =>
  sendPost(
    new Request("http://local/api/zalo/messages", {
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
  mockSendChat.mockResolvedValue({ ok: true, messageId: "z1" });
  txMsgCreate.mockResolvedValue({ id: "m1", status: "SENT", createdAt: new Date() });
});

describe("발신 — 관리자 B는 관리자 A 대화로 발신 불가 (누수 0)", () => {
  it("adminB 세션 → convA(소유 adminA) 발신 시도 → 404, 발송·영속 0", async () => {
    mockAuth.mockResolvedValue({ user: { id: "adminB", role: "ADMIN" } });
    const res = await sendReq({ conversationId: "convA", text: "엿보기" });
    expect(res.status).toBe(404);
    expect(mockSendChat).not.toHaveBeenCalled(); // 발송 시도조차 안 함
    expect(txMsgCreate).not.toHaveBeenCalled(); // 영속 0
  });

  it("adminA 세션 → 본인 convA 발신 → 200 (정상 동작 대조군)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "adminA", role: "ADMIN" } });
    const res = await sendReq({ conversationId: "convA", text: "안녕" });
    expect(res.status).toBe(200);
    // 본인 계정으로만 발송 (adminA, convA의 상대 zaloUserId). ADR-0010 S4: 4번째 인자 ThreadType(1:1=User=0).
    // 5번째 인자: @멘션(미멘션이면 undefined — ce389e6 발송 체인 mentions 통과).
    expect(mockSendChat).toHaveBeenCalledWith("adminA", "zu-A", "안녕", 0, undefined);
  });

  it("adminB 세션 → 본인 convB 발신 → 200, adminA로는 절대 발송 안 됨", async () => {
    mockAuth.mockResolvedValue({ user: { id: "adminB", role: "ADMIN" } });
    const res = await sendReq({ conversationId: "convB", text: "hi" });
    expect(res.status).toBe(200);
    expect(mockSendChat).toHaveBeenCalledWith("adminB", "zu-B", "hi", 0, undefined);
  });
});

describe("읽음 처리 — 관리자 B는 관리자 A 대화 읽음처리 불가 (누수 0)", () => {
  it("adminB 세션 → convA mark-read → 404 (count 0)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "adminB", role: "ADMIN" } });
    const res = await convReq("convA", { action: "MARK_READ" });
    expect(res.status).toBe(404);
  });

  it("adminA 세션 → 본인 convA mark-read → 200 (대조군)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "adminA", role: "ADMIN" } });
    const res = await convReq("convA", { action: "MARK_READ" });
    expect(res.status).toBe(200);
  });

  it("존재하지 않는 대화 id → 404 (id 추측 차단)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "adminA", role: "ADMIN" } });
    const res = await convReq("guess-xyz", { action: "MARK_READ" });
    expect(res.status).toBe(404);
  });
});
