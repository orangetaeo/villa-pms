// ADR-0032 BE-9 — 리스너 워커 분리 스캐폴딩 단위 테스트.
//   ① 발송 위임 분기(로컬 vs 위임)의 플래그 기본값이 현행(로컬) 보존.
//   ② PG NOTIFY 신호 페이로드 누수 0(본문·마진·금액·원가 없음, 식별 신호만).
//   ③ 워커 불통 시 안전 실패값(BOT_NOT_CONNECTED / disconnected).
//   ④ 내부 시크릿 timingSafeEqual 검증.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// realtime-bus.publish — 웹(비워커) 경로에서 호출되는지 검증.
const mockPublish = vi.fn();
vi.mock("@/lib/realtime-bus", () => ({
  publish: (...a: unknown[]) => mockPublish(...a),
}));

// prisma.$executeRaw — 워커 경로의 pg_notify 발행 인자 캡처.
const mockExecuteRaw = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { $executeRaw: (...a: unknown[]) => mockExecuteRaw(...a) },
}));

import {
  isSessionLocal,
  shouldDelegate,
  delegateSend,
  delegateStatus,
  verifyWorkerSecret,
  WORKER_UNREACHABLE_ERROR,
} from "@/lib/zalo-worker-client";
import { isWorkerRuntime } from "@/lib/zalo-runtime-role";
import { notifyRealtime } from "@/lib/realtime-notify";

const g = globalThis as unknown as { __villaZaloWorkerRuntime?: boolean };

beforeEach(() => {
  vi.clearAllMocks();
  mockExecuteRaw.mockResolvedValue(1);
  delete process.env.ZALO_SESSION_LOCAL;
  delete process.env.ZALO_WORKER_URL;
  delete process.env.ZALO_WORKER_SECRET;
  delete process.env.ZALO_EXT_SHARED_SECRET;
  g.__villaZaloWorkerRuntime = false;
});

afterEach(() => {
  g.__villaZaloWorkerRuntime = false;
});

describe("플래그 기본값 = 현행(로컬) 보존", () => {
  it("ZALO_SESSION_LOCAL 미설정 → isSessionLocal=true, shouldDelegate=false (위임 없음)", () => {
    expect(isSessionLocal()).toBe(true);
    expect(shouldDelegate()).toBe(false);
  });

  it("ZALO_SESSION_LOCAL='true' 명시도 로컬", () => {
    process.env.ZALO_SESSION_LOCAL = "true";
    expect(isSessionLocal()).toBe(true);
    expect(shouldDelegate()).toBe(false);
  });

  it("ZALO_SESSION_LOCAL='false' → 웹은 위임(shouldDelegate=true)", () => {
    process.env.ZALO_SESSION_LOCAL = "false";
    expect(isSessionLocal()).toBe(false);
    expect(shouldDelegate()).toBe(true);
  });

  it("워커 프로세스는 SESSION_LOCAL=false여도 위임 안 함(자기 위임 루프 방지)", () => {
    process.env.ZALO_SESSION_LOCAL = "false";
    g.__villaZaloWorkerRuntime = true;
    expect(isWorkerRuntime()).toBe(true);
    expect(shouldDelegate()).toBe(false);
  });
});

describe("notifyRealtime — 세션 보유처별 신호 경로 + 누수 0", () => {
  it("웹(비워커): in-process publish로 발행(ownerAdminId 스코프)", async () => {
    await notifyRealtime("admin1", { type: "inbound", conversationId: "c1" });
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith("admin1", { type: "inbound", conversationId: "c1" });
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it("워커: PG NOTIFY 발행 + payload 누수 0(식별 필드만)", async () => {
    g.__villaZaloWorkerRuntime = true;
    await notifyRealtime("admin1", { type: "inbound", conversationId: "c1" });
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    // $executeRaw`...pg_notify(${channel}, ${json})` — 값 인자에서 채널·payload 추출.
    const call = mockExecuteRaw.mock.calls[0];
    const values = call.slice(1); // [0]=템플릿 strings 배열
    const channel = values[0];
    const payload = JSON.parse(values[1] as string);
    expect(channel).toBe("zalo_realtime");
    expect(Object.keys(payload).sort()).toEqual(["conversationId", "ownerAdminId", "type"]);
    expect(payload).toEqual({ ownerAdminId: "admin1", type: "inbound", conversationId: "c1" });
    // 누수 금지 필드 부재 확인.
    for (const forbidden of ["text", "body", "salePriceKrw", "marginValue", "supplierCostVnd", "price"]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });

  it("ownerAdminId 빈 값이면 발행 안 함(스코프 가드)", async () => {
    await notifyRealtime("", { type: "inbound", conversationId: "c1" });
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });
});

describe("워커 불통 시 안전 실패값(R2·BE-6)", () => {
  it("delegateSend: ZALO_WORKER_URL 미설정 → {ok:false, BOT_NOT_CONNECTED}", async () => {
    const res = await delegateSend({ fn: "sendBotMessage", zaloUserId: "z1", text: "hi" });
    expect(res).toEqual({ ok: false, error: WORKER_UNREACHABLE_ERROR });
  });

  it("delegateStatus: 워커 불통 → disconnected 안전값", async () => {
    const s = await delegateStatus("admin1");
    expect(s.connected).toBe(false);
    expect(s.status).toBe("disconnected");
  });
});

describe("verifyWorkerSecret — timingSafeEqual", () => {
  it("env 미설정 → 항상 false", () => {
    expect(verifyWorkerSecret("anything")).toBe(false);
  });

  it("일치 → true, 불일치/미제공 → false", () => {
    process.env.ZALO_WORKER_SECRET = "s3cr3t-value";
    expect(verifyWorkerSecret("s3cr3t-value")).toBe(true);
    expect(verifyWorkerSecret("wrong")).toBe(false);
    expect(verifyWorkerSecret(undefined)).toBe(false);
  });

  it("ZALO_EXT_SHARED_SECRET 폴백 지원", () => {
    process.env.ZALO_EXT_SHARED_SECRET = "ext-secret";
    expect(verifyWorkerSecret("ext-secret")).toBe(true);
  });
});
