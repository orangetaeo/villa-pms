import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 부가서비스 책임 제한 고지 동의 게이트 (계약 service-order-liability-consent)
 *   POST /api/g/[token]/service-orders · POST /api/p/[token]/service-orders 대칭 검증.
 *   ① 미동의(liabilityConsent≠true) → 400 CONSENT_REQUIRED, 생성 안 함
 *   ② 동의 → 서버 스냅샷 저장(version=서버 상수·source·agreedAt·locale) + 감사로그에 version
 *   ③ 미지원 locale은 en 폴백, 지원 locale은 보존
 *   ④ 모듈 접근자 폴백 + 문구 단일 원천
 */

import { SERVICE_LIABILITY_VERSION, getServiceLiabilityText } from "@/lib/service-liability";

// ── 공통 mock ────────────────────────────────────────────────────────────────
vi.mock("@/lib/csrf", () => ({ assertSameOrigin: vi.fn(async () => null) }));
vi.mock("@/lib/guest-rate-limit", () => ({ guestRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
  clientIp: vi.fn(() => "1.2.3.4"),
}));
vi.mock("@/lib/guest-checkin", () => ({ guestTokenState: vi.fn(() => "OK") }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/pricing", () => ({ getFxVndPerKrw: vi.fn(async () => null) }));
vi.mock("@/lib/regional-vendor", () => ({ resolveOrderVendorId: vi.fn(async () => null) }));
vi.mock("@/lib/ticket-order-validation", () => ({
  validateTicketGuests: vi.fn(async () => ({ ok: true, snapshot: undefined })),
}));
vi.mock("@/lib/checkin-roster", () => ({ loadCheckinRoster: vi.fn(async () => []) }));
vi.mock("@/lib/vendor-dispatch", () => ({ sendVendorPoNotifications: vi.fn(async () => {}) }));
vi.mock("@/lib/consumer-signal-notify", () => ({
  notifyOperatorsServiceOrderRequested: vi.fn(async () => {}),
}));
vi.mock("@/lib/ticket-vendor-guard", () => ({
  canSellItem: vi.fn(() => true),
  loadCanSellItem: vi.fn(async () => true),
}));

const guestTokenFind = vi.fn();
const guestTokenUpdate = vi.fn();
const catalogFind = vi.fn();
const orderCreate = vi.fn();
const bookingFind = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    guestCheckinToken: {
      findUnique: (...a: unknown[]) => guestTokenFind(...a),
      update: (...a: unknown[]) => guestTokenUpdate(...a),
    },
    serviceCatalogItem: { findUnique: (...a: unknown[]) => catalogFind(...a) },
    serviceOrder: { create: (...a: unknown[]) => orderCreate(...a) },
    booking: { findUnique: (...a: unknown[]) => bookingFind(...a) },
  },
}));

import { writeAuditLog } from "@/lib/audit-log";
import { POST as G_POST } from "@/app/api/g/[token]/service-orders/route";
import { POST as P_POST } from "@/app/api/p/[token]/service-orders/route";

const TOKEN = "tok_abc";

const gPost = (body: unknown) =>
  G_POST(
    new Request(`http://local/api/g/${TOKEN}/service-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token: TOKEN }) }
  );

const pPost = (body: unknown) =>
  P_POST(
    new Request(`http://local/api/p/${TOKEN}/service-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token: TOKEN }) }
  );

// 비-TICKET GUEST 품목 — 가격 재계산 통과, 티켓 검증·발주 우회.
const GUEST_ITEM = {
  id: "ci-1",
  active: true,
  type: "MASSAGE",
  audiences: ["GUEST"],
  priceVnd: 100000n,
  options: null,
  nameKo: "발 마사지",
  vendorId: null,
  vendor: null,
};
const PARTNER_ITEM = { ...GUEST_ITEM, audiences: ["PARTNER"], nameKo: "과일 바구니" };

const gValidBody = {
  catalogItemId: "ci-1",
  quantity: 1,
  serviceDate: "2026-08-01",
  serviceTime: "10:00",
};
const pValidBody = {
  bookingId: "bk-1",
  catalogItemId: "ci-1",
  quantity: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  guestTokenFind.mockResolvedValue({
    bookingId: "bk-1",
    expiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: null,
    firstUsedAt: new Date(),
  });
  guestTokenUpdate.mockResolvedValue({});
  orderCreate.mockResolvedValue({ id: "so-new" });
  bookingFind
    // /g: create 이전 빌라·대표자 조회
    .mockResolvedValue({
      id: "bk-1",
      status: "CONFIRMED",
      channel: "PARTNER",
      villaId: "v-1",
      guestName: "홍길동",
      proposalItem: { proposal: { token: TOKEN, expiresAt: new Date(Date.now() + 3_600_000) } },
      villa: { id: "v-1", name: "V11", address: null },
    });
});

describe("POST /api/g/[token]/service-orders — 책임 고지 동의", () => {
  it("① 동의 없음 → 400 CONSENT_REQUIRED (생성 안 함)", async () => {
    const res = await gPost(gValidBody); // liabilityConsent 미포함
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "CONSENT_REQUIRED" });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("① liabilityConsent=false → 400", async () => {
    const res = await gPost({ ...gValidBody, liabilityConsent: false });
    expect(res.status).toBe(400);
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("② 동의 → 201 + 서버 상수 version 스냅샷 저장(source=guest)", async () => {
    catalogFind.mockResolvedValue(GUEST_ITEM);
    const res = await gPost({ ...gValidBody, liabilityConsent: true, locale: "vi" });
    expect(res.status).toBe(201);
    expect(orderCreate).toHaveBeenCalledTimes(1);
    const data = orderCreate.mock.calls[0][0].data as {
      liabilityConsentJson: { agreedAt: string; version: string; locale: string; source: string };
    };
    expect(data.liabilityConsentJson.version).toBe(SERVICE_LIABILITY_VERSION);
    expect(data.liabilityConsentJson.source).toBe("guest");
    expect(data.liabilityConsentJson.locale).toBe("vi");
    expect(typeof data.liabilityConsentJson.agreedAt).toBe("string");
    // 감사로그에 version 증빙
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          liabilityConsentVersion: { new: SERVICE_LIABILITY_VERSION },
        }),
      })
    );
  });

  it("② 미지원 locale은 en 폴백", async () => {
    catalogFind.mockResolvedValue(GUEST_ITEM);
    await gPost({ ...gValidBody, liabilityConsent: true, locale: "xx" });
    const data = orderCreate.mock.calls[0][0].data as { liabilityConsentJson: { locale: string } };
    expect(data.liabilityConsentJson.locale).toBe("en");
  });
});

describe("POST /api/p/[token]/service-orders — 책임 고지 동의", () => {
  it("① 동의 없음 → 400 CONSENT_REQUIRED (생성 안 함)", async () => {
    const res = await pPost(pValidBody);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "CONSENT_REQUIRED" });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("② 동의 → 201 + 스냅샷 저장(source=partner, version=서버 상수)", async () => {
    // /p: 첫 booking.findUnique = 교차토큰, 두 번째 = 빌라명
    bookingFind
      .mockReset()
      .mockResolvedValueOnce({
        id: "bk-1",
        status: "CONFIRMED",
        channel: "PARTNER",
        villaId: "v-1",
        proposalItem: { proposal: { token: TOKEN, expiresAt: new Date(Date.now() + 3_600_000) } },
      })
      .mockResolvedValueOnce({ villa: { name: "V11" } });
    catalogFind.mockResolvedValue(PARTNER_ITEM);
    const res = await pPost({ ...pValidBody, liabilityConsent: true, locale: "ko" });
    expect(res.status).toBe(201);
    expect(orderCreate).toHaveBeenCalledTimes(1);
    const data = orderCreate.mock.calls[0][0].data as {
      liabilityConsentJson: { version: string; source: string; locale: string };
    };
    expect(data.liabilityConsentJson.version).toBe(SERVICE_LIABILITY_VERSION);
    expect(data.liabilityConsentJson.source).toBe("partner");
    expect(data.liabilityConsentJson.locale).toBe("ko");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          liabilityConsentVersion: { new: SERVICE_LIABILITY_VERSION },
        }),
      })
    );
  });
});

describe("lib/service-liability — 단일 원천 접근자", () => {
  it("5언어 모두 title·body·consentLabel 보유", () => {
    for (const lang of ["ko", "en", "vi", "ru", "zh"]) {
      const t = getServiceLiabilityText(lang);
      expect(t.title).toBeTruthy();
      expect(t.body).toBeTruthy();
      expect(t.consentLabel).toBeTruthy();
    }
  });
  it("미지원 로케일은 en 폴백", () => {
    expect(getServiceLiabilityText("xx")).toEqual(getServiceLiabilityText("en"));
  });
  it("version은 고정 상수", () => {
    expect(SERVICE_LIABILITY_VERSION).toBe("2026-07-16.v1");
  });
});
