// ADR-0007 S1 — 멀티풀 라우팅 분리 (시스템/개인) + 시스템 발송 무변경 회귀.
// zca-js·credentials를 mock하여 풀 키 분리·라우팅·발송 분기를 검증한다(실 WebSocket 없음).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── zca-js mock — login()이 가짜 API(인스턴스별 sendMessage 스파이) 반환 ──
interface FakeApi {
  __ownId: string;
  getOwnId: () => string;
  sendMessage: ReturnType<typeof vi.fn>;
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
  vi.clearAllMocks();
  mockGetSysOwner.mockResolvedValue("theo");
});

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
