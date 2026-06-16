// ADR-0007 S1 — 멀티풀 라우팅 분리 (시스템/개인) + 시스템 발송 무변경 회귀.
// zca-js·credentials를 mock하여 풀 키 분리·라우팅·발송 분기를 검증한다(실 WebSocket 없음).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── zca-js mock — login()이 가짜 API(인스턴스별 sendMessage 스파이) 반환 ──
interface FakeApi {
  __ownId: string;
  getOwnId: () => string;
  sendMessage: ReturnType<typeof vi.fn>;
  getAvatarUrlProfile: ReturnType<typeof vi.fn>;
  listener: {
    on: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
  };
}
function makeApi(ownId: string): FakeApi {
  return {
    __ownId: ownId,
    getOwnId: () => ownId,
    sendMessage: vi.fn(async () => ({ message: { msgId: `srv-${ownId}` } })),
    getAvatarUrlProfile: vi.fn(async (zid: string) => ({
      [zid]: { avatar: `https://cdn/avatar-${zid}.jpg` },
    })),
    listener: {
      on: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      removeAllListeners: vi.fn(),
    },
  };
}

// login에 전달된 credentials.imei로 어느 계정인지 식별 → 해당 ownId의 API 반환
const apisByImei = new Map<string, FakeApi>();
vi.mock("zca-js", () => ({
  Zalo: class {
    async login(creds: { imei: string }) {
      return apisByImei.get(creds.imei);
    }
    async loginQR() {
      return null;
    }
  },
  ThreadType: { User: 0, Group: 1 },
  LoginQRCallbackEventType: {},
  // ADR-0009 R3 — zalo-runtime이 모듈 평가 시 Reactions를 참조(역매핑·키 목록). 최소 enum 제공.
  Reactions: { HEART: "/-heart", LIKE: "/-strong", NONE: "" },
}));

// ── credentials mock ──
const systemCred = {
  accountId: "acc-sys",
  zaloUserId: "bot-sys-own",
  userId: "theo",
  kind: "SYSTEM_BOT",
  displayName: "Theo",
  credentials: { imei: "imei-sys", cookie: [], userAgent: "ua" },
};
const personalCred = {
  accountId: "acc-b",
  zaloUserId: "bot-b-own",
  userId: "admin-b",
  kind: "ADMIN_PERSONAL",
  displayName: "Admin B",
  credentials: { imei: "imei-b", cookie: [], userAgent: "ua" },
};
const mockLoadAll = vi.fn();
const mockGetSysOwner = vi.fn();
vi.mock("@/lib/zalo-credentials", () => ({
  loadAllActiveCredentials: (...a: unknown[]) => mockLoadAll(...a),
  loadCredentialsForAccount: vi.fn(async () => null),
  getSystemBotOwnerId: (...a: unknown[]) => mockGetSysOwner(...a),
  setCredentialsInactive: vi.fn(async () => {}),
  saveCredentials: vi.fn(async () => "acc-x"),
}));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

// ── prisma mock — 아바타 백필(backfillAvatars)이 findMany/update 호출 ──
// 소유자별 백필 대상(avatarUrl null) 대화를 반환. owner 스코프·update 호출을 검증.
type FindManyArg = { where: { ownerAdminId: string; avatarUrl: null } };
type UpdateArg = { where: { id: string }; data: Record<string, unknown> };
const backfillTargetsByOwner: Record<string, { id: string; zaloUserId: string }[]> = {};
const mockConvFindMany = vi.fn<(arg: FindManyArg) => Promise<{ id: string; zaloUserId: string }[]>>(
  async (arg) => backfillTargetsByOwner[arg.where.ownerAdminId] ?? []
);
const mockConvUpdate = vi.fn<(arg: UpdateArg) => Promise<object>>(async () => ({}));
const mockConvFindUnique = vi.fn<() => Promise<null>>(async () => null);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    zaloConversation: {
      findMany: (arg: FindManyArg) => mockConvFindMany(arg),
      update: (arg: UpdateArg) => mockConvUpdate(arg),
      findUnique: () => mockConvFindUnique(),
    },
  },
}));
vi.mock("@/lib/zalo-inbound", () => ({
  extractText: () => "",
  isSelfMessage: () => false,
  isEchoMessage: () => false,
  buildInboundKey: () => null,
  parseZaloTs: () => null,
  saveInboundMessage: vi.fn(async () => ({ saved: true, duplicated: false, matchedUserId: null })),
  saveOutboundEcho: vi.fn(async () => ({ saved: true, duplicated: false })),
}));

import {
  connectAllActive,
  getSystemBotApi,
  getApiForAdmin,
  sendBotMessage,
  sendChatMessageAsAdmin,
  SYSTEM_BOT_KEY,
} from "@/lib/zalo-runtime";

beforeEach(() => {
  // 풀·캐시 globalThis 초기화 (테스트 격리)
  const g = globalThis as unknown as Record<string, unknown>;
  g.zaloPool = undefined;
  g.zaloPoolInitialized = undefined;
  g.zaloSystemOwnerId = undefined;
  apisByImei.clear();
  apisByImei.set("imei-sys", makeApi("bot-sys-own"));
  apisByImei.set("imei-b", makeApi("bot-b-own"));
  for (const k of Object.keys(backfillTargetsByOwner)) delete backfillTargetsByOwner[k];
  vi.clearAllMocks();
  mockGetSysOwner.mockResolvedValue("theo");
  mockConvFindMany.mockImplementation(
    async (arg) => backfillTargetsByOwner[arg.where.ownerAdminId] ?? []
  );
  mockConvUpdate.mockResolvedValue({});
});

/** fire-and-forget 백필(순차 + 400ms 지연)이 끝날 때까지 대기. */
async function flushBackfill(ms = 700): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.zaloPool = undefined;
  g.zaloPoolInitialized = undefined;
  g.zaloSystemOwnerId = undefined;
});

describe("connectAllActive — 멀티풀 키 분리", () => {
  it("시스템봇은 __system__ 키, 개인계정은 adminUserId 키로 상주", async () => {
    mockLoadAll.mockResolvedValue([systemCred, personalCred]);
    await connectAllActive();

    expect(getSystemBotApi()).not.toBeNull();
    expect(getSystemBotApi()!.getOwnId()).toBe("bot-sys-own");

    const apiB = await getApiForAdmin("admin-b");
    expect(apiB).not.toBeNull();
    expect(apiB!.getOwnId()).toBe("bot-b-own");

    expect(SYSTEM_BOT_KEY).toBe("__system__");
  });

  it("통합 모드: getApiForAdmin(테오) = 시스템봇 인스턴스 공유(__system__)", async () => {
    mockLoadAll.mockResolvedValue([systemCred]);
    await connectAllActive();

    const sysApi = getSystemBotApi();
    const theoApi = await getApiForAdmin("theo");
    expect(theoApi).toBe(sysApi); // 같은 인스턴스 (이중 로그인 없음)
    expect(theoApi!.getOwnId()).toBe("bot-sys-own");
  });

  it("등록되지 않은 관리자 → null (누수 0)", async () => {
    mockLoadAll.mockResolvedValue([systemCred]);
    await connectAllActive();
    expect(await getApiForAdmin("stranger")).toBeNull();
  });
});

describe("발송 라우팅 분리 (시스템 vs 개인)", () => {
  it("sendBotMessage(시스템 발송)은 항상 시스템봇 인스턴스로 — 개인계정과 무관", async () => {
    mockLoadAll.mockResolvedValue([systemCred, personalCred]);
    await connectAllActive();

    const r = await sendBotMessage("supplier-zalo", "알림");
    expect(r.ok).toBe(true);

    // 시스템봇 API만 호출됨, 개인계정 API는 미호출
    expect(apisByImei.get("imei-sys")!.sendMessage).toHaveBeenCalledWith(
      "알림",
      "supplier-zalo",
      0
    );
    expect(apisByImei.get("imei-b")!.sendMessage).not.toHaveBeenCalled();
  });

  it("sendChatMessageAsAdmin(개인 발송)은 본인 인스턴스로 — 시스템봇과 무관", async () => {
    mockLoadAll.mockResolvedValue([systemCred, personalCred]);
    await connectAllActive();

    const r = await sendChatMessageAsAdmin("admin-b", "friend-zalo", "안녕");
    expect(r.ok).toBe(true);
    expect(apisByImei.get("imei-b")!.sendMessage).toHaveBeenCalledWith("안녕", "friend-zalo", 0);
    expect(apisByImei.get("imei-sys")!.sendMessage).not.toHaveBeenCalled();
  });

  it("통합 모드: 테오 개인 채팅 발송도 시스템봇 인스턴스 사용(공유)", async () => {
    mockLoadAll.mockResolvedValue([systemCred]);
    await connectAllActive();

    const r = await sendChatMessageAsAdmin("theo", "friend-zalo", "안녕");
    expect(r.ok).toBe(true);
    expect(apisByImei.get("imei-sys")!.sendMessage).toHaveBeenCalledWith("안녕", "friend-zalo", 0);
  });

  it("미등록 관리자 채팅 발송 → BOT_NOT_CONNECTED (타 계정 발송 0)", async () => {
    mockLoadAll.mockResolvedValue([systemCred]);
    await connectAllActive();

    const r = await sendChatMessageAsAdmin("stranger", "x", "y");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("BOT_NOT_CONNECTED");
  });

  it("시스템봇 미연결 시 sendBotMessage → BOT_NOT_CONNECTED (발송 무변경 동작 유지)", async () => {
    mockLoadAll.mockResolvedValue([]); // 활성 계정 없음
    await connectAllActive();
    const r = await sendBotMessage("x", "y");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("BOT_NOT_CONNECTED");
  });
});

describe("아바타 백필 트리거 (봇 연결 직후)", () => {
  it("연결 직후 소유자별 avatarUrl null 대화를 findMany로 조회(owner 스코프)", async () => {
    backfillTargetsByOwner["theo"] = [];
    backfillTargetsByOwner["admin-b"] = [];
    mockLoadAll.mockResolvedValue([systemCred, personalCred]);
    await connectAllActive();
    await flushBackfill(50);

    // 각 인스턴스 소유자(theo=시스템봇, admin-b=개인) 스코프로 백필 조회 — 타 관리자 0.
    const owners = mockConvFindMany.mock.calls.map((c) => c[0].where.ownerAdminId);
    expect(owners).toContain("theo");
    expect(owners).toContain("admin-b");
    // 백필 쿼리는 avatarUrl null만 대상으로 한다(이미 채워진 건 제외).
    for (const c of mockConvFindMany.mock.calls) {
      expect(c[0].where.avatarUrl).toBeNull();
    }
  });

  it("대상 대화는 getAvatarUrlProfile 조회 후 avatarUrl로 update", async () => {
    backfillTargetsByOwner["theo"] = [{ id: "conv-1", zaloUserId: "zu-1" }];
    mockLoadAll.mockResolvedValue([systemCred]);
    await connectAllActive();
    await flushBackfill();

    // 시스템봇 API로 아바타 조회됨
    expect(apisByImei.get("imei-sys")!.getAvatarUrlProfile).toHaveBeenCalledWith("zu-1");
    // 성공 시 avatarUrl + avatarFetchedAt 갱신
    const upd = mockConvUpdate.mock.calls.find((c) => c[0].where.id === "conv-1");
    expect(upd).toBeTruthy();
    expect(upd![0].data.avatarUrl).toBe("https://cdn/avatar-zu-1.jpg");
    expect(upd![0].data.avatarFetchedAt).toBeInstanceOf(Date);
  });

  it("비친구·조회 실패(null)여도 avatarFetchedAt만 갱신해 재시도 억제", async () => {
    backfillTargetsByOwner["theo"] = [{ id: "conv-x", zaloUserId: "zu-x" }];
    mockLoadAll.mockResolvedValue([systemCred]);
    // 비친구 → 빈 응답(avatar 없음)
    apisByImei.get("imei-sys")!.getAvatarUrlProfile.mockResolvedValue({});
    await connectAllActive();
    await flushBackfill();

    const upd = mockConvUpdate.mock.calls.find((c) => c[0].where.id === "conv-x");
    expect(upd).toBeTruthy();
    expect(upd![0].data.avatarFetchedAt).toBeInstanceOf(Date);
    expect(upd![0].data.avatarUrl).toBeUndefined(); // URL 미교체
  });

  it("백필 대상 없으면 update 호출 0 (불필요 쓰기 없음)", async () => {
    backfillTargetsByOwner["theo"] = [];
    mockLoadAll.mockResolvedValue([systemCred]);
    await connectAllActive();
    await flushBackfill(50);
    expect(mockConvUpdate).not.toHaveBeenCalled();
  });
});
