// [QA — ADR-0009 S1~S4 독립 검증] 공유 발송 라우트 누수 매트릭스 전수 + 권한·게이트.
//
// 검증(D2 불변식):
//   - 공급자 빌라 카드에 salePrice/KRW/margin 0 (원가만)
//   - 고객 빌라 카드에 cost/margin 0 (판매가만)
//   - 정산: 타 공급자 차단(supplierId 필터), 미매칭(userId=null) 차단
//   - 제안: 공급자/UNKNOWN 거부(고객 전용)
//   - 빌라: UNKNOWN 거부
//   - 권한: 미인증 401 / 비ADMIN 403 / 타대화·미존재 404
//   - 봇 미연결 → FAILED 기록(영속은 200)
//
// prisma select 화이트리스트가 "쿼리 단계에서 반대편 필드를 조회하지 않음"을 실증:
//   villa.findUnique mock이 호출 시 select 키를 캡처 → supplier 경로 select엔 salePriceVnd/
//   marginValue 키가 아예 없고, customer 경로엔 supplierCostVnd/marginValue가 없음을 단언.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

type SendResult = { ok: true; messageId: string | null } | { ok: false; error: string };
const mockSendText = vi.fn<(...a: unknown[]) => Promise<SendResult>>(async () => ({
  ok: true,
  messageId: "z-msg-1",
}));
const mockSendImage = vi.fn<(...a: unknown[]) => Promise<SendResult>>(async () => ({
  ok: true,
  messageId: "z-img-1",
}));
const mockSendFile = vi.fn<(...a: unknown[]) => Promise<SendResult>>(async () => ({
  ok: true,
  messageId: "z-file-1",
}));
vi.mock("@/lib/zalo-runtime", () => ({
  sendChatMessageAsAdmin: (...a: unknown[]) => mockSendText(...a),
  sendChatImageAsAdmin: (...a: unknown[]) => mockSendImage(...a),
  sendChatFileAsAdmin: (...a: unknown[]) => mockSendFile(...a),
}));

const mockSaveFile = vi.fn(async (..._a: unknown[]) => ({ url: "https://cdn/test-img.jpg" }));
const mockSaveAttachment = vi.fn(async (..._a: unknown[]) => ({
  url: "https://cdn/test-doc.pdf",
  displayName: "계약서.pdf",
}));
const ATTACH_MAX = 20 * 1024 * 1024;
vi.mock("@/lib/storage", () => {
  // 팩토리는 호이스팅되므로 상수는 팩토리 내부에 둔다(외부 변수 참조 금지).
  const IMG_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  const MAX = 20 * 1024 * 1024;
  const BLOCKED = new Set(["exe", "bat", "js", "sh", "msi"]);
  const IMG_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "heif"];
  return {
    saveFile: (...a: unknown[]) => mockSaveFile(...a),
    isAllowedImageMime: (mime: string) => IMG_MIMES.includes(mime),
    saveAttachmentFile: (...a: unknown[]) => mockSaveAttachment(...a),
    MAX_ATTACHMENT_SIZE: MAX,
    // 실제 storage.validateAttachment 정책을 모사(라우트 분기 검증용).
    validateAttachment: (fileName: string, size: number) => {
      if (size > MAX) return { ok: false, reason: "TOO_LARGE" };
      const m = /\.([a-z0-9]+)$/i.exec(fileName.trim());
      if (!m) return { ok: false, reason: "NO_EXTENSION" };
      const ext = m[1].toLowerCase();
      if (BLOCKED.has(ext)) return { ok: false, reason: "BLOCKED_TYPE" };
      if (IMG_EXTS.includes(ext)) return { ok: false, reason: "IS_IMAGE" };
      return { ok: true, ext };
    },
  };
});

// ── stateful prisma mock ──
type Conv = {
  ownerAdminId: string;
  zaloUserId: string;
  userId: string | null;
  counterpartyType:
    | "SUPPLIER"
    | "CUSTOMER"
    | "TRAVEL_AGENCY"
    | "LAND_AGENCY"
    | "UNKNOWN";
};
const CONVS: Record<string, Conv> = {
  convSup: { ownerAdminId: "adminA", zaloUserId: "zu-sup", userId: "supA", counterpartyType: "SUPPLIER" },
  convSupUnlinked: { ownerAdminId: "adminA", zaloUserId: "zu-sup2", userId: null, counterpartyType: "SUPPLIER" },
  convCust: { ownerAdminId: "adminA", zaloUserId: "zu-cust", userId: null, counterpartyType: "CUSTOMER" },
  convTravel: { ownerAdminId: "adminA", zaloUserId: "zu-tra", userId: null, counterpartyType: "TRAVEL_AGENCY" },
  convLand: { ownerAdminId: "adminA", zaloUserId: "zu-lan", userId: null, counterpartyType: "LAND_AGENCY" },
  convUnknown: { ownerAdminId: "adminA", zaloUserId: "zu-unk", userId: null, counterpartyType: "UNKNOWN" },
  convOther: { ownerAdminId: "adminB", zaloUserId: "zu-b", userId: "supB", counterpartyType: "SUPPLIER" },
};

let lastVillaSelect: Record<string, unknown> | null = null;
let lastSettlementWhere: Record<string, unknown> | null = null;

const txMsgCreate = vi.fn(async (arg: { data: Record<string, unknown> }) => ({
  id: "msg-1",
  status: arg.data.status,
  createdAt: new Date("2026-06-16T00:00:00Z"),
}));
const tx = {
  zaloMessage: { create: txMsgCreate },
  zaloConversation: { update: vi.fn(async () => ({})) },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    zaloConversation: {
      findFirst: vi.fn(async (arg: { where: { id?: string; ownerAdminId?: string } }) => {
        const c = arg.where.id ? CONVS[arg.where.id] : undefined;
        if (!c) return null;
        if (arg.where.ownerAdminId && c.ownerAdminId !== arg.where.ownerAdminId) return null;
        return {
          id: arg.where.id,
          zaloUserId: c.zaloUserId,
          userId: c.userId,
          counterpartyType: c.counterpartyType,
        };
      }),
    },
    villa: {
      findUnique: vi.fn(async (arg: { where: { id: string }; select: Record<string, unknown> }) => {
        lastVillaSelect = arg.select;
        if (arg.where.id !== "villa1") return null;
        // 두 경로 모두에 대응하는 풀 레코드를 두되, **mock이 select를 그대로 반영**하도록
        // select에 있는 ratePeriods 형태만 채운다(ADR-0014 — 실DB select 화이트리스트 동작 모사).
        const ratesSel = (arg.select.ratePeriods as { select: Record<string, boolean> }).select;
        const rateRow: Record<string, unknown> = { season: "LOW", isBase: true };
        if (ratesSel.supplierCostVnd) rateRow.supplierCostVnd = 1000000n;
        if (ratesSel.salePriceVnd) rateRow.salePriceVnd = 1500000n;
        if (ratesSel.salePriceKrw) rateRow.salePriceKrw = 90000;
        return {
          name: "쏘나씨 V12",
          complex: "쏘나씨",
          bedrooms: 3,
          bathrooms: 2,
          maxGuests: 6,
          hasPool: true,
          breakfastAvailable: true,
          supplierId: "supA",
          status: "ACTIVE",
          isSellable: true,
          amenities: [{ itemKey: "kettle", customLabel: null }],
          ratePeriods: [rateRow],
        };
      }),
    },
    proposal: {
      findUnique: vi.fn(async (arg: { where: { id: string } }) => {
        if (arg.where.id !== "prop1") return null;
        return {
          id: "prop1",
          token: "tok-abc",
          clientName: "여행사A",
          status: "ACTIVE",
          expiresAt: new Date(Date.now() + 86400000),
          saleCurrency: "KRW",
          // 제안 요약 동봉(T-zalo-notify-enrichment) — 빌라·기간·판매가만(원가·마진 없음)
          items: [
            {
              checkIn: new Date("2026-07-15T00:00:00Z"),
              checkOut: new Date("2026-07-18T00:00:00Z"),
              totalKrw: 1_450_000,
              totalVnd: null,
              totalUsd: null,
              villa: { name: "쏘나씨 V12", nameVi: null, bedrooms: 3, hasPool: true },
            },
          ],
        };
      }),
    },
    settlement: {
      findFirst: vi.fn(async (arg: { where: Record<string, unknown> }) => {
        lastSettlementWhere = arg.where;
        // supplierId 필터 실증: where.supplierId !== 정산 소유자면 0건.
        if (arg.where.supplierId !== "supA") return null;
        if (arg.where.id && arg.where.id !== "set1") return null;
        return {
          id: "set1",
          yearMonth: "2026-05",
          totalVnd: 5000000n,
          status: "CONFIRMED",
          _count: { items: 3 },
        };
      }),
    },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

import { POST } from "@/app/api/zalo/conversations/[id]/share/route";

const ADMIN = { user: { id: "adminA", role: "ADMIN" } };

function jsonReq(id: string, body: unknown) {
  return POST(
    new Request(`http://local/api/zalo/conversations/${id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(ADMIN);
  mockSendText.mockResolvedValue({ ok: true, messageId: "z-msg-1" });
  mockSendImage.mockResolvedValue({ ok: true, messageId: "z-img-1" });
  mockSendFile.mockResolvedValue({ ok: true, messageId: "z-file-1" });
  mockSaveAttachment.mockResolvedValue({
    url: "https://cdn/test-doc.pdf",
    displayName: "계약서.pdf",
  });
  lastVillaSelect = null;
  lastSettlementWhere = null;
});

describe("권한 게이트", () => {
  it("미인증 401", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await jsonReq("convSup", { type: "VILLA", villaId: "villa1" });
    expect(res.status).toBe(401);
  });
  it("비ADMIN 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "supA", role: "SUPPLIER" } });
    const res = await jsonReq("convSup", { type: "VILLA", villaId: "villa1" });
    expect(res.status).toBe(403);
  });
  it("타 관리자 대화 404", async () => {
    const res = await jsonReq("convOther", { type: "VILLA", villaId: "villa1" });
    expect(res.status).toBe(404);
  });
  it("미존재 대화 404", async () => {
    const res = await jsonReq("nope", { type: "VILLA", villaId: "villa1" });
    expect(res.status).toBe(404);
  });
});

describe("S3 빌라 — 공급자 경로(원가만)", () => {
  it("salePrice/margin select 안 함, 본문에 판매가/마진 0", async () => {
    const res = await jsonReq("convSup", { type: "VILLA", villaId: "villa1" });
    expect(res.status).toBe(200);
    // select 화이트리스트: rates에 supplierCostVnd만, salePrice*/margin 키 없음
    const ratesSel = (lastVillaSelect!.ratePeriods as { select: Record<string, boolean> }).select;
    expect(ratesSel.supplierCostVnd).toBe(true);
    expect(ratesSel.salePriceVnd).toBeUndefined();
    expect(ratesSel.salePriceKrw).toBeUndefined();
    expect(ratesSel.marginValue).toBeUndefined();
    expect(ratesSel.marginType).toBeUndefined();
    // 발송 본문 — 원가(1,000,000₫) 포함, 판매가(1,500,000/90,000)·마진 미포함
    const sentText = mockSendText.mock.calls[0][2] as string;
    expect(sentText).toContain("1,000,000₫");
    expect(sentText).not.toContain("1,500,000");
    expect(sentText).not.toContain("90,000");
    expect(sentText.toLowerCase()).not.toContain("margin");
    expect(sentText).toContain("원가");
  });
  it("미매칭 공급자(userId=null) 빌라 공유 거부 403", async () => {
    const res = await jsonReq("convSupUnlinked", { type: "VILLA", villaId: "villa1" });
    expect(res.status).toBe(403);
  });
});

describe("S3 빌라 — 고객 경로(판매가만)", () => {
  it("supplierCost/margin select 안 함, 본문에 원가/마진 0", async () => {
    const res = await jsonReq("convCust", { type: "VILLA", villaId: "villa1" });
    expect(res.status).toBe(200);
    const ratesSel = (lastVillaSelect!.ratePeriods as { select: Record<string, boolean> }).select;
    expect(ratesSel.salePriceVnd).toBe(true);
    expect(ratesSel.salePriceKrw).toBe(true);
    expect(ratesSel.supplierCostVnd).toBeUndefined();
    expect(ratesSel.marginValue).toBeUndefined();
    expect(ratesSel.marginType).toBeUndefined();
    // KRW 판매가(₩90,000) 포함, 원가(1,000,000) 미포함
    const sentText = mockSendText.mock.calls[0][2] as string;
    expect(sentText).toContain("₩90,000");
    expect(sentText).not.toContain("1,000,000");
    expect(sentText).toContain("가격");
  });
});

describe("S3 빌라 — 판매가측 그룹 확장(여행사·랜드사 = 판매가 VND만)", () => {
  it("TRAVEL_AGENCY: salePriceVnd만 본문, 원가·마진·KRW 0", async () => {
    const res = await jsonReq("convTravel", { type: "VILLA", villaId: "villa1" });
    expect(res.status).toBe(200);
    const ratesSel = (lastVillaSelect!.ratePeriods as { select: Record<string, boolean> }).select;
    // 판매가측 select 화이트리스트 — 원가·마진 미조회
    expect(ratesSel.salePriceVnd).toBe(true);
    expect(ratesSel.salePriceKrw).toBe(true);
    expect(ratesSel.supplierCostVnd).toBeUndefined();
    expect(ratesSel.marginValue).toBeUndefined();
    expect(ratesSel.marginType).toBeUndefined();
    // 본문 — VND 판매가(1,500,000₫)만. KRW(90,000)·원가·마진 미포함
    const sentText = mockSendText.mock.calls[0][2] as string;
    expect(sentText).toContain("1,500,000₫");
    expect(sentText).not.toContain("90,000");
    expect(sentText).not.toContain("₩");
    expect(sentText.toLowerCase()).not.toContain("margin");
    expect(sentText).toContain("가격");
  });
  it("LAND_AGENCY: salePriceVnd만 본문(VND 통화)", async () => {
    const res = await jsonReq("convLand", { type: "VILLA", villaId: "villa1" });
    expect(res.status).toBe(200);
    const sentText = mockSendText.mock.calls[0][2] as string;
    expect(sentText).toContain("1,500,000₫");
    expect(sentText).not.toContain("90,000");
    expect(sentText).not.toContain("₩");
  });
  it("CUSTOMER 통화는 여전히 KRW(₩90,000) — 회귀", async () => {
    const res = await jsonReq("convCust", { type: "VILLA", villaId: "villa1" });
    expect(res.status).toBe(200);
    const sentText = mockSendText.mock.calls[0][2] as string;
    expect(sentText).toContain("₩90,000");
  });
});

describe("S2 제안 — 판매가측 그룹 전체 허용", () => {
  it("TRAVEL_AGENCY 제안 공유 허용 200", async () => {
    process.env.NEXTAUTH_URL = "https://app.test";
    const res = await jsonReq("convTravel", { type: "PROPOSAL", proposalId: "prop1" });
    expect(res.status).toBe(200);
    const sentText = mockSendText.mock.calls[0][2] as string;
    expect(sentText).toContain("https://app.test/p/tok-abc");
  });
  it("LAND_AGENCY 제안 공유 허용 200", async () => {
    const res = await jsonReq("convLand", { type: "PROPOSAL", proposalId: "prop1" });
    expect(res.status).toBe(200);
  });
});

describe("S4 정산 — 판매가측 그룹 전체 거부", () => {
  it("TRAVEL_AGENCY 정산 공유 거부 403", async () => {
    const res = await jsonReq("convTravel", { type: "SETTLEMENT", settlementId: "set1" });
    expect(res.status).toBe(403);
  });
  it("LAND_AGENCY 정산 공유 거부 403", async () => {
    const res = await jsonReq("convLand", { type: "SETTLEMENT", settlementId: "set1" });
    expect(res.status).toBe(403);
  });
});

describe("S3 빌라 — UNKNOWN 거부", () => {
  it("UNKNOWN 대화 빌라 공유 403", async () => {
    const res = await jsonReq("convUnknown", { type: "VILLA", villaId: "villa1" });
    expect(res.status).toBe(403);
  });
});

describe("S2 제안 — 고객 전용", () => {
  it("고객 대화 허용 200, /p/[token] 링크 발송 + 빌라 요약·판매가 동봉", async () => {
    process.env.NEXTAUTH_URL = "https://app.test";
    const res = await jsonReq("convCust", { type: "PROPOSAL", proposalId: "prop1" });
    expect(res.status).toBe(200);
    const sentText = mockSendText.mock.calls[0][2] as string;
    expect(sentText).toContain("https://app.test/p/tok-abc");
    expect(sentText).toContain("빌라 1개 · 7.15 ~ 7.18 · 3박");
    expect(sentText).toContain("침실 3 · 수영장 · 총 ₩1,450,000");
    // 누수 가드 — 원가·마진 어휘 없음(판매가는 고객 정당 정보)
    expect(sentText).not.toMatch(/원가|마진|supplierCost/);
  });
  it("공급자 대화 거부 403", async () => {
    const res = await jsonReq("convSup", { type: "PROPOSAL", proposalId: "prop1" });
    expect(res.status).toBe(403);
  });
  it("UNKNOWN 대화 거부 403", async () => {
    const res = await jsonReq("convUnknown", { type: "PROPOSAL", proposalId: "prop1" });
    expect(res.status).toBe(403);
  });
});

describe("S4 정산 — 공급자 전용, 본인만", () => {
  it("본인 정산 허용 200, totalVnd 본문(판매가·마진 없음)", async () => {
    const res = await jsonReq("convSup", { type: "SETTLEMENT", settlementId: "set1" });
    expect(res.status).toBe(200);
    // supplierId 필터가 conversation.userId(supA)로 강제됨 — 타 공급자 정산 불가
    expect(lastSettlementWhere!.supplierId).toBe("supA");
    const sentText = mockSendText.mock.calls[0][2] as string;
    expect(sentText).toContain("5,000,000₫");
    expect(sentText).toContain("2026-05");
    expect(sentText.toLowerCase()).not.toContain("margin");
  });
  it("고객 대화 정산 거부 403", async () => {
    const res = await jsonReq("convCust", { type: "SETTLEMENT", settlementId: "set1" });
    expect(res.status).toBe(403);
  });
  it("미매칭 공급자(userId=null) 거부 403", async () => {
    const res = await jsonReq("convSupUnlinked", { type: "SETTLEMENT", settlementId: "set1" });
    expect(res.status).toBe(403);
  });
  it("타 공급자 정산 id는 supplierId 필터로 404", async () => {
    // convSup(userId=supA)가 supB 소유 정산을 요청 → where.supplierId=supA로 0건 → 404
    // (mock: settlement.findFirst는 supplierId!==supA면 null)
    CONVS.convSup.userId = "supOther";
    const res = await jsonReq("convSup", { type: "SETTLEMENT", settlementId: "set1" });
    expect(lastSettlementWhere!.supplierId).toBe("supOther");
    expect(res.status).toBe(404);
    CONVS.convSup.userId = "supA"; // 복원
  });
});

describe("S1 사진 — 양쪽 허용, 봇 미연결 FAILED", () => {
  function photoReq(id: string) {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([1, 2, 3])], "p.jpg", { type: "image/jpeg" }));
    fd.append("caption", "안녕하세요");
    return POST(
      new Request(`http://local/api/zalo/conversations/${id}/share`, {
        method: "POST",
        body: fd,
      }),
      { params: Promise.resolve({ id }) }
    );
  }
  it("공급자 대화 사진 200 + attachmentUrls 저장", async () => {
    const res = await photoReq("convSup");
    expect(res.status).toBe(200);
    expect(mockSendImage).toHaveBeenCalledOnce();
    const created = txMsgCreate.mock.calls[0][0].data;
    expect(created.msgType).toBe("photo");
    expect(created.attachmentUrls).toEqual(["https://cdn/test-img.jpg"]);
    expect(created.status).toBe("SENT");
  });
  it("UNKNOWN 대화도 사진 허용(누수 0)", async () => {
    const res = await photoReq("convUnknown");
    expect(res.status).toBe(200);
  });
  it("봇 미연결 → status FAILED, 영속은 200", async () => {
    mockSendImage.mockResolvedValue({ ok: false, error: "BOT_NOT_CONNECTED" });
    const res = await photoReq("convSup");
    expect(res.status).toBe(200);
    const created = txMsgCreate.mock.calls[0][0].data;
    expect(created.status).toBe("FAILED");
    expect(created.zaloMsgId).toBeNull();
  });
});

describe("발송 실패 — 텍스트 공유 FAILED 기록", () => {
  it("빌라 공유 봇 미연결 → FAILED, 200", async () => {
    mockSendText.mockResolvedValue({ ok: false, error: "BOT_NOT_CONNECTED" });
    const res = await jsonReq("convSup", { type: "VILLA", villaId: "villa1" });
    expect(res.status).toBe(200);
    const created = txMsgCreate.mock.calls[0][0].data;
    expect(created.status).toBe("FAILED");
  });
});

describe("파일 첨부(비이미지) — 양쪽 허용, 위험 확장자·크기 정책", () => {
  function fileReq(
    id: string,
    name: string,
    mime: string,
    bytes = 3,
    opts?: { type?: string; caption?: string }
  ) {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array(bytes)], name, { type: mime }));
    if (opts?.caption) fd.append("caption", opts.caption);
    if (opts?.type) fd.append("type", opts.type);
    return POST(
      new Request(`http://local/api/zalo/conversations/${id}/share`, {
        method: "POST",
        body: fd,
      }),
      { params: Promise.resolve({ id }) }
    );
  }

  it("PDF 문서 200 — file 경로, attachmentUrls + 파일명 text 저장", async () => {
    const res = await fileReq("convSup", "계약서.pdf", "application/pdf");
    expect(res.status).toBe(200);
    expect(mockSendFile).toHaveBeenCalledOnce();
    expect(mockSendImage).not.toHaveBeenCalled();
    const created = txMsgCreate.mock.calls[0][0].data;
    expect(created.msgType).toBe("file");
    expect(created.attachmentUrls).toEqual(["https://cdn/test-doc.pdf"]);
    expect(created.text).toBe("계약서.pdf");
    expect(created.status).toBe("SENT");
  });

  it("고객 대화도 파일 허용(누수 무관 — ADMIN 업로드)", async () => {
    const res = await fileReq("convCust", "voucher.pdf", "application/pdf");
    expect(res.status).toBe(200);
  });
  it("UNKNOWN 대화도 파일 허용", async () => {
    const res = await fileReq("convUnknown", "info.docx", "application/octet-stream");
    expect(res.status).toBe(200);
  });

  it("위험 확장자(.exe) 차단 400 BLOCKED_TYPE", async () => {
    const res = await fileReq("convSup", "virus.exe", "application/octet-stream");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("BLOCKED_TYPE");
    expect(mockSendFile).not.toHaveBeenCalled();
  });
  it("확장자 없는 파일 차단 400 NO_EXTENSION", async () => {
    const res = await fileReq("convSup", "README", "application/octet-stream");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("NO_EXTENSION");
  });
  it("크기 상한 초과 400 TOO_LARGE", async () => {
    const res = await fileReq(
      "convSup",
      "big.pdf",
      "application/pdf",
      ATTACH_MAX + 1
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("TOO_LARGE");
  });

  it("type=FILE 강제 시 이미지여도 file 경로(photo 미사용)", async () => {
    // 이미지 MIME이지만 type=FILE → validateAttachment가 IS_IMAGE로 거부(이미지는 photo 경로 강제)
    const res = await fileReq("convSup", "shot.png", "image/png", 3, { type: "FILE" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("IS_IMAGE");
    expect(mockSendImage).not.toHaveBeenCalled();
  });
  it("이미지 MIME(type 없음)은 여전히 photo 경로 — 회귀", async () => {
    const res = await fileReq("convSup", "p.jpg", "image/jpeg");
    expect(res.status).toBe(200);
    expect(mockSendImage).toHaveBeenCalledOnce();
    expect(mockSendFile).not.toHaveBeenCalled();
  });

  it("파일 발송 봇 미연결 → FAILED, 영속 200", async () => {
    mockSendFile.mockResolvedValue({ ok: false, error: "BOT_NOT_CONNECTED" });
    const res = await fileReq("convSup", "계약서.pdf", "application/pdf");
    expect(res.status).toBe(200);
    const created = txMsgCreate.mock.calls[0][0].data;
    expect(created.status).toBe("FAILED");
    expect(created.zaloMsgId).toBeNull();
  });
});
