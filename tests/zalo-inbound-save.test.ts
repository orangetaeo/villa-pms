// S3 saveInboundMessage — DB 저장·멱등·전화번호 매칭 (ADR-0006 S3, T3.7)
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── prisma mock ───────────────────────────────────────────────
const convUpsert = vi.fn();
const convUpdate = vi.fn();
const msgFindUnique = vi.fn();
const msgCreate = vi.fn();
const userFindFirst = vi.fn();
const userUpdate = vi.fn();
const txArr = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    zaloConversation: {
      upsert: (...a: unknown[]) => convUpsert(...a),
      update: (...a: unknown[]) => convUpdate(...a),
    },
    zaloMessage: {
      findUnique: (...a: unknown[]) => msgFindUnique(...a),
      create: (...a: unknown[]) => msgCreate(...a),
    },
    user: {
      findFirst: (...a: unknown[]) => userFindFirst(...a),
      update: (...a: unknown[]) => userUpdate(...a),
    },
    // $transaction([...]) — 배열 형태만 사용
    $transaction: (ops: unknown) => txArr(ops),
  },
}));

import { saveInboundMessage } from "@/lib/zalo-inbound";

const base = {
  senderZaloUserId: "sup-zalo-1",
  text: "Xin chào",
  zaloMsgId: "m-1",
  displayName: "Nguyen",
  senderPhone: null as string | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  convUpsert.mockResolvedValue({ id: "c1", userId: null, displayName: null });
  msgFindUnique.mockResolvedValue(null);
  msgCreate.mockResolvedValue({ id: "m1" });
  convUpdate.mockResolvedValue({});
  userFindFirst.mockResolvedValue(null);
  txArr.mockResolvedValue([{}, {}]);
});

describe("saveInboundMessage — 저장 + 메타 갱신", () => {
  it("신규 수신: 대화 upsert + INBOUND·USER 메시지 + lastInboundAt·unread+1", async () => {
    const r = await saveInboundMessage(base);
    expect(r.saved).toBe(true);
    expect(r.duplicated).toBe(false);

    const msgArg = msgCreate.mock.calls[0]![0].data;
    expect(msgArg.direction).toBe("INBOUND");
    expect(msgArg.source).toBe("USER");
    expect(msgArg.zaloMsgId).toBe("m-1");

    const updArg = convUpdate.mock.calls[0]![0].data;
    expect(updArg.lastInboundAt).toBeInstanceOf(Date);
    expect(updArg.lastMessageAt).toBeInstanceOf(Date);
    expect(updArg.unreadCount).toEqual({ increment: 1 });
  });

  it("멱등: 동일 zaloMsgId 이미 존재 → 저장 스킵(중복 0)", async () => {
    msgFindUnique.mockResolvedValue({ id: "existing" });
    const r = await saveInboundMessage(base);
    expect(r.saved).toBe(false);
    expect(r.duplicated).toBe(true);
    expect(msgCreate).not.toHaveBeenCalled();
    expect(convUpdate).not.toHaveBeenCalled();
  });
});

describe("saveInboundMessage — 전화번호 매칭 (T3.7)", () => {
  it("본문이 전화번호 + SUPPLIER 일치 → User.zaloUserId + conversation.userId 연결", async () => {
    userFindFirst.mockResolvedValue({ id: "user-9", zaloUserId: null });
    const r = await saveInboundMessage({ ...base, text: "0901234567" });
    expect(userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: "SUPPLIER", phone: "0901234567" }),
      })
    );
    expect(txArr).toHaveBeenCalledTimes(1);
    expect(r.matchedUserId).toBe("user-9");
  });

  it("이미 다른 Zalo 계정에 연결된 SUPPLIER → 자동 덮어쓰기 금지(수동 fallback)", async () => {
    userFindFirst.mockResolvedValue({ id: "user-9", zaloUserId: "other-zalo" });
    const r = await saveInboundMessage({ ...base, text: "0901234567" });
    expect(txArr).not.toHaveBeenCalled();
    expect(r.matchedUserId).toBeNull();
  });

  it("이미 userId 연결된 대화는 매칭 시도 안 함", async () => {
    convUpsert.mockResolvedValue({ id: "c1", userId: "already", displayName: null });
    const r = await saveInboundMessage({ ...base, text: "0901234567" });
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(r.matchedUserId).toBe("already");
  });

  it("전화번호 아님 → 매칭 시도 안 함", async () => {
    const r = await saveInboundMessage({ ...base, text: "Xin chào" });
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(r.matchedUserId).toBeNull();
  });
});
