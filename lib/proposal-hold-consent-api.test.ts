import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/p/[token]/hold — 취소·환불 규정 전자 동의 게이트 (T-proposal-policy-consent)
 * csrf·rate-limit·prisma·createHoldFromProposalItem를 mock (route-test 패턴, bookings-note-api).
 * 검증: ① enabled+미동의=400 CONSENT_REQUIRED ② enabled+동의=서버 정책 스냅샷 저장 ③ disabled=미요구·미저장.
 */

vi.mock("@/lib/csrf", () => ({ assertSameOrigin: vi.fn(async () => null) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  clientIp: vi.fn(() => "1.2.3.4"),
}));

const mockAppSettingFind = vi.fn();
const mockProposalItemFind = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { findUnique: (...a: unknown[]) => mockAppSettingFind(...a) },
    proposalItem: { findUnique: (...a: unknown[]) => mockProposalItemFind(...a) },
  },
}));

const mockCreateHold = vi.fn();
vi.mock("@/lib/hold", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hold")>();
  return { ...actual, createHoldFromProposalItem: (...a: unknown[]) => mockCreateHold(...a) };
});

import { POST } from "../app/api/p/[token]/hold/route";

const TOKEN = "tok_abc";

const callPost = (body: unknown) =>
  POST(
    new Request(`http://local/api/p/${TOKEN}/hold`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token: TOKEN }) }
  );

const validBody = {
  itemId: "it1",
  guestName: "홍길동",
  guestPhone: "010-1234-5678",
  guestCount: 2,
};

/** enabled=true 정책 (fullDays 30 / partialDays 14 / 50%) */
const ENABLED_POLICY = JSON.stringify({
  fullDays: 30,
  partialDays: 14,
  partialPct: 50,
  enabled: true,
});
const DISABLED_POLICY = JSON.stringify({
  fullDays: 30,
  partialDays: 14,
  partialPct: 50,
  enabled: false,
});

describe("POST /api/p/[token]/hold — 취소·환불 규정 동의 게이트", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 교차 토큰 통과 — item이 이 token 소속
    mockProposalItemFind.mockResolvedValue({
      id: "it1",
      proposal: { token: TOKEN },
    });
    mockCreateHold.mockResolvedValue({ id: "bk1" });
  });

  it("① enabled + 동의 없음 → 400 CONSENT_REQUIRED (홀드 생성 안 함)", async () => {
    mockAppSettingFind.mockResolvedValue({ value: ENABLED_POLICY });
    const res = await callPost(validBody); // policyConsent 미포함
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "CONSENT_REQUIRED" });
    expect(mockCreateHold).not.toHaveBeenCalled();
  });

  it("① enabled + policyConsent=false → 400 CONSENT_REQUIRED", async () => {
    mockAppSettingFind.mockResolvedValue({ value: ENABLED_POLICY });
    const res = await callPost({ ...validBody, policyConsent: false });
    expect(res.status).toBe(400);
    expect(mockCreateHold).not.toHaveBeenCalled();
  });

  it("② enabled + 동의 → 201 + 서버 정책값으로 스냅샷 저장 (클라 주입 불가)", async () => {
    mockAppSettingFind.mockResolvedValue({ value: ENABLED_POLICY });
    const res = await callPost({ ...validBody, policyConsent: true, locale: "vi" });
    expect(res.status).toBe(201);
    expect(mockCreateHold).toHaveBeenCalledTimes(1);
    const passed = mockCreateHold.mock.calls[0][1] as {
      policyConsentJson: {
        agreedAt: string;
        policy: { fullDays: number; partialDays: number; partialPct: number };
        locale: string;
        source: string;
      } | null;
    };
    expect(passed.policyConsentJson).not.toBeNull();
    // 정책 값 = AppSetting 서버 값 (클라가 보낸 값이 아님)
    expect(passed.policyConsentJson!.policy).toEqual({
      fullDays: 30,
      partialDays: 14,
      partialPct: 50,
    });
    expect(passed.policyConsentJson!.source).toBe("proposal");
    expect(passed.policyConsentJson!.locale).toBe("vi");
    expect(typeof passed.policyConsentJson!.agreedAt).toBe("string");
  });

  it("② 클라가 유효하지 않은 locale을 보내면 ko로 폴백", async () => {
    mockAppSettingFind.mockResolvedValue({ value: ENABLED_POLICY });
    await callPost({ ...validBody, policyConsent: true, locale: "xx" });
    const passed = mockCreateHold.mock.calls[0][1] as {
      policyConsentJson: { locale: string };
    };
    expect(passed.policyConsentJson.locale).toBe("ko");
  });

  it("③ disabled → 동의 없이도 201 + policyConsentJson=null (미요구·미저장)", async () => {
    mockAppSettingFind.mockResolvedValue({ value: DISABLED_POLICY });
    const res = await callPost(validBody); // policyConsent 미포함
    expect(res.status).toBe(201);
    expect(mockCreateHold).toHaveBeenCalledTimes(1);
    const passed = mockCreateHold.mock.calls[0][1] as {
      policyConsentJson: unknown;
    };
    expect(passed.policyConsentJson).toBeNull();
  });
});
