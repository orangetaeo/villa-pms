// S3 saveInboundMessage — DB 저장·멱등·전화번호 매칭 (ADR-0006 S3, T3.7)
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── prisma mock ───────────────────────────────────────────────
const convUpsert = vi.fn();
const convUpdate = vi.fn();
const msgFindUnique = vi.fn();
const msgCreate = vi.fn();
const userFindFirst = vi.fn();
const userUpdate = vi.fn();
const partnerUpdateMany = vi.fn();
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
    partner: {
      updateMany: (...a: unknown[]) => partnerUpdateMany(...a),
    },
    // $transaction([...]) — 배열 형태만 사용
    $transaction: (ops: unknown) => txArr(ops),
  },
}));

import { saveInboundMessage, saveOutboundEcho } from "@/lib/zalo-inbound";

const base = {
  ownerAdminId: "admin-theo",
  isSystemBot: true, // 기본: 시스템봇 수신(전화번호 매칭 활성)
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
  partnerUpdateMany.mockReturnValue({ __op: "partner.updateMany" });
  txArr.mockResolvedValue([{}, {}]);
});

describe("saveInboundMessage — 저장 + 메타 갱신 (ADR-0007 귀속)", () => {
  it("대화 upsert는 (ownerAdminId, zaloUserId) 복합키 — 관리자별 격리", async () => {
    await saveInboundMessage(base);
    const where = convUpsert.mock.calls[0]![0].where;
    expect(where).toEqual({
      ownerAdminId_zaloUserId: { ownerAdminId: "admin-theo", zaloUserId: "sup-zalo-1" },
    });
    const create = convUpsert.mock.calls[0]![0].create;
    expect(create.ownerAdminId).toBe("admin-theo");
    expect(create.zaloUserId).toBe("sup-zalo-1");
  });

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
  it("본문이 전화번호 + 알림 대상 role 일치 → User.zaloUserId + conversation.userId 연결", async () => {
    userFindFirst.mockResolvedValue({ id: "user-9", zaloUserId: null, role: "SUPPLIER" });
    const r = await saveInboundMessage({ ...base, text: "0901234567" });
    expect(userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { in: ["SUPPLIER", "CLEANER", "VENDOR", "PARTNER"] },
          phone: "0901234567",
        }),
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

  it("개인 계정 수신(isSystemBot=false) → 전화번호여도 매칭 스킵 (D4 — User.zaloUserId 전역 오염 방지)", async () => {
    userFindFirst.mockResolvedValue({ id: "user-9", zaloUserId: null });
    const r = await saveInboundMessage({ ...base, isSystemBot: false, text: "0901234567" });
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(txArr).not.toHaveBeenCalled();
    expect(r.matchedUserId).toBeNull();
  });

  it("개인 계정 수신도 대화 저장은 정상 (귀속 관리자 격리)", async () => {
    const r = await saveInboundMessage({ ...base, ownerAdminId: "admin-b", isSystemBot: false });
    expect(r.saved).toBe(true);
    const where = convUpsert.mock.calls[0]![0].where;
    expect(where.ownerAdminId_zaloUserId.ownerAdminId).toBe("admin-b");
  });
});

describe("saveInboundMessage — 역할별 자동 매칭 커버리지 (T-zalo-connect-role-coverage)", () => {
  it("CLEANER 전화번호 일치 → 자동 연결(청소직원도 알림 대상)", async () => {
    userFindFirst.mockResolvedValue({ id: "cleaner-1", zaloUserId: null, role: "CLEANER" });
    const r = await saveInboundMessage({ ...base, text: "0901234567" });
    expect(txArr).toHaveBeenCalledTimes(1);
    expect(r.matchedUserId).toBe("cleaner-1");
    // PARTNER 아님 → Partner 동기화 없음
    expect(partnerUpdateMany).not.toHaveBeenCalled();
  });

  it("VENDOR 전화번호 일치 → 자동 연결", async () => {
    userFindFirst.mockResolvedValue({ id: "vendor-1", zaloUserId: null, role: "VENDOR" });
    const r = await saveInboundMessage({ ...base, text: "0901234567" });
    expect(txArr).toHaveBeenCalledTimes(1);
    expect(r.matchedUserId).toBe("vendor-1");
    expect(partnerUpdateMany).not.toHaveBeenCalled();
  });

  it("PARTNER 매칭 → contactZaloUid 비어있을 때만 같은 uid로 채움(같은 트랜잭션)", async () => {
    userFindFirst.mockResolvedValue({ id: "partner-user-1", zaloUserId: null, role: "PARTNER" });
    const r = await saveInboundMessage({ ...base, text: "0901234567" });
    expect(r.matchedUserId).toBe("partner-user-1");
    // Partner.updateMany는 userId 스코프 + contactZaloUid:null 게이트(기존 값 덮어쓰기 금지)
    expect(partnerUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "partner-user-1", contactZaloUid: null },
        data: { contactZaloUid: "sup-zalo-1" },
      })
    );
    // user.update + conversation.update + partner.updateMany = 3개 op 한 트랜잭션
    expect(txArr).toHaveBeenCalledTimes(1);
    const ops = txArr.mock.calls[0]![0] as unknown[];
    expect(ops).toHaveLength(3);
  });

  it("PARTNER 아닌 role은 Partner 동기화 op를 트랜잭션에 넣지 않음(op 2개)", async () => {
    userFindFirst.mockResolvedValue({ id: "sup-1", zaloUserId: null, role: "SUPPLIER" });
    await saveInboundMessage({ ...base, text: "0901234567" });
    const ops = txArr.mock.calls[0]![0] as unknown[];
    expect(ops).toHaveLength(2);
  });
});

// ===================== 본인 발신 동기화 (OUTBOUND echo) =====================

const outBase = {
  ownerAdminId: "admin-theo",
  senderZaloUserId: "sup-zalo-1",
  text: "확인했습니다",
  zaloMsgId: "out-1",
  createdAt: new Date("2026-06-16T03:00:00.000Z"),
  displayName: "Nguyen",
};

describe("saveOutboundEcho — 앱/프로그램 본인 발신 동기화", () => {
  it("앱 발신(신규 msgId): OUTBOUND·CHAT 저장, createdAt=zca-js ts, lastMessageAt만 갱신", async () => {
    const r = await saveOutboundEcho(outBase);
    expect(r.saved).toBe(true);
    expect(r.duplicated).toBe(false);

    const data = msgCreate.mock.calls[0]![0].data;
    expect(data.direction).toBe("OUTBOUND");
    expect(data.source).toBe("CHAT");
    expect(data.status).toBe("SENT");
    expect(data.zaloMsgId).toBe("out-1");
    expect(data.createdAt).toEqual(outBase.createdAt);

    const upd = convUpdate.mock.calls[0]![0].data;
    expect(upd.lastMessageAt).toEqual(outBase.createdAt);
    // OUTBOUND: unread 증가·lastInboundAt 갱신 안 함
    expect(upd.unreadCount).toBeUndefined();
    expect(upd.lastInboundAt).toBeUndefined();
  });

  it("대화 upsert는 (ownerAdminId, 수신자 zaloUserId) 복합키 — 관리자별 격리", async () => {
    await saveOutboundEcho(outBase);
    const where = convUpsert.mock.calls[0]![0].where;
    expect(where).toEqual({
      ownerAdminId_zaloUserId: { ownerAdminId: "admin-theo", zaloUserId: "sup-zalo-1" },
    });
  });

  it("멱등: 프로그램(S4)이 같은 zaloMsgId로 이미 저장 → 스킵(중복 0)", async () => {
    msgFindUnique.mockResolvedValue({ id: "already-saved-by-program" });
    const r = await saveOutboundEcho(outBase);
    expect(r.saved).toBe(false);
    expect(r.duplicated).toBe(true);
    expect(msgCreate).not.toHaveBeenCalled();
    expect(convUpdate).not.toHaveBeenCalled();
  });

  it("OUTBOUND은 전화번호 매칭 안 함 (User.zaloUserId 미변경)", async () => {
    await saveOutboundEcho({ ...outBase, text: "0901234567" });
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(txArr).not.toHaveBeenCalled();
  });
});

// ===================== ADR-0009 R3-1 — cliMsgId·인용 스냅샷 저장 =====================

describe("saveInboundMessage — cliMsgId·인용 스냅샷 저장 (R3-1)", () => {
  it("cliMsgId·quote 저장(리액션·답글 대상)", async () => {
    await saveInboundMessage({
      ...base,
      cliMsgId: "cli-1",
      quote: { quotedMsgId: "orig-9", quotedText: "원본", quotedSender: "Nguyen" },
    });
    const data = msgCreate.mock.calls[0]![0].data;
    expect(data.cliMsgId).toBe("cli-1");
    expect(data.quotedMsgId).toBe("orig-9");
    expect(data.quotedText).toBe("원본");
    expect(data.quotedSender).toBe("Nguyen");
  });

  it("cliMsgId·quote 미지정이면 null(과거 동작 보존)", async () => {
    await saveInboundMessage(base);
    const data = msgCreate.mock.calls[0]![0].data;
    expect(data.cliMsgId).toBeNull();
    expect(data.quotedMsgId).toBeNull();
    expect(data.quotedText).toBeNull();
    expect(data.quotedSender).toBeNull();
  });
});

describe("saveOutboundEcho — cliMsgId·인용 스냅샷 저장 (R3-1)", () => {
  it("내 발신 echo도 cliMsgId 저장(리액션 대상이 되게)", async () => {
    await saveOutboundEcho({
      ...outBase,
      cliMsgId: "cli-out-1",
      quote: { quotedMsgId: "orig-3", quotedText: "내 답글 원본", quotedSender: null },
    });
    const data = msgCreate.mock.calls[0]![0].data;
    expect(data.cliMsgId).toBe("cli-out-1");
    expect(data.quotedMsgId).toBe("orig-3");
    expect(data.quotedText).toBe("내 답글 원본");
  });

  it("미지정이면 null", async () => {
    await saveOutboundEcho(outBase);
    const data = msgCreate.mock.calls[0]![0].data;
    expect(data.cliMsgId).toBeNull();
  });
});
