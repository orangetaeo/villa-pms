import { beforeEach, describe, expect, it, vi } from "vitest";

// 실제 PrismaClient·audit·zalo 큐 생성 차단 (T1.6·T3.1 패턴)
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
const enqueueNotification = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock("@/lib/zalo", () => ({ enqueueNotification: (...a: unknown[]) => enqueueNotification(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

// Phase 2(ADR-0029) — 이미지 실발송 의존 모킹.
type SendResult = { ok: boolean; messageId?: string | null; error?: string };
const readFile = vi.fn<(p: unknown) => Promise<Buffer>>(async () => Buffer.from("PASSPORT_BYTES"));
vi.mock("fs", () => ({ promises: { readFile: (p: unknown) => readFile(p) } }));
vi.mock("@/lib/storage", () => ({ getPassportDir: () => "/private/passports" }));
const getSystemBotOwnerId = vi.fn<() => Promise<string | null>>(async () => "admin1");
vi.mock("@/lib/zalo-credentials", () => ({
  getSystemBotOwnerId: () => getSystemBotOwnerId(),
}));
const sendChatImageAsAdmin =
  vi.fn<(...a: unknown[]) => Promise<SendResult>>(async () => ({ ok: true, messageId: "m1" }));
vi.mock("@/lib/zalo-runtime", () => ({
  sendChatImageAsAdmin: (...a: unknown[]) => sendChatImageAsAdmin(...a),
}));
const recordSecurityEvent = vi.fn<(input: unknown) => Promise<void>>(async () => {});
vi.mock("@/lib/security-event", () => ({
  recordSecurityEvent: (input: unknown) => recordSecurityEvent(input),
}));

import { writeAuditLog } from "@/lib/audit-log";
import { POST as tamtruPost } from "../app/api/bookings/[id]/tamtru/route";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => mockAuth(...args) }));

// ===================== tx mock =====================

interface CheckInShape {
  id: string;
  passportPhotoUrls: string[];
  signatureUrl: string | null;
  agreementVersion: string | null;
}
interface BookingShape {
  id: string;
  guestName: string;
  checkIn: Date;
  villaId: string;
  checkInRecord: null | CheckInShape;
  villa: { name: string; supplierId: string; supplier: { zaloUserId: string | null } };
}

function makeTxMock(booking: BookingShape | null) {
  const tx = {
    booking: { findUnique: vi.fn(async () => booking) },
    checkInRecord: { update: vi.fn(async () => ({})) },
  };
  return tx;
}

async function setupPrismaTx(tx: ReturnType<typeof makeTxMock>) {
  const { prisma } = await import("@/lib/prisma");
  (prisma as unknown as Record<string, unknown>).$transaction = async (
    fn: (t: unknown) => Promise<unknown>
  ) => fn(tx);
}

const VILLA = {
  name: "쏘나씨 V12",
  supplierId: "sup1",
  supplier: { zaloUserId: "zalo-sup1" },
};

// 실제 파이프라인 형식 사진면(접두 없음) — sig-/doc- 아님.
const PHOTO = "/api/passports/1760000000000-guest-bk1-0a1b2c3d-e4f5-6789-abcd-ef0123456789.jpg";

const linkedBooking = (over: Partial<BookingShape> = {}): BookingShape => ({
  id: "bk1",
  guestName: "KIM MINSU",
  checkIn: new Date("2026-07-01T00:00:00.000Z"),
  villaId: "villa1",
  checkInRecord: {
    id: "cir1",
    passportPhotoUrls: [PHOTO],
    signatureUrl: "/api/passports/sig-x.png",
    agreementVersion: "2026-07",
  },
  villa: VILLA,
  ...over,
});

const callTamtru = () =>
  tamtruPost(new Request("http://local/api/bookings/bk1/tamtru", { method: "POST" }), {
    params: Promise.resolve({ id: "bk1" }),
  });

describe("POST /api/bookings/[id]/tamtru (T3.6 Phase1 + T3.7 Phase2 ADR-0029)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSystemBotOwnerId.mockResolvedValue("admin1");
    sendChatImageAsAdmin.mockResolvedValue({ ok: true, messageId: "m1" });
    readFile.mockResolvedValue(Buffer.from("PASSPORT_BYTES"));
  });

  it("비로그인 401 / SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await callTamtru()).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await callTamtru()).status).toBe(403);
  });

  it("미존재 예약 404", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupPrismaTx(makeTxMock(null));
    expect((await callTamtru()).status).toBe(404);
  });

  it("체크인 기록 없음 → 400 (NO_CHECKIN)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupPrismaTx(makeTxMock(linkedBooking({ checkInRecord: null })));
    const res = await callTamtru();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("NO_CHECKIN");
  });

  it("여권 사진 없음 → 400 (NO_PASSPORT)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupPrismaTx(
      makeTxMock(
        linkedBooking({
          checkInRecord: { id: "cir1", passportPhotoUrls: [], signatureUrl: null, agreementVersion: null },
        })
      )
    );
    const res = await callTamtru();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("NO_PASSPORT");
  });

  it("성공: TAMTRU 큐잉 + tamTruSentAt 갱신 + AuditLog + 이미지 실발송, supplierLinked/imageSent true", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const tx = makeTxMock(linkedBooking());
    await setupPrismaTx(tx);
    const res = await callTamtru();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.supplierLinked).toBe(true);
    expect(json.imageSent).toBe(true);
    expect(typeof json.tamTruSentAt).toBe("string");

    // 공급자 대상 TAMTRU_PASSPORT 큐잉
    const enq = enqueueNotification.mock.calls[0]![0] as {
      userId: string;
      type: string;
      payload: Record<string, unknown>;
    };
    expect(enq.userId).toBe("sup1");
    expect(enq.type).toBe("TAMTRU_PASSPORT");
    expect(enq.payload.villaName).toBe("쏘나씨 V12");

    // 이미지 실발송 — 공급자 zaloUserId로, 디스크 Buffer로
    expect(sendChatImageAsAdmin).toHaveBeenCalledTimes(1);
    const sendArgs = sendChatImageAsAdmin.mock.calls[0]!;
    expect(sendArgs[1]).toBe("zalo-sup1"); // 공급자 zaloUserId
    expect(Buffer.isBuffer(sendArgs[2])).toBe(true);

    // tamTruSentAt 갱신 + AuditLog
    expect(tx.checkInRecord.update).toHaveBeenCalled();
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalled();
    // SecurityEvent(PII_FORWARD) 1건
    expect(recordSecurityEvent).toHaveBeenCalledTimes(1);
    expect(recordSecurityEvent.mock.calls[0]![0]).toMatchObject({ type: "PII_FORWARD" });
  });

  it("B1 미연결 short-circuit — 여권 Buffer를 읽지 않고 이미지 미발송, supplierLinked false", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const tx = makeTxMock(
      linkedBooking({ villa: { ...VILLA, supplier: { zaloUserId: null } } })
    );
    await setupPrismaTx(tx);
    const res = await callTamtru();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.supplierLinked).toBe(false);
    expect(json.imageSent).toBe(false);
    expect(enqueueNotification).toHaveBeenCalledTimes(1); // 텍스트 알림은 큐잉
    // ★ PII 미적재 — 파일 읽기·이미지 발송 절대 미수행
    expect(readFile).not.toHaveBeenCalled();
    expect(sendChatImageAsAdmin).not.toHaveBeenCalled();
  });

  it("B3 소스 한정 — sig-/doc- 접두는 사진면에서 제외, 사진면 1장만 발송", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const tx = makeTxMock(
      linkedBooking({
        checkInRecord: {
          id: "cir1",
          // 서명·지류가 앞에 와도 사진면을 골라야 함
          passportPhotoUrls: [
            "/api/passports/sig-1760000000000-x-0a1b2c3d-e4f5-6789-abcd-ef0123456789.png",
            "/api/passports/doc-1760000000000-x-0a1b2c3d-e4f5-6789-abcd-ef0123456789.jpg",
            PHOTO,
          ],
          signatureUrl: "/api/passports/sig-x.png",
          agreementVersion: "2026-07",
        },
      })
    );
    await setupPrismaTx(tx);
    const res = await callTamtru();
    expect((await res.json()).imageSent).toBe(true);
    expect(sendChatImageAsAdmin).toHaveBeenCalledTimes(1);
    // 읽은 파일은 사진면 1장 — sig-/doc-는 읽지 않음
    expect(readFile).toHaveBeenCalledTimes(1);
    const readPath = String(readFile.mock.calls[0]![0]);
    expect(readPath).not.toContain("sig-");
    expect(readPath).not.toContain("doc-");
  });

  it("사진면이 없음(sig-/doc-만) → 미발송, 그래도 감사 1건 기록", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const tx = makeTxMock(
      linkedBooking({
        checkInRecord: {
          id: "cir1",
          passportPhotoUrls: [
            "/api/passports/sig-1760000000000-x-0a1b2c3d-e4f5-6789-abcd-ef0123456789.png",
          ],
          signatureUrl: "/api/passports/sig-x.png",
          agreementVersion: "2026-07",
        },
      })
    );
    await setupPrismaTx(tx);
    const res = await callTamtru();
    expect((await res.json()).imageSent).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
    expect(sendChatImageAsAdmin).not.toHaveBeenCalled();
    // 시도(미발송)도 감사 1건
    expect(recordSecurityEvent).toHaveBeenCalledTimes(1);
  });

  it("이미지 발송 실패 — 라우트 200 유지(500 미발생), imageSent false + 감사 기록", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    sendChatImageAsAdmin.mockResolvedValue({ ok: false, error: "BOT_NOT_CONNECTED" });
    const tx = makeTxMock(linkedBooking());
    await setupPrismaTx(tx);
    const res = await callTamtru();
    expect(res.status).toBe(200);
    expect((await res.json()).imageSent).toBe(false);
    expect(recordSecurityEvent).toHaveBeenCalledTimes(1);
  });

  it("재전달 허용 — 두 번 호출 모두 200 + 매번 이미지 발송·감사 1건씩", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const tx = makeTxMock(linkedBooking());
    await setupPrismaTx(tx);
    expect((await callTamtru()).status).toBe(200);
    expect((await callTamtru()).status).toBe(200);
    expect(tx.checkInRecord.update).toHaveBeenCalledTimes(2);
    expect(enqueueNotification).toHaveBeenCalledTimes(2);
    expect(sendChatImageAsAdmin).toHaveBeenCalledTimes(2);
    expect(recordSecurityEvent).toHaveBeenCalledTimes(2);
  });

  it("payload 오염 차단 — 마진·판매가·고객 연락처 미포함 (빌더 화이트리스트 정합)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const tx = makeTxMock(linkedBooking());
    await setupPrismaTx(tx);
    await callTamtru();
    const payload = (enqueueNotification.mock.calls[0]![0] as { payload: Record<string, unknown> })
      .payload;
    const keys = Object.keys(payload);
    expect(keys).toEqual(["villaName", "guestName", "checkIn", "passportPhotoUrls"]);
    expect(JSON.stringify(payload)).not.toMatch(/margin|salePrice|krw|guestPhone|cost/i);
    // SecurityEvent meta에도 여권번호·평문 PII·금액 미포함
    const meta = (recordSecurityEvent.mock.calls[0]![0] as { meta: Record<string, unknown> }).meta;
    expect(JSON.stringify(meta)).not.toMatch(/margin|salePrice|passportNo|guestName/i);
  });
});
