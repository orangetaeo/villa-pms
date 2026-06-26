// 답글 인용 점프 앵커 변환 (globalMsgId → zaloMsgId) — buildAnchorMap(순수)·resolveQuotedAnchors(DB폴백).
//
// 근본 원인 회귀 가드: 수신 답글의 quotedMsgId는 zca-js quote.globalMsgId인데 버블 앵커는 zaloMsgId(=msgId)다.
//   변환이 없으면 매칭 불가 → 점프 영영 안 됨. 우리 발신 답글(quotedMsgId=zaloMsgId)은 변환 안 돼야 함(회귀 0).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildAnchorMap } from "@/lib/zalo-quote-anchor";

describe("buildAnchorMap — 배치 내 globalMsgId→zaloMsgId 맵", () => {
  it("둘 다 있는 메시지만 매핑", () => {
    const map = buildAnchorMap([
      { zaloMsgId: "z1", globalMsgId: "g1" },
      { zaloMsgId: "z2", globalMsgId: "g2" },
    ]);
    expect(map.get("g1")).toBe("z1");
    expect(map.get("g2")).toBe("z2");
    expect(map.size).toBe(2);
  });
  it("globalMsgId·zaloMsgId 한쪽이라도 없으면 미매핑", () => {
    const map = buildAnchorMap([
      { zaloMsgId: "z1", globalMsgId: null },
      { zaloMsgId: null, globalMsgId: "g2" },
      { zaloMsgId: "z3" }, // globalMsgId undefined
    ]);
    expect(map.size).toBe(0);
  });
});

// ── resolveQuotedAnchors (DB 폴백 모킹) ──
const mockFindMany = vi.fn(async (..._a: unknown[]) => [] as { globalMsgId: string | null; zaloMsgId: string | null }[]);
vi.mock("@/lib/prisma", () => ({
  prisma: { zaloMessage: { findMany: (...a: unknown[]) => mockFindMany(...a) } },
}));

import { resolveQuotedAnchors } from "@/lib/zalo-quote-anchor";
import type { ChatMessageDTO } from "@/lib/zalo-chat-message";

/** 최소 DTO 생성기 — 테스트에 필요한 필드만(나머지는 형태 충족용 더미). */
function dto(id: string, quotedMsgId: string | null): ChatMessageDTO {
  return {
    id,
    kind: "inbound",
    msgType: "text",
    text: "",
    translatedText: null,
    attachmentUrls: [],
    time: "",
    status: "SENT",
    dayDivider: null,
    avatarUrl: null,
    initials: "?",
    senderName: null,
    zaloMsgId: null,
    quotedMsgId,
    quotedText: quotedMsgId ? "원본" : null,
    quotedSender: null,
    reactions: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMany.mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

describe("resolveQuotedAnchors — 수신 답글 인용 앵커 변환", () => {
  it("배치 내 globalMsgId 인용을 zaloMsgId로 치환(점프 가능해짐), DB 폴백 미호출", async () => {
    const rows = [
      { zaloMsgId: "z_orig", globalMsgId: "g_orig" },
      { zaloMsgId: "z_reply", globalMsgId: "g_reply" },
    ];
    const dtos = [dto("orig", null), dto("reply", "g_orig")]; // 답글은 원본의 globalMsgId를 인용
    const out = await resolveQuotedAnchors(dtos, rows, "conv-1");
    expect(out[1].quotedMsgId).toBe("z_orig"); // 앵커(zaloMsgId)로 변환됨
    expect(mockFindMany).not.toHaveBeenCalled(); // 배치에서 해결 → DB 폴백 없음
  });

  it("우리 발신 답글(quotedMsgId=이미 zaloMsgId)은 변환 안 됨 — 회귀 0", async () => {
    // route 발신 답글은 quotedMsgId=원본 zaloMsgId. 맵 키는 globalMsgId뿐이라 매칭 안 돼 그대로 통과.
    const rows = [{ zaloMsgId: "z_orig", globalMsgId: "g_orig" }];
    const dtos = [dto("reply", "z_orig")];
    const out = await resolveQuotedAnchors(dtos, rows, "conv-1");
    expect(out[0].quotedMsgId).toBe("z_orig"); // 불변
  });

  it("배치 밖 원본은 DB 폴백으로 globalMsgId→zaloMsgId 보강", async () => {
    mockFindMany.mockResolvedValueOnce([{ globalMsgId: "g_old", zaloMsgId: "z_old" }]);
    const rows = [{ zaloMsgId: "z_reply", globalMsgId: "g_reply" }]; // 원본은 이 배치에 없음
    const dtos = [dto("reply", "g_old")];
    const out = await resolveQuotedAnchors(dtos, rows, "conv-1");
    expect(out[0].quotedMsgId).toBe("z_old");
    // 대화 스코프로 unresolved globalMsgId만 조회
    const where = mockFindMany.mock.calls[0]![0] as { where: { conversationId: string; globalMsgId: { in: string[] } } };
    expect(where.where.conversationId).toBe("conv-1");
    expect(where.where.globalMsgId.in).toEqual(["g_old"]);
  });

  it("인용 없는 메시지뿐이면 DB 폴백·변환 없이 원본 반환", async () => {
    const out = await resolveQuotedAnchors([dto("a", null)], [], "conv-1");
    expect(out[0].quotedMsgId).toBeNull();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("DB 폴백 실패(throw)는 무시 — 변환 안 된 인용은 원본 유지(점프만 불가)", async () => {
    mockFindMany.mockRejectedValueOnce(new Error("db down"));
    const dtos = [dto("reply", "g_missing")];
    const out = await resolveQuotedAnchors(dtos, [], "conv-1");
    expect(out[0].quotedMsgId).toBe("g_missing"); // 그대로(에러 swallow)
  });
});
